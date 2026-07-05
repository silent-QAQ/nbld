package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"nbld/server/internal/protocol"
)

func TestGuestLoginEnterWorldMoveAndState(t *testing.T) {
	server := NewServer(":0", "test-instance")
	mux := server.routes()

	health := performJSONRequest[protocol.HealthzResponse](
		t,
		mux,
		http.MethodGet,
		"/healthz",
		nil,
		http.StatusOK,
	)
	if health.Status == "" || health.Checks["accountStore"].Status == "" || health.Checks["onlineStore"].Status == "" {
		t.Fatal("expected health checks for account and online stores")
	}

	loginResp := performJSONRequest[protocol.GuestLoginResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/session/guest",
		protocol.GuestLoginRequest{DeviceID: "test-device"},
		http.StatusOK,
	)

	if loginResp.PlayerID == "" || loginResp.Token == "" {
		t.Fatal("expected playerId and token to be returned")
	}

	enterResp := performJSONRequest[protocol.EnterWorldResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/world/enter",
		protocol.EnterWorldRequest{Token: loginResp.Token},
		http.StatusOK,
	)

	if enterResp.PlayerID != loginResp.PlayerID {
		t.Fatalf("expected enter world playerId %q, got %q", loginResp.PlayerID, enterResp.PlayerID)
	}

	moveResp := performJSONRequest[protocol.MoveResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/world/move",
		protocol.MoveRequest{
			Token: loginResp.Token,
			Position: protocol.Position{
				X: 7.5,
				Y: -2.25,
			},
		},
		http.StatusOK,
	)

	if moveResp.Position.X != 7.5 || moveResp.Position.Y != -2.25 {
		t.Fatalf("unexpected move response position: %+v", moveResp.Position)
	}
	if moveResp.MapID == "" {
		t.Fatal("expected move response mapId")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/world/state?token="+loginResp.Token, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected world state status 200, got %d", rec.Code)
	}

	var worldState protocol.WorldStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &worldState); err != nil {
		t.Fatalf("decode world state: %v", err)
	}

	if worldState.PlayerID != loginResp.PlayerID {
		t.Fatalf("expected world state playerId %q, got %q", loginResp.PlayerID, worldState.PlayerID)
	}
	if len(worldState.Players) != 1 {
		t.Fatalf("expected 1 player in world state, got %d", len(worldState.Players))
	}
	if worldState.Position.X != 7.5 || worldState.Position.Y != -2.25 {
		t.Fatalf("unexpected world state position: %+v", worldState.Position)
	}
	if worldState.MapID == "" {
		t.Fatal("expected world state mapId")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/world/chunks?token="+loginResp.Token, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected chunk window status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var chunkWindow protocol.ChunkWindowResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &chunkWindow); err != nil {
		t.Fatalf("decode chunk window: %v", err)
	}
	if len(chunkWindow.Chunks) != 9 {
		t.Fatalf("expected 9 chunks in 3x3 window, got %d", len(chunkWindow.Chunks))
	}
	if len(chunkWindow.Chunks[0].Tiles) != 80*80 {
		t.Fatalf("expected 80x80 tiles per chunk, got %d", len(chunkWindow.Chunks[0].Tiles))
	}
}

