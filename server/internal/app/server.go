package app

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"nbld/server/internal/protocol"
)

//go:embed web/admin.html
var adminHTML string

type Server struct {
	addr                string
	instanceID          string
	startedAt           time.Time
	state               *stateStore
	events              *eventHub
	ws                  *wsHub
	chunks              *worldChunkManager
	accounts            accountStore
	onlineCharacters    onlineCharacterStore
	auth                *authService
	closer              io.Closer
	syncer              *onlineCharacterSync
	purger              *deletedCharacterPurger
	authRequired        bool
	onlineCacheRequired bool
}

func NewServer(addr, instanceID string) *Server {
	chunkSeed := time.Now().UTC().Unix()
	goGenerator := &goChunkGenerator{seed: &chunkSeed}
	generator := chunkGenerator(goGenerator)
	if binaryPath := os.Getenv("NBLD_RUST_CHUNKGEN_BIN"); binaryPath != "" {
		generator = newRustChunkGenerator(binaryPath, goGenerator, &chunkSeed)
	}

	store, accountCloser, authRequired := buildAccountStore()
	onlineStore, onlineCloser, onlineCacheRequired := buildOnlineCharacterStore()
	syncer := newOnlineCharacterSync(onlineStore, store, defaultFlushInterval)
	syncer.Start()
	purger := newDeletedCharacterPurger(store, 1*time.Hour)
	purger.Start()

	return &Server{
		addr:                addr,
		instanceID:          instanceID,
		startedAt:           time.Now().UTC(),
		state:               newStateStore(),
		events:              newEventHub(),
		ws:                  newWSHub(),
		chunks:              newWorldChunkManager("data/worlds", generator, &chunkSeed),
		accounts:            store,
		onlineCharacters:    onlineStore,
		auth:                newAuthService(store),
		closer:              &combinedCloser{closers: []io.Closer{onlineCloser, accountCloser}},
		syncer:              syncer,
		purger:              purger,
		authRequired:        authRequired,
		onlineCacheRequired: onlineCacheRequired,
	}
}

