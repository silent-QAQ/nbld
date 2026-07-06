package app

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"net/http"
	"time"

	"nbld/server/internal/protocol"
)

// 装饰层交互端点：采集（harvest）与建造放置（place）。
// 地形层（Terrain/Block/Feature）不可修改，两个端点都只读写 tile.Decoration。
// 破坏节奏由客户端进度条驱动，服务端用 LastHarvestAt 按 70% 时长下限节流防刷。

const (
	// harvestRangeTiles 采集许可半径：客户端限制"朝向直线4格+自身格"，
	// 服务端只做宽松的距离上限校验（切比雪夫距离）。
	harvestRangeTiles = 4
	// placeRangeTiles 放置许可半径：以玩家所在格为中心 9x9。
	placeRangeTiles = 4
	// harvestThrottleFactor 两次采集的最小间隔 = 计算时长 × 该系数。
	harvestThrottleFactor = 0.7
)

var (
	ErrDecorationMissing  = errors.New("no decoration at target tile")
	ErrDecorationUnknown  = errors.New("decoration not harvestable")
	ErrToolRequired       = errors.New("tool requirement not met")
	ErrHarvestTooFast     = errors.New("harvest throttled")
	ErrOutOfRange         = errors.New("target out of range")
	ErrTileOccupied       = errors.New("tile already has a decoration")
	ErrTileNotPlaceable   = errors.New("tile cannot hold a building block")
	ErrNotBlockItem       = errors.New("selected item is not a building block")
	ErrTileBlockedByActor = errors.New("a player is standing on target tile")
)

// waterBlocks 是不可放置建造方块的地表水面。
var waterBlocks = map[string]bool{
	"deep_ice_water": true, "ice_water": true, "cold_deep_water": true,
	"shallow_sea_water": true, "open_ocean_water": true, "wave_water": true,
	"tropical_shallow_water": true, "tropical_deep_water": true,
}

// solidGroundBlocks 是不可放置的实心地形块（山体等，本身就不可通行）。
var solidGroundBlocks = map[string]bool{
	"mountain_rock": true, "cliff_rock": true, "glacier_rock": true, "rock": true,
}

func chebyshevDistance(ax, ay, bx, by int) int {
	dx := ax - bx
	if dx < 0 {
		dx = -dx
	}
	dy := ay - by
	if dy < 0 {
		dy = -dy
	}
	if dx > dy {
		return dx
	}
	return dy
}

func occupiedTileOf(position protocol.Position) (int, int) {
	return int(math.Floor(position.X)), int(math.Floor(position.Y))
}

// slotTool 返回槽位上的工具定义；槽位为空或非工具时返回 nil（视为徒手）。
func slotTool(character *Character, slot int) *ItemDefinition {
	if slot < 0 || slot >= len(character.Inventory.Items) {
		return nil
	}
	stack := character.Inventory.Items[slot]
	if stack.ItemID == "" {
		return nil
	}
	def, ok := itemDef(stack.ItemID)
	if !ok || def.Type != ItemTypeTool {
		return nil
	}
	return &def
}

// consumeToolDurability 对槽位工具扣 1 点耐久；耐久归零移除工具。
// 槽位不是工具时为空操作（徒手无损耗）。
func consumeToolDurability(character *Character, slot int) {
	if slot < 0 || slot >= len(character.Inventory.Items) {
		return
	}
	stack := character.Inventory.Items[slot]
	def, ok := itemDef(stack.ItemID)
	if !ok || def.Type != ItemTypeTool || def.MaxDurability <= 0 {
		return
	}
	remaining := def.MaxDurability
	if stack.Durability != nil {
		remaining = *stack.Durability
	}
	remaining--
	if remaining <= 0 {
		character.Inventory.Items[slot] = ItemStack{}
		return
	}
	stack.Durability = &remaining
	character.Inventory.Items[slot] = stack
}

// rollDrops 掷装饰掉落表。
func rollDrops(def DecorationDefinition) []ItemStack {
	drops := make([]ItemStack, 0, len(def.Drops))
	for _, drop := range def.Drops {
		quantity := drop.Min
		if drop.Max > drop.Min {
			quantity += rand.Intn(drop.Max - drop.Min + 1)
		}
		if quantity <= 0 {
			continue
		}
		drops = append(drops, ItemStack{ItemID: drop.ItemID, Quantity: quantity})
	}
	return drops
}

func (s *Server) handleDecorationRegistry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	decorations := make([]protocol.DecorationDefinition, 0, len(decorationDefinitions))
	for _, def := range decorationDefinitions {
		drops := make([]protocol.DecorationDrop, 0, len(def.Drops))
		for _, drop := range def.Drops {
			drops = append(drops, protocol.DecorationDrop{ItemID: drop.ItemID, Min: drop.Min, Max: drop.Max})
		}
		decorations = append(decorations, protocol.DecorationDefinition{
			ID:            def.ID,
			Name:          def.Name,
			Kind:          def.Kind,
			Hardness:      def.Hardness,
			RequiredTool:  def.RequiredTool,
			MinTier:       def.MinTier,
			Blocking:      def.Blocking,
			PreferredTool: def.PreferredTool,
			Drops:         drops,
		})
	}
	writeJSON(w, http.StatusOK, protocol.DecorationRegistryResponse{Decorations: decorations})
}