func TestRegisterLoginCharacterFlow(t *testing.T) {
	server := NewServer(":0", "test-instance")
	mux := server.routes()

	registerResp := performJSONRequest[protocol.RegisterResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/session/register",
		protocol.RegisterRequest{
			Email:           "player@example.com",
			Username:        "player_one",
			Password:        "secret123",
			ConfirmPassword: "secret123",
		},
		http.StatusCreated,
	)

	if registerResp.AccountID == "" {
		t.Fatal("expected accountId from register")
	}

	loginResp := performJSONRequest[protocol.LoginResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/session/login",
		protocol.LoginRequest{
			Email:    "player@example.com",
			Password: "secret123",
		},
		http.StatusOK,
	)

	createResp := performJSONRequest[protocol.CharacterMutationResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/characters/create",
		protocol.CreateCharacterRequest{
			Token: loginResp.Token,
			Name:  "Knight",
		},
		http.StatusCreated,
	)

	if createResp.Character.ID == "" {
		t.Fatal("expected created character id")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/characters?token="+loginResp.Token, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected character list status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var roster protocol.CharacterListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &roster); err != nil {
		t.Fatalf("decode character roster: %v", err)
	}
	if len(roster.Active) != 1 {
		t.Fatalf("expected 1 active character, got %d", len(roster.Active))
	}

	enterResp := performJSONRequest[protocol.EnterWorldResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/world/enter",
		protocol.EnterWorldRequest{
			Token:       loginResp.Token,
			CharacterID: createResp.Character.ID,
		},
		http.StatusOK,
	)

	if enterResp.CharacterID != createResp.Character.ID {
		t.Fatalf("expected character id %q, got %q", createResp.Character.ID, enterResp.CharacterID)
	}

	moveResp := performJSONRequest[protocol.MoveResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/world/move",
		protocol.MoveRequest{
			Token: loginResp.Token,
			Position: protocol.Position{
				X: 12.5,
				Y: 9.25,
			},
		},
		http.StatusOK,
	)

	if moveResp.CharacterID != createResp.Character.ID {
		t.Fatalf("expected moved character id %q, got %q", createResp.Character.ID, moveResp.CharacterID)
	}

	statsResp := performJSONRequest[protocol.CharacterMutationResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/characters/stats",
		protocol.UpdateCharacterStatsRequest{
			Token:       loginResp.Token,
			CharacterID: createResp.Character.ID,
			Stats: protocol.CharacterStats{
				Base: protocol.CharacterBaseStats{
					Health:    150,
					Stamina:   90,
					Mana:      80,
					MoveSpeed: 7,
				},
				Attack: protocol.CharacterAttackStats{
					PhysicalAttack:  20,
					SpellAttack:     18,
					PhysicalCrit:    6,
					SpellCrit:       7,
					DamageBonus:     2,
					CritDamageBonus: 3,
					BonusDamage:     4,
				},
				Defense: protocol.CharacterDefenseStats{
					PhysicalDefense:  11,
					SpellDefense:     12,
					CritResistance:   2,
					DamageMitigation: 1,
					BonusMitigation:  1,
				},
			},
		},
		http.StatusOK,
	)

	if statsResp.Character.Stats.Base.Health != 150 {
		t.Fatalf("expected updated health 150, got %d", statsResp.Character.Stats.Base.Health)
	}

	inventoryResp := performJSONRequest[protocol.CharacterMutationResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/characters/inventory",
		protocol.UpdateCharacterInventoryRequest{
			Token:       loginResp.Token,
			CharacterID: createResp.Character.ID,
			Inventory: protocol.ItemContainer{
				Items: []protocol.ItemStack{
					{ItemID: "potion_hp_small", Quantity: 3},
				},
			},
		},
		http.StatusOK,
	)

	if len(inventoryResp.Character.Inventory.Items) != 1 {
		t.Fatalf("expected 1 inventory item, got %d", len(inventoryResp.Character.Inventory.Items))
	}

	equipmentResp := performJSONRequest[protocol.CharacterMutationResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/characters/equipment",
		protocol.UpdateCharacterEquipmentRequest{
			Token:       loginResp.Token,
			CharacterID: createResp.Character.ID,
			Equipment: protocol.CharacterEquipment{
				MainHand:  "weapon_sword_001",
				Helmet:    "helm_001",
				Chest:     "armor_001",
				Pants:     "pants_001",
				Shoes:     "shoes_001",
				Shoulders: "shoulders_001",
			},
		},
		http.StatusOK,
	)

	if equipmentResp.Character.Equipment.MainHand != "weapon_sword_001" {
		t.Fatalf("expected main hand weapon_sword_001, got %q", equipmentResp.Character.Equipment.MainHand)
	}
	if equipmentResp.Character.Equipment.VisibleArmor.Helmet != "helm_001" {
		t.Fatalf("expected visible helmet helm_001, got %q", equipmentResp.Character.Equipment.VisibleArmor.Helmet)
	}

	leaveResp := performJSONRequest[protocol.LeaveWorldResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/world/leave",
		protocol.LeaveWorldRequest{
			Token: loginResp.Token,
		},
		http.StatusOK,
	)

	if leaveResp.Status != "left_world" {
		t.Fatalf("expected leave status left_world, got %q", leaveResp.Status)
	}

	performJSONRequest[protocol.MoveResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/world/move",
		protocol.MoveRequest{
			Token: loginResp.Token,
			Position: protocol.Position{
				X: 1,
				Y: 1,
			},
		},
		http.StatusUnauthorized,
	)

	deleteResp := performJSONRequest[protocol.DeleteCharacterResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/characters/delete",
		protocol.DeleteCharacterRequest{
			Token: performJSONRequest[protocol.LoginResponse](
				t,
				mux,
				http.MethodPost,
				"/api/v1/session/login",
				protocol.LoginRequest{
					Email:    "player@example.com",
					Password: "secret123",
				},
				http.StatusOK,
			).Token,
			CharacterID: createResp.Character.ID,
		},
		http.StatusOK,
	)

	if deleteResp.Character.DeletedAt == "" || deleteResp.Character.PurgeAt == "" {
		t.Fatal("expected deleted character timestamps")
	}
}