func buildAccountStore() (accountStore, io.Closer, bool) {
	databaseURL := os.Getenv("NBLD_DATABASE_URL")
	if databaseURL == "" {
		store := newMemoryAccountStore()
		return store, nil, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	store, err := newPostgresAccountStore(ctx, databaseURL)
	if err != nil {
		log.Printf("postgres unavailable, fallback to memory store: %v", err)
		memory := newMemoryAccountStore()
		return memory, nil, false
	}

	return store, store, true
}

func (s *Server) Run() error {
	defer s.close()

	httpServer := &http.Server{
		Addr:              s.addr,
		Handler:           loggingMiddleware(corsMiddleware(s.routes())),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("gateway listening on %s", s.addr)
	if s.authRequired {
		log.Printf("account store: postgres")
	} else {
		log.Printf("account store: memory")
	}
	if s.onlineCacheRequired {
		log.Printf("online character store: redis")
	} else {
		log.Printf("online character store: memory")
	}

	return httpServer.ListenAndServe()
}

func (s *Server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/api/v1/session/guest", s.handleGuestLogin)
	mux.HandleFunc("/api/v1/session/register", s.handleRegister)
	mux.HandleFunc("/api/v1/session/login", s.handleLogin)
	mux.HandleFunc("/api/v1/characters", s.handleCharacters)
	mux.HandleFunc("/api/v1/characters/create", s.handleCreateCharacter)
	mux.HandleFunc("/api/v1/characters/delete", s.handleDeleteCharacter)
	mux.HandleFunc("/api/v1/characters/stats", s.handleUpdateCharacterStats)
	mux.HandleFunc("/api/v1/characters/inventory", s.handleUpdateCharacterInventory)
	mux.HandleFunc("/api/v1/characters/warehouse", s.handleUpdateCharacterWarehouse)
	mux.HandleFunc("/api/v1/characters/equipment", s.handleUpdateCharacterEquipment)
	mux.HandleFunc("/api/v1/characters/appearance", s.handleUpdateCharacterAppearance)
	mux.HandleFunc("/api/v1/world/enter", s.handleEnterWorld)
	mux.HandleFunc("/api/v1/world/leave", s.handleLeaveWorld)
	mux.HandleFunc("/api/v1/world/state", s.handleWorldState)
	mux.HandleFunc("/api/v1/world/chunks", s.handleWorldChunks)
	mux.HandleFunc("/api/v1/world/seed/random", s.handleRandomSeed)
	mux.HandleFunc("/api/v1/world/move", s.handleMove)
	mux.HandleFunc("/api/v1/world/events", s.handleWorldEvents)
	mux.HandleFunc("/api/admin/accounts", s.handleAdminAccounts)
	mux.HandleFunc("/api/admin/accounts/", s.handleAdminAccountCharacters)
	mux.HandleFunc("/api/admin/characters/", s.handleAdminCharacter)
	mux.HandleFunc("/api/admin/audit-logs", s.handleAdminAuditLogs)
	mux.HandleFunc("/api/admin/sessions", s.handleAdminSessions)
	mux.HandleFunc("/api/admin/login", s.handleAdminLogin)
	mux.HandleFunc("/api/admin/force-logout", s.handleAdminForceLogout)
	mux.HandleFunc("/admin", s.handleAdminPage)
	mux.HandleFunc("/ws/world", s.handleWorldWebSocket)
	mux.HandleFunc("/debug/map", s.handleDebugMap)
	mux.HandleFunc("/debug/map/sample", s.handleDebugMapSample)
	return mux
}

func (s *Server) close() {
	if s.syncer != nil {
		s.syncer.Stop()
	}
	if s.purger != nil {
		s.purger.Stop()
	}
	if s.closer != nil {
		_ = s.closer.Close()
	}
}

func (s *Server) handleRandomSeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	seed, err := s.chunks.randomizeSeed()
	if err != nil {
		http.Error(w, "failed to randomize seed", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, protocol.RandomSeedResponse{
		Seed:  seed,
		MapID: "map_0_0",
	})
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	checks := map[string]protocol.HealthCheck{
		"accountStore": {Status: "ok"},
		"onlineStore":  {Status: "ok"},
	}
	statusCode := http.StatusOK
	overallStatus := "ok"

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := s.accounts.Ping(ctx); err != nil {
		checks["accountStore"] = protocol.HealthCheck{
			Status: "error",
			Error:  err.Error(),
		}
		overallStatus = "degraded"
		statusCode = http.StatusServiceUnavailable
	}

	if err := s.onlineCharacters.Ping(ctx); err != nil {
		checks["onlineStore"] = protocol.HealthCheck{
			Status: "error",
			Error:  err.Error(),
		}
		overallStatus = "degraded"
		statusCode = http.StatusServiceUnavailable
	}

	writeJSON(w, statusCode, protocol.HealthzResponse{
		Status:     overallStatus,
		InstanceID: s.instanceID,
		StartedAt:  s.startedAt.Format(time.RFC3339),
		Checks:     checks,
	})
}

func (s *Server) handleGuestLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.GuestLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	if req.DeviceID == "" {
		http.Error(w, "deviceId is required", http.StatusBadRequest)
		return
	}

	resp := protocol.GuestLoginResponse{
		PlayerID:   "guest-" + randomHex(4),
		Token:      randomHex(16),
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	}

	s.state.putSession(sessionState{
		PlayerID: resp.PlayerID,
		Token:    resp.Token,
		WorldID:  "world-dev-001",
		MapID:    "map_0_0",
		Position: protocol.Position{X: 0, Y: 0},
	})

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	account, err := s.auth.Register(r.Context(), req.Email, req.Username, req.Password, req.ConfirmPassword)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, protocol.RegisterResponse{
		AccountID:  account.ID,
		Email:      account.Email,
		Username:   account.Username,
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	account, err := s.auth.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	token := randomHex(16)
	s.state.putSession(sessionState{
		PlayerID:  account.ID,
		AccountID: account.ID,
		Token:     token,
	})

	if err := s.accounts.SaveSession(r.Context(), SessionRecord{
		Token:      token,
		AccountID:  account.ID,
		LastSeenAt: time.Now().UTC(),
		Metadata: map[string]any{
			"loginMethod": "email",
		},
	}); err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protocol.LoginResponse{
		AccountID:  account.ID,
		Email:      account.Email,
		Username:   account.Username,
		Token:      token,
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleCharacters(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	session, ok := s.requireAccountSession(w, r.URL.Query().Get("token"))
	if !ok {
		return
	}

	roster, err := s.accounts.ListCharacters(r.Context(), session.AccountID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protocol.CharacterListResponse{
		Active:       toProtocolCharacters(roster.Active),
		Deleted:      toProtocolCharacters(roster.Deleted),
		ActiveLimit:  maxActiveCharacters,
		DeletedLimit: maxDeletedCharacters,
	})
}

func (s *Server) handleCreateCharacter(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.CreateCharacterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	session, ok := s.requireAccountSession(w, req.Token)
	if !ok {
		return
	}

	if err := validateCharacterName(req.Name); err != nil {
		writeStoreError(w, err)
		return
	}

	character, err := s.accounts.CreateCharacter(r.Context(), session.AccountID, req.Name)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	_ = s.accounts.AppendAuditLog(r.Context(), AuditLogEntry{
		ActorAccountID: session.AccountID,
		ActorType:      "account",
		TargetType:     "character",
		TargetID:       character.ID,
		Action:         "character_create",
		Payload: map[string]any{
			"name": req.Name,
		},
	})

	writeJSON(w, http.StatusCreated, protocol.CharacterMutationResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleDeleteCharacter(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.DeleteCharacterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	if req.CharacterID == "" {
		writeStoreError(w, ErrCharacterSelectionEmpty)
		return
	}

	session, ok := s.requireAccountSession(w, req.Token)
	if !ok {
		return
	}

	if err := s.flushCharacterNow(r.Context(), session.AccountID, req.CharacterID); err != nil {
		writeStoreError(w, err)
		return
	}

	character, err := s.accounts.SoftDeleteCharacter(r.Context(), session.AccountID, req.CharacterID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	if err := s.onlineCharacters.RemoveCharacter(r.Context(), session.AccountID, req.CharacterID); err != nil {
		writeStoreError(w, err)
		return
	}

	_ = s.accounts.AppendAuditLog(r.Context(), AuditLogEntry{
		ActorAccountID: session.AccountID,
		ActorType:      "account",
		TargetType:     "character",
		TargetID:       req.CharacterID,
		Action:         "character_delete",
		Payload: map[string]any{
			"deletedAt": time.Now().UTC().Format(time.RFC3339),
		},
	})

	writeJSON(w, http.StatusOK, protocol.DeleteCharacterResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleUpdateCharacterStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.UpdateCharacterStatsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) {
		character.Stats = protocolStatsToDomain(req.Stats)
	})
	if !ok {
		return
	}

	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleUpdateCharacterInventory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.UpdateCharacterInventoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) {
		character.Inventory = protocolItemContainerToDomain(req.Inventory)
	})
	if !ok {
		return
	}

	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleUpdateCharacterWarehouse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.UpdateCharacterWarehouseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) {
		character.Warehouse = protocolItemContainerToDomain(req.Warehouse)
	})
	if !ok {
		return
	}

	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleUpdateCharacterEquipment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.UpdateCharacterEquipmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) {
		character.Equipment = protocolEquipmentToDomain(req.Equipment)
		character.Equipment.syncVisibleArmor()
	})
	if !ok {
		return
	}

	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleUpdateCharacterAppearance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.UpdateCharacterAppearanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) {
		character.Appearance = protocolAppearanceToDomain(req.Appearance)
	})
	if !ok {
		return
	}
	if err := validateCharacterAppearance(character.Appearance); err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleEnterWorld(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.EnterWorldRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	session, ok := s.state.getSession(req.Token)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	if session.AccountID == "" {
		writeJSON(w, http.StatusOK, protocol.EnterWorldResponse{
			PlayerID: session.PlayerID,
			WorldID:  session.WorldID,
			MapID:    session.MapID,
			Position: session.Position,
		})
		return
	}

	if req.CharacterID == "" {
		writeStoreError(w, ErrCharacterSelectionEmpty)
		return
	}

	character, err := s.loadCharacterForWorld(r.Context(), session.AccountID, req.CharacterID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	position := protocol.Position{X: character.Position.X, Y: character.Position.Y}
	worldID := character.Position.WorldID
	if worldID == "" {
		worldID = "world-dev-001"
	}
	mapID := character.Position.MapID
	if mapID == "" {
		mapID = "map_0_0"
	}

	updated := sessionState{
		PlayerID:      session.AccountID,
		AccountID:     session.AccountID,
		CharacterID:   character.ID,
		CharacterName: character.Name,
		Appearance:    character.Appearance,
		Equipment:     character.Equipment,
		Token:         session.Token,
		WorldID:       worldID,
		MapID:         mapID,
		Position:      position,
	}
	s.state.putSession(updated)

	if err := s.onlineCharacters.StoreCharacter(r.Context(), session.AccountID, character); err != nil {
		writeStoreError(w, err)
		return
	}

	_ = s.accounts.SaveSession(r.Context(), SessionRecord{
		Token:       session.Token,
		AccountID:   session.AccountID,
		CharacterID: character.ID,
		LastSeenAt:  time.Now().UTC(),
		Metadata: map[string]any{
			"worldId": worldID,
			"mapId":   mapID,
		},
	})

	writeJSON(w, http.StatusOK, protocol.EnterWorldResponse{
		PlayerID:      updated.PlayerID,
		CharacterID:   updated.CharacterID,
		CharacterName: updated.CharacterName,
		WorldID:       updated.WorldID,
		MapID:         updated.MapID,
		Position:      updated.Position,
	})
}

func (s *Server) handleLeaveWorld(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.LeaveWorldRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	session, ok := s.state.getSession(req.Token)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	if session.AccountID != "" && session.CharacterID != "" {
		if err := s.flushCharacterNow(r.Context(), session.AccountID, session.CharacterID); err != nil {
			writeStoreError(w, err)
			return
		}
		_ = s.accounts.DeleteSession(r.Context(), session.Token)
	}

	removed, ok := s.state.deleteSession(req.Token)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	writeJSON(w, http.StatusOK, protocol.LeaveWorldResponse{
		PlayerID:    removed.PlayerID,
		CharacterID: removed.CharacterID,
		Status:      "left_world",
	})
}

func (s *Server) handleWorldState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}

	session, ok := s.state.getSession(token)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	writeJSON(w, http.StatusOK, protocol.WorldStateResponse{
		WorldID:       session.WorldID,
		MapID:         session.MapID,
		PlayerID:      session.PlayerID,
		CharacterID:   session.CharacterID,
		CharacterName: session.CharacterName,
		Position:      session.Position,
		Biome:         "grassland",
		Seed:          10001,
		Players:       s.state.listWorldPlayers(session.WorldID),
	})
}

