package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
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

	session, ok := store.updateMovement("token", protocol.Position{X: 1, Y: 0}, true, "front")
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

func TestRuntimeStaminaDrainsWhileSprintIntentContinues(t *testing.T) {
	store := newStateStore()
	store.putSession(sessionState{
		PlayerID:  "p1",
		Token:     "token",
		WorldID:   "world-dev-001",
		MapID:     "map_0_0",
		Position:  protocol.Position{X: 0, Y: 0},
		Resources: defaultRuntimeResources(),
	})

	session, ok := store.updateMovement("token", protocol.Position{X: 1, Y: 0}, true, "front")
	if !ok {
		t.Fatal("expected movement update")
	}

	now := time.Now().UTC()
	session.ResourceAt = now.Add(-500 * time.Millisecond)
	session.SprintIntentUntil = now.Add(500 * time.Millisecond)
	store.sessions["token"] = session

	session, ok = store.updateMovement("token", protocol.Position{X: 2, Y: 0}, true, "front")
	if !ok {
		t.Fatal("expected movement update")
	}
	if !session.Sprinting {
		t.Fatal("expected sprinting to remain active")
	}
	if session.Resources.StaminaCurrent >= float64(session.Resources.StaminaMax) {
		t.Fatalf("expected stamina to drain while sprinting, got %.2f/%d", session.Resources.StaminaCurrent, session.Resources.StaminaMax)
	}
}

func TestWSHubBroadcastNearbyUsesThreeByThreeChunks(t *testing.T) {
	hub := newWSHub()
	near := &wsClient{
		worldID:  "world",
		mapID:    "map_0_0",
		position: protocol.Position{X: 80, Y: 80},
		send:     make(chan protocol.WSServerMessage, 1),
	}
	far := &wsClient{
		worldID:  "world",
		mapID:    "map_0_0",
		position: protocol.Position{X: 240, Y: 80},
		send:     make(chan protocol.WSServerMessage, 1),
	}
	otherMap := &wsClient{
		worldID:  "world",
		mapID:    "map_1_0",
		position: protocol.Position{X: 80, Y: 80},
		send:     make(chan protocol.WSServerMessage, 1),
	}
	hub.add(near)
	hub.add(far)
	hub.add(otherMap)

	hub.broadcastNearby("world", "map_0_0", protocol.Position{X: 0, Y: 0}, protocol.WSServerMessage{Type: "player_moved"})

	select {
	case <-near.send:
	default:
		t.Fatal("expected nearby client to receive broadcast")
	}
	select {
	case <-far.send:
		t.Fatal("expected far client to be filtered")
	default:
	}
	select {
	case <-otherMap.send:
		t.Fatal("expected other map client to be filtered")
	default:
	}
}

// snapshotViewerFor builds a viewerSnapshot bound to a fresh wsClient for the
// given player at a position, seeded with an empty aoi.
func snapshotViewerFor(playerID, worldID, mapID string, pos protocol.Position) viewerSnapshot {
	client := &wsClient{
		playerID: playerID,
		worldID:  worldID,
		mapID:    mapID,
		position: pos,
		aoi:      make(map[string]*aoiEntry),
	}
	return viewerSnapshot{client: client, worldID: worldID, mapID: mapID, position: pos}
}

func seedSession(store *stateStore, playerID, token string, pos protocol.Position, facing string) {
	store.putSession(sessionState{
		PlayerID:  playerID,
		Token:     token,
		WorldID:   "world",
		MapID:     "map_0_0",
		Position:  pos,
		Facing:    facing,
		Resources: defaultRuntimeResources(),
	})
}

func TestSnapshotEnteredThenMovedThenLeft(t *testing.T) {
	store := newStateStore()
	seedSession(store, "viewer", "t-viewer", protocol.Position{X: 0, Y: 0}, "front")
	seedSession(store, "peer", "t-peer", protocol.Position{X: 5, Y: 5}, "right")

	viewer := snapshotViewerFor("viewer", "world", "map_0_0", protocol.Position{X: 0, Y: 0})

	// Tick 1: peer is newly visible -> entered with full appearance/equipment.
	msg, ok := buildSnapshotFor(viewer, 1, store.snapshotWorld())
	if !ok {
		t.Fatal("expected a snapshot on first tick")
	}
	if len(msg.Entered) != 1 || msg.Entered[0].PlayerID != "peer" {
		t.Fatalf("expected peer in entered, got %+v", msg.Entered)
	}
	if len(msg.Moved) != 0 {
		t.Fatalf("expected no moved on first sight, got %+v", msg.Moved)
	}

	// Tick 2: peer still visible and near -> slim moved, no re-entered.
	msg, ok = buildSnapshotFor(viewer, 2, store.snapshotWorld())
	if !ok {
		t.Fatal("expected a snapshot on tick 2")
	}
	if len(msg.Entered) != 0 {
		t.Fatalf("expected no entered on tick 2, got %+v", msg.Entered)
	}
	if len(msg.Moved) != 1 || msg.Moved[0].PlayerID != "peer" {
		t.Fatalf("expected peer in moved, got %+v", msg.Moved)
	}
	if msg.Moved[0].Facing != "right" {
		t.Fatalf("expected near-tier slim to carry facing, got %q", msg.Moved[0].Facing)
	}

	// Peer walks far out of AOI (3x3 chunks = 80 tiles each) -> left.
	seedSession(store, "peer", "t-peer", protocol.Position{X: 5000, Y: 5000}, "right")
	msg, ok = buildSnapshotFor(viewer, 3, store.snapshotWorld())
	if !ok {
		t.Fatal("expected a snapshot on tick 3")
	}
	if len(msg.Left) != 1 || msg.Left[0] != "peer" {
		t.Fatalf("expected peer in left, got %+v", msg.Left)
	}
	if _, still := viewer.client.aoi["peer"]; still {
		t.Fatal("expected peer removed from aoi after leaving")
	}
}