func TestCharacterLimitEnforced(t *testing.T) {
	server := NewServer(":0", "test-instance")
	mux := server.routes()

	loginResp := performJSONRequest[protocol.LoginResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/session/login",
		mustRegisterAndLogin(t, mux, "limit@example.com", "limit_user"),
		http.StatusOK,
	)

	for i := 0; i < maxActiveCharacters; i++ {
		performJSONRequest[protocol.CharacterMutationResponse](
			t,
			mux,
			http.MethodPost,
			"/api/v1/characters/create",
			protocol.CreateCharacterRequest{
				Token: loginResp.Token,
				Name:  string(rune('A'+i)) + "Hero",
			},
			http.StatusCreated,
		)
	}

	performJSONRequest[protocol.CharacterMutationResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/characters/create",
		protocol.CreateCharacterRequest{
			Token: loginResp.Token,
			Name:  "Overflow",
		},
		http.StatusConflict,
	)
}

func TestDeletedCharacterLimitPurgesOldest(t *testing.T) {
	server := NewServer(":0", "test-instance")
	mux := server.routes()

	loginResp := performJSONRequest[protocol.LoginResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/session/login",
		mustRegisterAndLogin(t, mux, "deleted-limit@example.com", "deleted_limit"),
		http.StatusOK,
	)

	created := make([]protocol.CharacterSummary, 0, maxDeletedCharacters+1)
	for i := 0; i < maxDeletedCharacters+1; i++ {
		resp := performJSONRequest[protocol.CharacterMutationResponse](
			t,
			mux,
			http.MethodPost,
			"/api/v1/characters/create",
			protocol.CreateCharacterRequest{
				Token: loginResp.Token,
				Name:  string(rune('A'+i)) + "Deleted",
			},
			http.StatusCreated,
		)
		created = append(created, resp.Character)
	}

	for _, character := range created {
		performJSONRequest[protocol.DeleteCharacterResponse](
			t,
			mux,
			http.MethodPost,
			"/api/v1/characters/delete",
			protocol.DeleteCharacterRequest{
				Token:       loginResp.Token,
				CharacterID: character.ID,
			},
			http.StatusOK,
		)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/characters?token="+loginResp.Token, nil)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d, body=%s", http.StatusOK, listRec.Code, listRec.Body.String())
	}
	var listResp protocol.CharacterListResponse
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode character list: %v", err)
	}
	if len(listResp.Deleted) != maxDeletedCharacters {
		t.Fatalf("expected %d deleted characters, got %d", maxDeletedCharacters, len(listResp.Deleted))
	}
	for _, character := range listResp.Deleted {
		if character.ID == created[0].ID {
			t.Fatalf("expected oldest deleted character %q to be purged", created[0].ID)
		}
	}
}

