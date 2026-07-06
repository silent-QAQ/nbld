package app

import (
	"net/http"
	"testing"
	"time"

	"nbld/server/internal/protocol"
)

// interactTestSeed 原点即温带平原陆地（seed=1 时 pickBiome(0,0)=temperate_plains），
// findPlaceableTile 无需远距离搜索。
const interactTestSeed = int64(1)

// newInteractTestServer 构建使用临时目录做区块持久化的服务端，
// 避免测试把区块 JSON 写进仓库工作区。
func newInteractTestServer(t *testing.T) *Server {
	t.Helper()
	server := NewServer(":0", "test-instance")
	seed := interactTestSeed
	server.chunks = newWorldChunkManager(t.TempDir(), &goChunkGenerator{seed: &seed}, &seed)
	return server
}

// findPlaceableTile 在原点附近找一格可放置的空地（非水/山体/河流且无装饰）。
func findPlaceableTile(t *testing.T, server *Server) (int, int) {
	t.Helper()
	for radius := 0; radius < 2000; radius += 40 {
		for y := radius; y < radius+40; y++ {
			for x := radius; x < radius+40; x++ {
				tile, err := server.chunks.tileAt("map_0_0", x, y)
				if err != nil {
					t.Fatalf("tileAt(%d,%d): %v", x, y, err)
				}
				if tile.Decoration != "" || tile.Feature == "river" {
					continue
				}
				if waterBlocks[tile.Block] || solidGroundBlocks[tile.Block] {
					continue
				}
				return x, y
			}
		}
	}
	t.Fatal("no placeable tile found near origin")
	return 0, 0
}

// resetHarvestThrottle 清空会话的采集节流时间，测试无需真实等待。
func resetHarvestThrottle(server *Server, token string) {
	server.state.mu.Lock()
	defer server.state.mu.Unlock()
	session, ok := server.state.sessions[token]
	if !ok {
		return
	}
	session.LastHarvestAt = time.Time{}
	server.state.sessions[token] = session
}

// setupWorldCharacter 注册账号、建角色、进入世界并移动到目标附近，返回 token 与角色ID。
func setupWorldCharacter(t *testing.T, server *Server, mux http.Handler, email, username string, tileX, tileY int) (string, string) {
	t.Helper()
	loginResp := performJSONRequest[protocol.LoginResponse](
		t, mux, http.MethodPost, "/api/v1/session/login",
		mustRegisterAndLogin(t, mux, email, username), http.StatusOK,
	)
	created := performJSONRequest[protocol.CharacterMutationResponse](
		t, mux, http.MethodPost, "/api/v1/characters/create",
		protocol.CreateCharacterRequest{Token: loginResp.Token, Name: "Digger" + username[:2]},
		http.StatusCreated,
	)
	performJSONRequest[protocol.EnterWorldResponse](
		t, mux, http.MethodPost, "/api/v1/world/enter",
		protocol.EnterWorldRequest{Token: loginResp.Token, CharacterID: created.Character.ID},
		http.StatusOK,
	)
	performJSONRequest[protocol.MoveResponse](
		t, mux, http.MethodPost, "/api/v1/world/move",
		protocol.MoveRequest{Token: loginResp.Token, Position: protocol.Position{X: float64(tileX) + 0.5, Y: float64(tileY) + 0.5}},
		http.StatusOK,
	)
	return loginResp.Token, created.Character.ID
}