func (s *Server) handleWorldChunks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}

	session, ok := s.state.getSession(token)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	position := session.Position
	if xRaw, yRaw := r.URL.Query().Get("x"), r.URL.Query().Get("y"); xRaw != "" || yRaw != "" {
		x, xErr := strconv.ParseFloat(xRaw, 64)
		y, yErr := strconv.ParseFloat(yRaw, 64)
		if xErr != nil || yErr != nil {
			http.Error(w, "invalid chunk position", http.StatusBadRequest)
			return
		}
		position = protocol.Position{X: x, Y: y}
	}

	window, err := s.chunks.loadWindow(session.PlayerID, session.MapID, position)
	if err != nil {
		http.Error(w, "failed to load chunks", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, window)
}

func (s *Server) handleMove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.MoveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	session, ok := s.state.updatePosition(req.Token, req.Position)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	mapID, localX, localY, transitioned := resolveMapForPosition(session.MapID, session.Position)
	session, _ = s.state.updateWorldLocation(req.Token, session.WorldID, mapID, protocol.Position{
		X: localX,
		Y: localY,
	})

	if session.AccountID != "" && session.CharacterID != "" {
		err := s.updateOnlineCharacterPosition(r.Context(), session.AccountID, session.CharacterID, CharacterPosition{
			WorldID: session.WorldID,
			MapID:   session.MapID,
			X:       session.Position.X,
			Y:       session.Position.Y,
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}
	}

	writeJSON(w, http.StatusOK, protocol.MoveResponse{
		PlayerID:    session.PlayerID,
		CharacterID: session.CharacterID,
		MapID:       session.MapID,
		Position:    session.Position,
	})

	s.events.broadcast(protocol.WorldEvent{
		Type:          "player_moved",
		PlayerID:      session.PlayerID,
		CharacterID:   session.CharacterID,
		CharacterName: session.CharacterName,
		MapID:         session.MapID,
		Position:      session.Position,
		OccurredAt:    time.Now().UTC().Format(time.RFC3339),
		Appearance:    toProtocolAppearance(session.Appearance),
		Equipment:     toProtocolEquipment(session.Equipment),
	})

	s.ws.broadcast(session.WorldID, protocol.WSServerMessage{
		Type:          "player_moved",
		PlayerID:      session.PlayerID,
		CharacterID:   session.CharacterID,
		CharacterName: session.CharacterName,
		WorldID:       session.WorldID,
		MapID:         session.MapID,
		Position:      session.Position,
		Appearance:    toProtocolAppearance(session.Appearance),
		Equipment:     toProtocolEquipment(session.Equipment),
	})

	if transitioned {
		s.ws.broadcast(session.WorldID, protocol.WSServerMessage{
			Type:          "map_transition",
			PlayerID:      session.PlayerID,
			CharacterID:   session.CharacterID,
			CharacterName: session.CharacterName,
			WorldID:       session.WorldID,
			MapID:         session.MapID,
			Position:      session.Position,
		})
	}
}