func TestInvalidTokenRejected(t *testing.T) {
	server := NewServer(":0", "test-instance")
	mux := server.routes()

	performJSONRequest[protocol.MoveResponse](
		t,
		mux,
		http.MethodPost,
		"/api/v1/world/move",
		protocol.MoveRequest{
			Token: "bad-token",
			Position: protocol.Position{
				X: 1,
				Y: 1,
			},
		},
		http.StatusUnauthorized,
	)
}

func TestCharacterStatsDerivedSnapshot(t *testing.T) {
	stats := defaultCharacterStats()

	if stats.Metadata.SchemaVersion == 0 {
		t.Fatal("expected stats schema version")
	}
	if stats.Combat.Resources.HealthMax != 100 {
		t.Fatalf("expected health max 100, got %d", stats.Combat.Resources.HealthMax)
	}
	if stats.Combat.MagicAttack != 10 {
		t.Fatalf("expected magic attack 10, got %d", stats.Combat.MagicAttack)
	}
	if stats.Derived.CombatStats[AttributePhysicalAttack] != 10 {
		t.Fatalf("expected physical attack attribute 10, got %.2f", stats.Derived.CombatStats[AttributePhysicalAttack])
	}
}

func TestEquipmentAndPassiveGemHealthIgnored(t *testing.T) {
	stats := defaultCharacterStats()
	stats.Sources.Equipment[AttributeHealth] = 999
	stats.Sources.PassiveGem[AttributeHealth] = 500
	stats.Sources.Talent[AttributeHealth] = 25
	stats = NormalizeCharacterStats(stats)

	if stats.Combat.Resources.HealthMax != 125 {
		t.Fatalf("expected only base + talent health, got %d", stats.Combat.Resources.HealthMax)
	}
	if len(stats.Metadata.Warnings) == 0 {
		t.Fatal("expected health source warning")
	}
}

func TestRuntimeStaminaRecoversAfterSprintIntentExpires(t *testing.T) {
	store := newStateStore()
	store.putSession(sessionState{
		PlayerID:  "p1",
		Token:     "token",
		WorldID:   "world-dev-001",
		MapID:     "map_0_0",
		Position:  protocol.Position{X: 0, Y: 0},
		Resources: defaultRuntimeResources(),
	})

	session, ok := store.updateMovement("token", protocol.Position{X: 1, Y: 0}, true)
	if !ok {
		t.Fatal("expected movement update")
	}

	now := time.Now().UTC()
	session.ResourceAt = now.Add(-2 * time.Second)
	session.SprintIntentUntil = now.Add(-1 * time.Second)
	store.sessions["token"] = session

	session, ok = store.getSession("token")
	if !ok {
		t.Fatal("expected session")
	}
	if session.Sprinting {
		t.Fatal("expected sprinting to stop after intent expires")
	}
	if session.Resources.StaminaCurrent >= float64(session.Resources.StaminaMax) {
		t.Fatalf("expected stamina to have been spent, got %.2f/%d", session.Resources.StaminaCurrent, session.Resources.StaminaMax)
	}
	if session.Resources.StaminaCurrent <= 90 {
		t.Fatalf("expected stamina to recover after sprint intent expiry, got %.2f", session.Resources.StaminaCurrent)
	}
}

func mustRegisterAndLogin(t *testing.T, handler http.Handler, email, username string) protocol.LoginRequest {
	t.Helper()

	performJSONRequest[protocol.RegisterResponse](
		t,
		handler,
		http.MethodPost,
		"/api/v1/session/register",
		protocol.RegisterRequest{
			Email:           email,
			Username:        username,
			Password:        "secret123",
			ConfirmPassword: "secret123",
		},
		http.StatusCreated,
	)

	return protocol.LoginRequest{
		Email:    email,
		Password: "secret123",
	}
}

func performJSONRequest[T any](t *testing.T, handler http.Handler, method, path string, body any, expectedStatus int) T {
	t.Helper()

	var payload []byte
	var err error
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != expectedStatus {
		t.Fatalf("expected status %d, got %d, body=%s", expectedStatus, rec.Code, rec.Body.String())
	}

	var zero T
	if rec.Body.Len() == 0 {
		return zero
	}

	if expectedStatus >= 400 {
		return zero
	}

	if err := json.Unmarshal(rec.Body.Bytes(), &zero); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	return zero
}