func TestSnapshotSelfCarriesStamina(t *testing.T) {
	store := newStateStore()
	seedSession(store, "viewer", "t-viewer", protocol.Position{X: 0, Y: 0}, "front")

	viewer := snapshotViewerFor("viewer", "world", "map_0_0", protocol.Position{X: 0, Y: 0})
	msg, ok := buildSnapshotFor(viewer, 1, store.snapshotWorld())
	if !ok {
		t.Fatal("expected a snapshot carrying self even with no peers")
	}
	if msg.Self == nil {
		t.Fatal("expected self state in snapshot")
	}
	if msg.Self.StaminaCurrent <= 0 {
		t.Fatalf("expected positive self stamina, got %d", msg.Self.StaminaCurrent)
	}
}

func TestSnapshotSelfSerializesZeroStamina(t *testing.T) {
	message := protocol.WSServerMessage{
		Type: "world_snapshot",
		Self: &protocol.SnapshotSelf{
			MapID:          "map_0_0",
			Position:       protocol.Position{X: 1, Y: 2},
			StaminaCurrent: 0,
		},
	}

	data, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if !strings.Contains(string(data), `"staminaCurrent":0`) {
		t.Fatalf("expected zero stamina to be serialized, got %s", string(data))
	}
}

func TestSnapshotMidTierThrottlesAndTrims(t *testing.T) {
	store := newStateStore()
	seedSession(store, "viewer", "t-viewer", protocol.Position{X: 0, Y: 0}, "front")
	// Mid tier: 40 < distance <= 100 tiles, still inside 3x3 chunk AOI.
	seedSession(store, "peer", "t-peer", protocol.Position{X: 60, Y: 0}, "left")

	viewer := snapshotViewerFor("viewer", "world", "map_0_0", protocol.Position{X: 0, Y: 0})

	// Tick 1: entered.
	if _, ok := buildSnapshotFor(viewer, 1, store.snapshotWorld()); !ok {
		t.Fatal("expected entered snapshot")
	}
	// Tick 2: mid tier updates every 2 ticks, so tick 2 (1 since entered) is throttled.
	msg, ok := buildSnapshotFor(viewer, 2, store.snapshotWorld())
	if ok && len(msg.Moved) != 0 {
		t.Fatalf("expected mid-tier peer throttled on tick 2, got moved %+v", msg.Moved)
	}
	// Tick 3: 2 ticks since entered -> update, position only + facing, no stamina.
	msg, ok = buildSnapshotFor(viewer, 3, store.snapshotWorld())
	if !ok || len(msg.Moved) != 1 {
		t.Fatalf("expected mid-tier update on tick 3, got %+v", msg)
	}
	if msg.Moved[0].StaminaCurrent != 0 {
		t.Fatalf("expected mid-tier slim to drop stamina, got %d", msg.Moved[0].StaminaCurrent)
	}
	if msg.Moved[0].Facing != "left" {
		t.Fatalf("expected mid-tier slim to keep facing, got %q", msg.Moved[0].Facing)
	}
}

func TestSnapshotVisibleCapDegradesOverflow(t *testing.T) {
	store := newStateStore()
	seedSession(store, "viewer", "t-viewer", protocol.Position{X: 0, Y: 0}, "front")
	// Seed more than the cap of near peers, all within near tier.
	total := visiblePlayerCap + 5
	for i := 0; i < total; i++ {
		id := "peer-" + strconv.Itoa(i)
		// Spread within ~35 tiles so all are near tier but distinct distances.
		x := float64(i%7) * 5
		y := float64(i/7) * 2
		seedSession(store, id, "t-"+id, protocol.Position{X: x, Y: y}, "front")
	}

	viewer := snapshotViewerFor("viewer", "world", "map_0_0", protocol.Position{X: 0, Y: 0})
	msg, ok := buildSnapshotFor(viewer, 1, store.snapshotWorld())
	if !ok {
		t.Fatal("expected a snapshot")
	}
	if len(msg.Entered) != visiblePlayerCap {
		t.Fatalf("expected exactly %d entered (cap), got %d", visiblePlayerCap, len(msg.Entered))
	}
	// Overflow peers are delivered as base-model slim moves (no appearance).
	if len(msg.Moved) != 5 {
		t.Fatalf("expected 5 overflow peers as slim moves, got %d", len(msg.Moved))
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