func (s *Server) handleWorldEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}

	session, ok := s.state.getSession(token)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	subID, ch := s.events.subscribe()
	defer s.events.unsubscribe(subID)

	if err := writeSSE(w, protocol.WorldEvent{
		Type:          "connected",
		PlayerID:      session.PlayerID,
		CharacterID:   session.CharacterID,
		CharacterName: session.CharacterName,
		MapID:         session.MapID,
		Position:      session.Position,
		OccurredAt:    time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return
	}
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-ch:
			if err := writeSSE(w, event); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) handleAdminAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}

	accounts, err := s.accounts.AdminListAccounts(r.Context(), 100)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	resp := protocol.AdminAccountsResponse{
		Accounts: make([]protocol.AdminAccountSummary, 0, len(accounts)),
	}
	for _, account := range accounts {
		resp.Accounts = append(resp.Accounts, protocol.AdminAccountSummary{
			ID:                   account.ID,
			Email:                account.Email,
			Username:             account.Username,
			ActiveCharacterCount: account.ActiveCharacterCount,
			CreatedAt:            account.CreatedAt.Format(time.RFC3339),
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleAdminAccountCharacters(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}

	accountID := strings.TrimPrefix(r.URL.Path, "/api/admin/accounts/")
	accountID = strings.TrimSuffix(accountID, "/characters")
	if accountID == "" || !strings.HasSuffix(r.URL.Path, "/characters") {
		http.Error(w, "accountId is required", http.StatusBadRequest)
		return
	}

	characters, err := s.accounts.AdminListCharactersByAccount(r.Context(), accountID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protocol.AdminAccountCharactersResponse{
		Characters: toProtocolCharacters(characters),
	})
}

func (s *Server) handleAdminCharacter(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}

	characterID := strings.TrimPrefix(r.URL.Path, "/api/admin/characters/")
	if characterID == "" {
		http.Error(w, "characterId is required", http.StatusBadRequest)
		return
	}

	character, err := s.accounts.AdminGetCharacter(r.Context(), characterID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, protocol.AdminCharacterResponse{
		Character: toProtocolCharacter(character),
	})
}

func (s *Server) handleAdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}

	logs, err := s.accounts.AdminListAuditLogs(r.Context(), 100)
	targetType := r.URL.Query().Get("targetType")
	targetID := r.URL.Query().Get("targetId")
	if targetType != "" && targetID != "" {
		logs, err = s.accounts.AdminListAuditLogsByTarget(r.Context(), targetType, targetID, 100)
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}

	resp := protocol.AdminAuditLogsResponse{
		Logs: make([]protocol.AdminAuditLogEntry, 0, len(logs)),
	}
	for _, entry := range logs {
		resp.Logs = append(resp.Logs, protocol.AdminAuditLogEntry{
			ActorAccountID: entry.ActorAccountID,
			ActorType:      entry.ActorType,
			TargetType:     entry.TargetType,
			TargetID:       entry.TargetID,
			Action:         entry.Action,
			Payload:        entry.Payload,
			CreatedAt:      entry.CreatedAt.Format(time.RFC3339),
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleAdminSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}

	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	sessions := s.state.listSessions()
	resp := protocol.AdminSessionsResponse{
		Sessions: make([]protocol.AdminSessionSummary, 0, len(sessions)),
	}

	for _, session := range sessions {
		if query != "" {
			haystack := strings.ToLower(strings.Join([]string{
				session.Token,
				session.AccountID,
				session.CharacterID,
				session.CharacterName,
				session.WorldID,
				session.MapID,
			}, " "))
			if !strings.Contains(haystack, query) {
				continue
			}
		}

		resp.Sessions = append(resp.Sessions, protocol.AdminSessionSummary{
			Token:         session.Token,
			AccountID:     session.AccountID,
			CharacterID:   session.CharacterID,
			CharacterName: session.CharacterName,
			WorldID:       session.WorldID,
			MapID:         session.MapID,
			LastSeenAt:    time.Now().UTC().Format(time.RFC3339),
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req protocol.AdminLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	expectedUser := os.Getenv("NBLD_ADMIN_USERNAME")
	expectedPass := os.Getenv("NBLD_ADMIN_PASSWORD")
	if expectedUser == "" || expectedPass == "" {
		http.Error(w, "admin credentials not configured", http.StatusServiceUnavailable)
		return
	}
	if req.Username != expectedUser || req.Password != expectedPass {
		http.Error(w, "admin login invalid", http.StatusUnauthorized)
		return
	}

	sessionToken := randomHex(24)
	http.SetCookie(w, &http.Cookie{
		Name:     "nbld_admin_session",
		Value:    sessionToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	writeJSON(w, http.StatusOK, protocol.AdminLoginResponse{
		Status: "ok",
	})
}

func (s *Server) handleAdminForceLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.requireAdmin(w, r) {
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "session token is required", http.StatusBadRequest)
		return
	}

	if session, ok := s.state.deleteSession(token); ok {
		_ = s.accounts.DeleteSession(r.Context(), token)
		_ = s.accounts.AppendAuditLog(r.Context(), AuditLogEntry{
			ActorType:  "admin",
			TargetType: "session",
			TargetID:   token,
			Action:     "force_logout",
			Payload: map[string]any{
				"accountId":   session.AccountID,
				"characterId": session.CharacterID,
			},
		})
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAdminPage(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminPage(w, r) {
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, adminHTML)
}

func writeJSON(w http.ResponseWriter, statusCode int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response failed: %v", err)
	}
}

func writeStoreError(w http.ResponseWriter, err error) {
	status, message := mapStoreError(err)
	http.Error(w, message, status)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func randomHex(byteLen int) string {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(buf)
}

func writeSSE(w http.ResponseWriter, event protocol.WorldEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintf(w, "event: world\ndata: %s\n\n", data); err != nil {
		return err
	}
	return nil
}

func (s *Server) handleWorldWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Upgrade") != "websocket" {
		http.Error(w, "websocket upgrade required", http.StatusBadRequest)
		return
	}

	conn, err := upgradeWebSocket(w, r)
	if err != nil {
		return
	}
	defer conn.close()

	var hello protocol.WSClientMessage
	if err := readWSJSON(conn, &hello); err != nil {
		_ = writeWSJSON(conn, protocol.WSServerMessage{
			Type:  "error",
			Error: "failed to read hello message",
		})
		return
	}

	if hello.Type != "auth" || hello.Token == "" {
		_ = writeWSJSON(conn, protocol.WSServerMessage{
			Type:  "error",
			Error: "first message must be auth with token",
		})
		return
	}

	session, ok := s.state.getSession(hello.Token)
	if !ok {
		_ = writeWSJSON(conn, protocol.WSServerMessage{
			Type:  "error",
			Error: "invalid token",
		})
		return
	}

	client := &wsClient{
		conn:     conn,
		playerID: session.PlayerID,
		worldID:  session.WorldID,
		send:     make(chan protocol.WSServerMessage, 16),
	}
	s.ws.add(client)
	defer s.ws.remove(client)

	writeDone := make(chan struct{})
	go s.writeWSLoop(client, writeDone)

	client.send <- protocol.WSServerMessage{
		Type:          "auth_ok",
		PlayerID:      session.PlayerID,
		CharacterID:   session.CharacterID,
		CharacterName: session.CharacterName,
		WorldID:       session.WorldID,
		MapID:         session.MapID,
		Position:      session.Position,
		Appearance:    toProtocolAppearance(session.Appearance),
		Equipment:     toProtocolEquipment(session.Equipment),
		Players:       s.state.listWorldPlayers(session.WorldID),
	}

	for {
		var message protocol.WSClientMessage
		if err := readWSJSON(conn, &message); err != nil {
			break
		}

		if message.Type != "move" {
			client.send <- protocol.WSServerMessage{
				Type:  "error",
				Error: "unsupported message type",
			}
			continue
		}

		updated, ok := s.state.updatePosition(hello.Token, message.Position)
		if !ok {
			client.send <- protocol.WSServerMessage{
				Type:  "error",
				Error: "invalid token",
			}
			continue
		}

		mapID, localX, localY, transitioned := resolveMapForPosition(updated.MapID, updated.Position)
		updated, _ = s.state.updateWorldLocation(hello.Token, updated.WorldID, mapID, protocol.Position{
			X: localX,
			Y: localY,
		})

		if updated.AccountID != "" && updated.CharacterID != "" {
			if err := s.updateOnlineCharacterPosition(r.Context(), updated.AccountID, updated.CharacterID, CharacterPosition{
				WorldID: updated.WorldID,
				MapID:   updated.MapID,
				X:       updated.Position.X,
				Y:       updated.Position.Y,
			}); err != nil {
				client.send <- protocol.WSServerMessage{
					Type:  "error",
					Error: err.Error(),
				}
				continue
			}
		}

		broadcast := protocol.WSServerMessage{
			Type:          "player_moved",
			PlayerID:      updated.PlayerID,
			CharacterID:   updated.CharacterID,
			CharacterName: updated.CharacterName,
			WorldID:       updated.WorldID,
			MapID:         updated.MapID,
			Position:      updated.Position,
			Appearance:    toProtocolAppearance(updated.Appearance),
			Equipment:     toProtocolEquipment(updated.Equipment),
		}

		s.events.broadcast(protocol.WorldEvent{
			Type:          "player_moved",
			PlayerID:      updated.PlayerID,
			CharacterID:   updated.CharacterID,
			CharacterName: updated.CharacterName,
			MapID:         updated.MapID,
			Position:      updated.Position,
			OccurredAt:    time.Now().UTC().Format(time.RFC3339),
			Appearance:    toProtocolAppearance(updated.Appearance),
			Equipment:     toProtocolEquipment(updated.Equipment),
		})
		s.ws.broadcast(updated.WorldID, broadcast)

		if transitioned {
			s.ws.broadcast(updated.WorldID, protocol.WSServerMessage{
				Type:          "map_transition",
				PlayerID:      updated.PlayerID,
				CharacterID:   updated.CharacterID,
				CharacterName: updated.CharacterName,
				WorldID:       updated.WorldID,
				MapID:         updated.MapID,
				Position:      updated.Position,
			})
		}
	}

	close(client.send)
	<-writeDone
}

func (s *Server) writeWSLoop(client *wsClient, done chan<- struct{}) {
	defer close(done)

	for message := range client.send {
		if err := writeWSJSON(client.conn, message); err != nil {
			return
		}
	}
}

func readWSJSON(conn *wsConn, dst any) error {
	for {
		frame, err := conn.readFrame()
		if err != nil {
			return err
		}

		switch frame.opcode {
		case 0x1:
			return json.Unmarshal(frame.payload, dst)
		case 0x8:
			_ = conn.writeClose(frame.payload)
			return io.EOF
		case 0x9:
			if err := conn.writePong(frame.payload); err != nil {
				return err
			}
		case 0xA:
			continue
		default:
			return fmt.Errorf("unsupported websocket opcode: %d", frame.opcode)
		}
	}
}

func writeWSJSON(conn *wsConn, v any) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.writeTextMessage(payload)
}

func (s *Server) requireAccountSession(w http.ResponseWriter, token string) (sessionState, bool) {
	if token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return sessionState{}, false
	}

	session, ok := s.state.getSession(token)
	if !ok {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return sessionState{}, false
	}

	if session.AccountID == "" {
		http.Error(w, "account login required", http.StatusUnauthorized)
		return sessionState{}, false
	}

	return session, true
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	expected := os.Getenv("NBLD_ADMIN_TOKEN")
	if expected != "" && r.Header.Get("X-Admin-Token") == expected {
		return true
	}
	if cookie, err := r.Cookie("nbld_admin_session"); err == nil && cookie.Value != "" {
		return true
	}
	if expected == "" {
		http.Error(w, "admin token not configured", http.StatusServiceUnavailable)
		return false
	}
	http.Error(w, "admin token invalid", http.StatusUnauthorized)
	return false
}

func (s *Server) requireAdminPage(w http.ResponseWriter, r *http.Request) bool {
	if cookie, err := r.Cookie("nbld_admin_session"); err == nil && cookie.Value != "" {
		return true
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = io.WriteString(w, `<html><body style="font-family:sans-serif;padding:24px"><h2>Admin Login Required</h2><p>POST /api/admin/login with username and password first.</p></body></html>`)
	return false
}

func toProtocolCharacters(characters []Character) []protocol.CharacterSummary {
	out := make([]protocol.CharacterSummary, 0, len(characters))
	for _, character := range characters {
		out = append(out, toProtocolCharacter(character))
	}
	return out
}

func toProtocolCharacter(character Character) protocol.CharacterSummary {
	summary := protocol.CharacterSummary{
		ID:      character.ID,
		Name:    character.Name,
		Version: character.Version,
		Stats: protocol.CharacterStats{
			Base: protocol.CharacterBaseStats{
				Health:    character.Stats.Base.Health,
				Stamina:   character.Stats.Base.Stamina,
				Mana:      character.Stats.Base.Mana,
				MoveSpeed: character.Stats.Base.MoveSPD,
			},
			Attack: protocol.CharacterAttackStats{
				PhysicalAttack:  character.Stats.Attack.PhysicalAttack,
				SpellAttack:     character.Stats.Attack.SpellAttack,
				PhysicalCrit:    character.Stats.Attack.PhysicalCrit,
				SpellCrit:       character.Stats.Attack.SpellCrit,
				DamageBonus:     character.Stats.Attack.DamageBonus,
				CritDamageBonus: character.Stats.Attack.CritDamageBonus,
				BonusDamage:     character.Stats.Attack.BonusDamage,
			},
			Defense: protocol.CharacterDefenseStats{
				PhysicalDefense:  character.Stats.Defense.PhysicalDefense,
				SpellDefense:     character.Stats.Defense.SpellDefense,
				CritResistance:   character.Stats.Defense.CritResistance,
				DamageMitigation: character.Stats.Defense.DamageMitigate,
				BonusMitigation:  character.Stats.Defense.BonusMitigate,
			},
		},
		Inventory: protocol.ItemContainer{
			Items: toProtocolItems(character.Inventory.Items),
		},
		Warehouse: protocol.ItemContainer{
			Items: toProtocolItems(character.Warehouse.Items),
		},
		Position: protocol.CharacterPosition{
			WorldID: character.Position.WorldID,
			MapID:   character.Position.MapID,
			X:       character.Position.X,
			Y:       character.Position.Y,
		},
		Equipment: protocol.CharacterEquipment{
			MainHand:    character.Equipment.MainHand,
			OffHand:     character.Equipment.OffHand,
			Helmet:      character.Equipment.Helmet,
			Chest:       character.Equipment.Chest,
			Pants:       character.Equipment.Pants,
			Shoes:       character.Equipment.Shoes,
			Shoulders:   character.Equipment.Shoulders,
			Cloak:       character.Equipment.Cloak,
			LeftBracer:  character.Equipment.LeftBracer,
			RightBracer: character.Equipment.RightBracer,
			VisibleArmor: protocol.VisibleArmor{
				Helmet:    character.Equipment.VisibleArmor.Helmet,
				Chest:     character.Equipment.VisibleArmor.Chest,
				Pants:     character.Equipment.VisibleArmor.Pants,
				Shoes:     character.Equipment.VisibleArmor.Shoes,
				Shoulders: character.Equipment.VisibleArmor.Shoulders,
			},
		},
		Appearance: protocol.CharacterAppearance{
			Body: protocol.CharacterBodyAppearance{
				Height:             character.Appearance.Body.Height,
				HeadWidth:          character.Appearance.Body.HeadWidth,
				HeadSideWidth:      character.Appearance.Body.HeadSideWidth,
				FrontShoulderWidth: character.Appearance.Body.FrontShoulderWidth,
				SideWidth:          character.Appearance.Body.SideWidth,
				ChestWidth:         character.Appearance.Body.ChestWidth,
				WaistWidth:         character.Appearance.Body.WaistWidth,
				HipWidth:           character.Appearance.Body.HipWidth,
				TorsoHeight:        character.Appearance.Body.TorsoHeight,
				UpperArmWidth:      character.Appearance.Body.UpperArmWidth,
				UpperArmSideWidth:  character.Appearance.Body.UpperArmSideWidth,
				UpperArmLength:     character.Appearance.Body.UpperArmLength,
				ForearmWidth:       character.Appearance.Body.ForearmWidth,
				ForearmSideWidth:   character.Appearance.Body.ForearmSideWidth,
				ForearmLength:      character.Appearance.Body.ForearmLength,
				ThighWidth:         character.Appearance.Body.ThighWidth,
				ThighSideWidth:     character.Appearance.Body.ThighSideWidth,
				ThighLength:        character.Appearance.Body.ThighLength,
				CalfWidth:          character.Appearance.Body.CalfWidth,
				CalfSideWidth:      character.Appearance.Body.CalfSideWidth,
				CalfLength:         character.Appearance.Body.CalfLength,
				ChestDepth:         character.Appearance.Body.ChestDepth,
				WaistDepth:         character.Appearance.Body.WaistDepth,
				HipDepth:           character.Appearance.Body.HipDepth,
			},
		},
		CreatedAt: character.CreatedAt.Format(time.RFC3339),
		UpdatedAt: character.UpdatedAt.Format(time.RFC3339),
	}

	if character.DeletedAt != nil {
		summary.DeletedAt = character.DeletedAt.Format(time.RFC3339)
	}
	if character.PurgeAt != nil {
		summary.PurgeAt = character.PurgeAt.Format(time.RFC3339)
	}

	return summary
}

func toProtocolItems(items []ItemStack) []protocol.ItemStack {
	out := make([]protocol.ItemStack, 0, len(items))
	for _, item := range items {
		out = append(out, protocol.ItemStack{
			ItemID:   item.ItemID,
			Quantity: item.Quantity,
		})
	}
	return out
}

func toProtocolAppearance(appearance CharacterAppearance) protocol.CharacterAppearance {
	return protocol.CharacterAppearance{
		Body: protocol.CharacterBodyAppearance{
			Height:             appearance.Body.Height,
			HeadWidth:          appearance.Body.HeadWidth,
			HeadSideWidth:      appearance.Body.HeadSideWidth,
			FrontShoulderWidth: appearance.Body.FrontShoulderWidth,
			SideWidth:          appearance.Body.SideWidth,
			ChestWidth:         appearance.Body.ChestWidth,
			WaistWidth:         appearance.Body.WaistWidth,
			HipWidth:           appearance.Body.HipWidth,
			TorsoHeight:        appearance.Body.TorsoHeight,
			UpperArmWidth:      appearance.Body.UpperArmWidth,
			UpperArmSideWidth:  appearance.Body.UpperArmSideWidth,
			UpperArmLength:     appearance.Body.UpperArmLength,
			ForearmWidth:       appearance.Body.ForearmWidth,
			ForearmSideWidth:   appearance.Body.ForearmSideWidth,
			ForearmLength:      appearance.Body.ForearmLength,
			ThighWidth:         appearance.Body.ThighWidth,
			ThighSideWidth:     appearance.Body.ThighSideWidth,
			ThighLength:        appearance.Body.ThighLength,
			CalfWidth:          appearance.Body.CalfWidth,
			CalfSideWidth:      appearance.Body.CalfSideWidth,
			CalfLength:         appearance.Body.CalfLength,
			ChestDepth:         appearance.Body.ChestDepth,
			WaistDepth:         appearance.Body.WaistDepth,
			HipDepth:           appearance.Body.HipDepth,
			HeadScale:          appearance.Body.HeadScale,
		},
		Style: protocol.CharacterStyleAppearance{
			HairStyle: appearance.Style.HairStyle,
		},
		Hair: protocol.CharacterHairAppearance{
			Front:   appearance.Hair.Front,
			Back:    appearance.Hair.Back,
			Left:    appearance.Hair.Left,
			Right:   appearance.Hair.Right,
			FrontFg: appearance.Hair.FrontFg,
			BackFg:  appearance.Hair.BackFg,
			LeftFg:  appearance.Hair.LeftFg,
			RightFg: appearance.Hair.RightFg,
		},
		Skeleton: protocol.CharacterSkeletonAppearance{
			FrontTorso: appearance.Skeleton.FrontTorso,
			BackTorso:  appearance.Skeleton.BackTorso,
			LeftTorso:  appearance.Skeleton.LeftTorso,
			RightTorso: appearance.Skeleton.RightTorso,
		},
		Palette: protocol.CharacterPaletteAppearance{
			SkinPrimary:  appearance.Palette.SkinPrimary,
			SkinShadow:   appearance.Palette.SkinShadow,
			HairPrimary:  appearance.Palette.HairPrimary,
			HairShadow:   appearance.Palette.HairShadow,
			ClothPrimary: appearance.Palette.ClothPrimary,
			ClothShadow:  appearance.Palette.ClothShadow,
			MetalPrimary: appearance.Palette.MetalPrimary,
			MetalShadow:  appearance.Palette.MetalShadow,
		},
	}
}

func toProtocolEquipment(equipment CharacterEquipment) protocol.CharacterEquipment {
	return protocol.CharacterEquipment{
		MainHand:    equipment.MainHand,
		OffHand:     equipment.OffHand,
		Helmet:      equipment.Helmet,
		Chest:       equipment.Chest,
		Pants:       equipment.Pants,
		Shoes:       equipment.Shoes,
		Shoulders:   equipment.Shoulders,
		Cloak:       equipment.Cloak,
		LeftBracer:  equipment.LeftBracer,
		RightBracer: equipment.RightBracer,
		VisibleArmor: protocol.VisibleArmor{
			Helmet:    equipment.VisibleArmor.Helmet,
			Chest:     equipment.VisibleArmor.Chest,
			Pants:     equipment.VisibleArmor.Pants,
			Shoes:     equipment.VisibleArmor.Shoes,
			Shoulders: equipment.VisibleArmor.Shoulders,
		},
	}
}

func (s *Server) loadCharacterForWorld(ctx context.Context, accountID, characterID string) (Character, error) {
	character, ok, err := s.onlineCharacters.LoadCharacter(ctx, accountID, characterID)
	if err != nil {
		return Character{}, err
	}
	if ok {
		return character, nil
	}

	character, err = s.accounts.GetCharacter(ctx, accountID, characterID)
	if err != nil {
		return Character{}, err
	}
	if err := s.onlineCharacters.StoreCharacter(ctx, accountID, character); err != nil {
		return Character{}, err
	}
	return character, nil
}

func (s *Server) updateOnlineCharacterPosition(ctx context.Context, accountID, characterID string, position CharacterPosition) error {
	return s.updateOnlineCharacter(ctx, accountID, characterID, func(character *Character) {
		character.Position = position
	})
}

func (s *Server) updateOnlineCharacter(ctx context.Context, accountID, characterID string, mutate func(*Character)) error {
	_, err := s.onlineCharacters.UpdateCharacter(ctx, accountID, characterID, func(character *Character) error {
		mutate(character)
		return nil
	})
	return err
}

func (s *Server) flushCharacterNow(ctx context.Context, accountID, characterID string) error {
	character, ok, err := s.onlineCharacters.LoadCharacter(ctx, accountID, characterID)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	return s.accounts.SaveCharacter(ctx, accountID, character)
}

func (s *Server) updateCharacterFromRequest(ctx context.Context, w http.ResponseWriter, token, characterID string, mutate func(*Character)) (Character, bool) {
	if characterID == "" {
		writeStoreError(w, ErrCharacterSelectionEmpty)
		return Character{}, false
	}

	session, ok := s.requireAccountSession(w, token)
	if !ok {
		return Character{}, false
	}

	character, err := s.loadCharacterForWorld(ctx, session.AccountID, characterID)
	if err != nil {
		writeStoreError(w, err)
		return Character{}, false
	}

	if err := s.updateOnlineCharacter(ctx, session.AccountID, characterID, mutate); err != nil {
		writeStoreError(w, err)
		return Character{}, false
	}

	mutate(&character)
	character.UpdatedAt = time.Now().UTC()
	return character, true
}

func protocolStatsToDomain(stats protocol.CharacterStats) CharacterStats {
	return CharacterStats{
		Base: BaseStats{
			Health:  stats.Base.Health,
			Stamina: stats.Base.Stamina,
			Mana:    stats.Base.Mana,
			MoveSPD: stats.Base.MoveSpeed,
		},
		Attack: AttackStats{
			PhysicalAttack:  stats.Attack.PhysicalAttack,
			SpellAttack:     stats.Attack.SpellAttack,
			PhysicalCrit:    stats.Attack.PhysicalCrit,
			SpellCrit:       stats.Attack.SpellCrit,
			DamageBonus:     stats.Attack.DamageBonus,
			CritDamageBonus: stats.Attack.CritDamageBonus,
			BonusDamage:     stats.Attack.BonusDamage,
		},
		Defense: DefenseStats{
			PhysicalDefense: stats.Defense.PhysicalDefense,
			SpellDefense:    stats.Defense.SpellDefense,
			CritResistance:  stats.Defense.CritResistance,
			DamageMitigate:  stats.Defense.DamageMitigation,
			BonusMitigate:   stats.Defense.BonusMitigation,
		},
	}
}

func protocolItemContainerToDomain(container protocol.ItemContainer) ItemContainer {
	items := make([]ItemStack, 0, len(container.Items))
	for _, item := range container.Items {
		items = append(items, ItemStack{
			ItemID:   item.ItemID,
			Quantity: item.Quantity,
		})
	}
	return ItemContainer{Items: items}
}

func protocolEquipmentToDomain(equipment protocol.CharacterEquipment) CharacterEquipment {
	out := CharacterEquipment{
		MainHand:    equipment.MainHand,
		OffHand:     equipment.OffHand,
		Helmet:      equipment.Helmet,
		Chest:       equipment.Chest,
		Pants:       equipment.Pants,
		Shoes:       equipment.Shoes,
		Shoulders:   equipment.Shoulders,
		Cloak:       equipment.Cloak,
		LeftBracer:  equipment.LeftBracer,
		RightBracer: equipment.RightBracer,
	}
	out.syncVisibleArmor()
	return out
}

func protocolAppearanceToDomain(appearance protocol.CharacterAppearance) CharacterAppearance {
	out := CharacterAppearance{
		Body: CharacterBodyAppearance{
			Height:             appearance.Body.Height,
			HeadWidth:          appearance.Body.HeadWidth,
			HeadSideWidth:      appearance.Body.HeadSideWidth,
			FrontShoulderWidth: appearance.Body.FrontShoulderWidth,
			SideWidth:          appearance.Body.SideWidth,
			ChestWidth:         appearance.Body.ChestWidth,
			WaistWidth:         appearance.Body.WaistWidth,
			HipWidth:           appearance.Body.HipWidth,
			TorsoHeight:        appearance.Body.TorsoHeight,
			UpperArmWidth:      appearance.Body.UpperArmWidth,
			UpperArmSideWidth:  appearance.Body.UpperArmSideWidth,
			UpperArmLength:     appearance.Body.UpperArmLength,
			ForearmWidth:       appearance.Body.ForearmWidth,
			ForearmSideWidth:   appearance.Body.ForearmSideWidth,
			ForearmLength:      appearance.Body.ForearmLength,
			ThighWidth:         appearance.Body.ThighWidth,
			ThighSideWidth:     appearance.Body.ThighSideWidth,
			ThighLength:        appearance.Body.ThighLength,
			CalfWidth:          appearance.Body.CalfWidth,
			CalfSideWidth:      appearance.Body.CalfSideWidth,
			CalfLength:         appearance.Body.CalfLength,
			ChestDepth:         appearance.Body.ChestDepth,
			WaistDepth:         appearance.Body.WaistDepth,
			HipDepth:           appearance.Body.HipDepth,
			HeadScale:          appearance.Body.HeadScale,
		},
		Style: CharacterStyleAppearance{
			HairStyle: appearance.Style.HairStyle,
		},
		Hair: CharacterHairAppearance{
			Front:   appearance.Hair.Front,
			Back:    appearance.Hair.Back,
			Left:    appearance.Hair.Left,
			Right:   appearance.Hair.Right,
			FrontFg: appearance.Hair.FrontFg,
			BackFg:  appearance.Hair.BackFg,
			LeftFg:  appearance.Hair.LeftFg,
			RightFg: appearance.Hair.RightFg,
		},
		Skeleton: CharacterSkeletonAppearance{
			FrontTorso: appearance.Skeleton.FrontTorso,
			BackTorso:  appearance.Skeleton.BackTorso,
			LeftTorso:  appearance.Skeleton.LeftTorso,
			RightTorso: appearance.Skeleton.RightTorso,
		},
		Palette: CharacterPaletteAppearance{
			SkinPrimary:  appearance.Palette.SkinPrimary,
			SkinShadow:   appearance.Palette.SkinShadow,
			HairPrimary:  appearance.Palette.HairPrimary,
			HairShadow:   appearance.Palette.HairShadow,
			ClothPrimary: appearance.Palette.ClothPrimary,
			ClothShadow:  appearance.Palette.ClothShadow,
			MetalPrimary: appearance.Palette.MetalPrimary,
			MetalShadow:  appearance.Palette.MetalShadow,
		},
	}
	normalizeDomainAppearanceDefaults(&out)
	return out
}

func normalizeDomainAppearanceDefaults(appearance *CharacterAppearance) {
	defaults := defaultCharacterAppearance().Body
	body := &appearance.Body
	if body.HeadWidth == 0 {
		body.HeadWidth = defaults.HeadWidth
	}
	if body.HeadSideWidth == 0 {
		body.HeadSideWidth = defaults.HeadSideWidth
	}
	if body.UpperArmSideWidth == 0 {
		body.UpperArmSideWidth = body.UpperArmWidth
	}
	if body.ForearmSideWidth == 0 {
		body.ForearmSideWidth = body.ForearmWidth
	}
	if body.ThighSideWidth == 0 {
		body.ThighSideWidth = body.ThighWidth
	}
	if body.CalfSideWidth == 0 {
		body.CalfSideWidth = body.CalfWidth
	}
}