func TestHarvestDecorationFlow(t *testing.T) {
	server := newInteractTestServer(t)
	mux := server.routes()

	targetX, targetY := findPlaceableTile(t, server)
	token, characterID := setupWorldCharacter(t, server, mux, "harvest@example.com", "harvester", targetX, targetY)

	// 在玩家旁边种一丛草（徒手可采）。
	if _, err := server.chunks.setTileDecoration("map_0_0", targetX+1, targetY, "grass_tuft"); err != nil {
		t.Fatalf("plant grass: %v", err)
	}

	harvestResp := performJSONRequest[protocol.HarvestResponse](
		t, mux, http.MethodPost, "/api/v1/world/harvest",
		protocol.HarvestRequest{Token: token, CharacterID: characterID, X: targetX + 1, Y: targetY, Slot: 0},
		http.StatusOK,
	)
	if harvestResp.Tile.Decoration != "" {
		t.Fatalf("expected decoration removed, got %q", harvestResp.Tile.Decoration)
	}
	if len(harvestResp.Drops) == 0 || harvestResp.Drops[0].ItemID != "item_fiber" {
		t.Fatalf("expected fiber drops, got %+v", harvestResp.Drops)
	}
	fiberCount := 0
	for _, stack := range harvestResp.Character.Inventory.Items {
		if stack.ItemID == "item_fiber" {
			fiberCount += stack.Quantity
		}
	}
	if fiberCount == 0 {
		t.Fatal("fiber not added to inventory")
	}

	// 空格再采：应报无装饰。
	performJSONRequest[struct{}](
		t, mux, http.MethodPost, "/api/v1/world/harvest",
		protocol.HarvestRequest{Token: token, CharacterID: characterID, X: targetX + 1, Y: targetY, Slot: 0},
		http.StatusBadRequest,
	)

	// 种一棵树：徒手采集应被拒（需要斧头）。
	if _, err := server.chunks.setTileDecoration("map_0_0", targetX+1, targetY, "tree_deciduous"); err != nil {
		t.Fatalf("plant tree: %v", err)
	}
	performJSONRequest[struct{}](
		t, mux, http.MethodPost, "/api/v1/world/harvest",
		protocol.HarvestRequest{Token: token, CharacterID: characterID, X: targetX + 1, Y: targetY, Slot: 0},
		http.StatusBadRequest,
	)

	// 发木斧（进入首个空槽 5），砍树成功并扣 1 点耐久。
	giveResp := performJSONRequest[protocol.CharacterMutationResponse](
		t, mux, http.MethodPost, "/api/v1/debug/give",
		protocol.GiveItemRequest{Token: token, CharacterID: characterID, ItemID: "tool_wood_axe", Quantity: 1},
		http.StatusOK,
	)
	axeSlot := -1
	for index, stack := range giveResp.Character.Inventory.Items {
		if stack.ItemID == "tool_wood_axe" {
			axeSlot = index
			break
		}
	}
	if axeSlot < 0 {
		t.Fatal("axe not found in inventory")
	}

	resetHarvestThrottle(server, token)
	treeResp := performJSONRequest[protocol.HarvestResponse](
		t, mux, http.MethodPost, "/api/v1/world/harvest",
		protocol.HarvestRequest{Token: token, CharacterID: characterID, X: targetX + 1, Y: targetY, Slot: axeSlot},
		http.StatusOK,
	)
	gotLogs := false
	for _, drop := range treeResp.Drops {
		if drop.ItemID == "item_wood_log" && drop.Quantity >= 2 {
			gotLogs = true
		}
	}
	if !gotLogs {
		t.Fatalf("expected wood log drops, got %+v", treeResp.Drops)
	}
	axeStack := treeResp.Character.Inventory.Items[axeSlot]
	if axeStack.ItemID != "tool_wood_axe" || axeStack.Durability == nil || *axeStack.Durability != 59 {
		t.Fatalf("expected axe durability 59, got %+v", axeStack)
	}

	// 立刻再采（树已消失后再种上）：节流应拒绝。
	if _, err := server.chunks.setTileDecoration("map_0_0", targetX+1, targetY, "grass_tuft"); err != nil {
		t.Fatalf("replant grass: %v", err)
	}
	performJSONRequest[struct{}](
		t, mux, http.MethodPost, "/api/v1/world/harvest",
		protocol.HarvestRequest{Token: token, CharacterID: characterID, X: targetX + 1, Y: targetY, Slot: 0},
		http.StatusTooManyRequests,
	)

	// 超出范围（距离 > 4）应拒绝。
	resetHarvestThrottle(server, token)
	performJSONRequest[struct{}](
		t, mux, http.MethodPost, "/api/v1/world/harvest",
		protocol.HarvestRequest{Token: token, CharacterID: characterID, X: targetX + 20, Y: targetY, Slot: 0},
		http.StatusBadRequest,
	)
}