func (s *Server) handleHarvest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req protocol.HarvestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	session, ok := s.state.getSession(req.Token)
	if !ok || session.WorldID == "" {
		http.Error(w, "not in world", http.StatusUnauthorized)
		return
	}

	playerX, playerY := occupiedTileOf(session.Position)
	if chebyshevDistance(playerX, playerY, req.X, req.Y) > harvestRangeTiles {
		http.Error(w, ErrOutOfRange.Error(), http.StatusBadRequest)
		return
	}

	tile, err := s.chunks.tileAt(session.MapID, req.X, req.Y)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if tile.Decoration == "" {
		http.Error(w, ErrDecorationMissing.Error(), http.StatusBadRequest)
		return
	}
	def, known := decorationDef(tile.Decoration)
	if !known {
		http.Error(w, ErrDecorationUnknown.Error(), http.StatusBadRequest)
		return
	}

	// 预读角色算工具与时长（真正扣物品在下面的原子 mutate 里再校验一次）。
	preview, err := s.loadCharacterForWorld(r.Context(), session.AccountID, req.CharacterID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	duration, allowed := harvestDuration(def, slotTool(&preview, req.Slot))
	if !allowed {
		http.Error(w, ErrToolRequired.Error(), http.StatusBadRequest)
		return
	}
	minInterval := time.Duration(duration * harvestThrottleFactor * float64(time.Second))
	if !s.state.markHarvest(req.Token, minInterval) {
		http.Error(w, ErrHarvestTooFast.Error(), http.StatusTooManyRequests)
		return
	}

	drops := rollDrops(def)
	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) error {
		normalizeInventory(&character.Inventory)
		if _, stillAllowed := harvestDuration(def, slotTool(character, req.Slot)); !stillAllowed {
			return ErrToolRequired
		}
		for _, drop := range drops {
			if err := addItemToInventory(&character.Inventory, drop); err != nil {
				return err
			}
		}
		consumeToolDurability(character, req.Slot)
		return nil
	})
	if !ok {
		return
	}

	updated, err := s.chunks.setTileDecoration(session.MapID, req.X, req.Y, "")
	if err != nil {
		writeStoreError(w, err)
		return
	}

	update := protocol.TileUpdate{MapID: session.MapID, X: req.X, Y: req.Y, Decoration: updated.Decoration}
	s.broadcastTileUpdate(session, update)

	writeJSON(w, http.StatusOK, protocol.HarvestResponse{
		Character: toProtocolCharacter(character),
		Drops:     toProtocolItems(drops),
		Tile:      update,
	})
}

func (s *Server) handlePlaceBlock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req protocol.PlaceBlockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}

	session, ok := s.state.getSession(req.Token)
	if !ok || session.WorldID == "" {
		http.Error(w, "not in world", http.StatusUnauthorized)
		return
	}

	playerX, playerY := occupiedTileOf(session.Position)
	if chebyshevDistance(playerX, playerY, req.X, req.Y) > placeRangeTiles {
		http.Error(w, ErrOutOfRange.Error(), http.StatusBadRequest)
		return
	}

	tile, err := s.chunks.tileAt(session.MapID, req.X, req.Y)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if tile.Decoration != "" {
		http.Error(w, ErrTileOccupied.Error(), http.StatusBadRequest)
		return
	}
	if tile.Feature == "river" || waterBlocks[tile.Block] || solidGroundBlocks[tile.Block] {
		http.Error(w, ErrTileNotPlaceable.Error(), http.StatusBadRequest)
		return
	}

	// 先从背包读出建造方块定义（真正扣除在 mutate 里）。
	preview, err := s.loadCharacterForWorld(r.Context(), session.AccountID, req.CharacterID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	var blockDef ItemDefinition
	if req.Slot >= 0 && req.Slot < len(preview.Inventory.Items) {
		if def, exists := itemDef(preview.Inventory.Items[req.Slot].ItemID); exists {
			blockDef = def
		}
	}
	if blockDef.Type != ItemTypeBlock || blockDef.PlacesDecoration == "" {
		http.Error(w, ErrNotBlockItem.Error(), http.StatusBadRequest)
		return
	}
	decoDef, known := decorationDef(blockDef.PlacesDecoration)
	if !known {
		http.Error(w, ErrDecorationUnknown.Error(), http.StatusBadRequest)
		return
	}

	// 阻挡型装饰不可压在任何同图玩家脚下（含自己）。
	if decoDef.Blocking {
		for _, player := range s.state.listSessions() {
			if player.WorldID != session.WorldID || player.MapID != session.MapID {
				continue
			}
			px, py := occupiedTileOf(player.Position)
			if px == req.X && py == req.Y {
				http.Error(w, ErrTileBlockedByActor.Error(), http.StatusBadRequest)
				return
			}
		}
	}

	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) error {
		normalizeInventory(&character.Inventory)
		if req.Slot < 0 || req.Slot >= len(character.Inventory.Items) {
			return ErrInvalidInventorySlot
		}
		stack := character.Inventory.Items[req.Slot]
		if stack.ItemID != blockDef.ID || stack.Quantity <= 0 {
			return ErrNotBlockItem
		}
		stack.Quantity--
		if stack.Quantity == 0 {
			stack = ItemStack{}
		}
		character.Inventory.Items[req.Slot] = stack
		return nil
	})
	if !ok {
		return
	}

	updated, err := s.chunks.setTileDecoration(session.MapID, req.X, req.Y, blockDef.PlacesDecoration)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	update := protocol.TileUpdate{MapID: session.MapID, X: req.X, Y: req.Y, Decoration: updated.Decoration}
	s.broadcastTileUpdate(session, update)

	writeJSON(w, http.StatusOK, protocol.PlaceBlockResponse{
		Character: toProtocolCharacter(character),
		Tile:      update,
	})
}

// broadcastTileUpdate 把装饰层变更推给附近玩家（含操作者本人，客户端幂等应用）。
func (s *Server) broadcastTileUpdate(session sessionState, update protocol.TileUpdate) {
	s.ws.broadcastNearby(session.WorldID, session.MapID, session.Position, protocol.WSServerMessage{
		Type: protocol.MsgServerTileUpdate,
		Tile: &update,
	})
}