func TestPlaceBlockFlow(t *testing.T) {
	server := newInteractTestServer(t)
	mux := server.routes()

	playerX, playerY := findPlaceableTile(t, server)
	token, characterID := setupWorldCharacter(t, server, mux, "place@example.com", "placer", playerX, playerY)

	// 找玩家附近另一格可放置的空地（不能是玩家脚下）；带装饰的格子先清空。
	// 注意瓦片坐标可为负，需用独立 found 标志而非坐标哨兵。
	targetX, targetY, foundTarget := 0, 0, false
	for dy := -3; dy <= 3 && !foundTarget; dy++ {
		for dx := -3; dx <= 3; dx++ {
			if dx == 0 && dy == 0 {
				continue
			}
			tile, err := server.chunks.tileAt("map_0_0", playerX+dx, playerY+dy)
			if err != nil {
				continue
			}
			if tile.Feature == "river" || waterBlocks[tile.Block] || solidGroundBlocks[tile.Block] {
				continue
			}
			if tile.Decoration != "" {
				if _, err := server.chunks.setTileDecoration("map_0_0", playerX+dx, playerY+dy, ""); err != nil {
					continue
				}
			}
			targetX, targetY, foundTarget = playerX+dx, playerY+dy, true
			break
		}
	}
	if !foundTarget {
		t.Fatal("no empty neighbor tile for placement")
	}

	giveResp := performJSONRequest[protocol.CharacterMutationResponse](
		t, mux, http.MethodPost, "/api/v1/debug/give",
		protocol.GiveItemRequest{Token: token, CharacterID: characterID, ItemID: "block_wood_fence", Quantity: 2},
		http.StatusOK,
	)
	fenceSlot := -1
	for index, stack := range giveResp.Character.Inventory.Items {
		if stack.ItemID == "block_wood_fence" {
			fenceSlot = index
			break
		}
	}
	if fenceSlot < 0 {
		t.Fatal("fence not found in inventory")
	}

	placeResp := performJSONRequest[protocol.PlaceBlockResponse](
		t, mux, http.MethodPost, "/api/v1/world/place",
		protocol.PlaceBlockRequest{Token: token, CharacterID: characterID, X: targetX, Y: targetY, Slot: fenceSlot},
		http.StatusOK,
	)
	if placeResp.Tile.Decoration != "deco_wood_fence" {
		t.Fatalf("expected deco_wood_fence, got %q", placeResp.Tile.Decoration)
	}
	if placeResp.Character.Inventory.Items[fenceSlot].Quantity != 1 {
		t.Fatalf("expected 1 fence left, got %+v", placeResp.Character.Inventory.Items[fenceSlot])
	}

	// 同一格重复放置：应报占用。
	performJSONRequest[struct{}](
		t, mux, http.MethodPost, "/api/v1/world/place",
		protocol.PlaceBlockRequest{Token: token, CharacterID: characterID, X: targetX, Y: targetY, Slot: fenceSlot},
		http.StatusBadRequest,
	)

	// 玩家脚下放阻挡型建筑：应被拒。
	performJSONRequest[struct{}](
		t, mux, http.MethodPost, "/api/v1/world/place",
		protocol.PlaceBlockRequest{Token: token, CharacterID: characterID, X: playerX, Y: playerY, Slot: fenceSlot},
		http.StatusBadRequest,
	)

	// 放下的栅栏可以徒手拆回物品。
	resetHarvestThrottle(server, token)
	harvestResp := performJSONRequest[protocol.HarvestResponse](
		t, mux, http.MethodPost, "/api/v1/world/harvest",
		protocol.HarvestRequest{Token: token, CharacterID: characterID, X: targetX, Y: targetY, Slot: 0},
		http.StatusOK,
	)
	if len(harvestResp.Drops) != 1 || harvestResp.Drops[0].ItemID != "block_wood_fence" {
		t.Fatalf("expected fence drop, got %+v", harvestResp.Drops)
	}
}

func TestSetTileDecorationPersistsAcrossReload(t *testing.T) {
	dataRoot := t.TempDir()
	seed := interactTestSeed
	manager := newWorldChunkManager(dataRoot, &goChunkGenerator{seed: &seed}, &seed)

	tile, err := manager.setTileDecoration("map_0_0", 5, 7, "deco_stone_wall")
	if err != nil {
		t.Fatalf("setTileDecoration: %v", err)
	}
	if tile.Decoration != "deco_stone_wall" {
		t.Fatalf("expected decoration set, got %q", tile.Decoration)
	}

	// 卸载后重新加载：DeltaTiles 应把装饰恢复到基础地形之上。
	coord := protocol.ChunkCoord{MapID: "map_0_0", ChunkX: 0, ChunkY: 0}
	manager.mu.Lock()
	if err := manager.unloadChunk(coord); err != nil {
		manager.mu.Unlock()
		t.Fatalf("unloadChunk: %v", err)
	}
	manager.mu.Unlock()

	reloaded, err := manager.tileAt("map_0_0", 5, 7)
	if err != nil {
		t.Fatalf("tileAt after reload: %v", err)
	}
	if reloaded.Decoration != "deco_stone_wall" {
		t.Fatalf("decoration lost after reload, got %q", reloaded.Decoration)
	}
	if reloaded.Terrain == "" || reloaded.Block == "" {
		t.Fatalf("terrain layer should be regenerated, got %+v", reloaded)
	}
}
