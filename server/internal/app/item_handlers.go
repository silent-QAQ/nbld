package app

import (
	"encoding/json"
	"net/http"

	"nbld/server/internal/protocol"
)

// 物品/配方注册表与背包/装备/合成操作端点。
// 所有变更端点都走 updateCharacterFromRequest（token 校验 + 在线角色存储 +
// NormalizeCharacterStats），装备类操作随后同步在线会话的装备外观与资源上限。

func (s *Server) handleItemRegistry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	items := make([]protocol.ItemDefinition, 0, len(itemDefinitions))
	for _, def := range itemDefinitions {
		items = append(items, protocol.ItemDefinition{
			ID:               def.ID,
			Name:             def.Name,
			Type:             def.Type,
			Rarity:           def.Rarity,
			StackLimit:       def.StackLimit,
			Weight:           def.Weight,
			EquipSlot:        def.EquipSlot,
			Stats:            def.Stats,
			Description:      def.Description,
			ToolType:         def.ToolType,
			ToolTier:         def.ToolTier,
			MaxDurability:    def.MaxDurability,
			PlacesDecoration: def.PlacesDecoration,
		})
	}
	writeJSON(w, http.StatusOK, protocol.ItemRegistryResponse{Items: items})
}

func (s *Server) handleRecipeRegistry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	recipes := make([]protocol.Recipe, 0, len(recipeDefinitions))
	for _, recipe := range recipeDefinitions {
		recipes = append(recipes, protocol.Recipe{
			ID:      recipe.ID,
			Shaped:  recipe.Shaped,
			Pattern: recipe.Pattern,
			Inputs:  recipe.Inputs,
			Output:  protocol.ItemStack{ItemID: recipe.Output.ItemID, Quantity: recipe.Output.Quantity},
		})
	}
	writeJSON(w, http.StatusOK, protocol.RecipeRegistryResponse{Recipes: recipes})
}

func (s *Server) handleMoveInventoryItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req protocol.MoveInventoryItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}
	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) error {
		normalizeInventory(&character.Inventory)
		return moveInventoryItem(&character.Inventory, req.From, req.To)
	})
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{Character: toProtocolCharacter(character)})
}

func (s *Server) handleEquipItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req protocol.EquipItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}
	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) error {
		oldCombat := character.Stats.Combat
		if err := equipFromInventory(character, req.InventorySlot); err != nil {
			return err
		}
		recomputeEquipmentStats(character)
		character.Stats = NormalizeCharacterStats(character.Stats)
		applyResourcePreservation(oldCombat, &character.Stats)
		return nil
	})
	if !ok {
		return
	}
	s.state.syncCharacterLoadout(req.Token, character.Equipment, character.Stats.Combat)
	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{Character: toProtocolCharacter(character)})
}

func (s *Server) handleUnequipItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req protocol.UnequipItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}
	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) error {
		oldCombat := character.Stats.Combat
		if err := unequipToInventory(character, req.EquipSlot); err != nil {
			return err
		}
		recomputeEquipmentStats(character)
		character.Stats = NormalizeCharacterStats(character.Stats)
		applyResourcePreservation(oldCombat, &character.Stats)
		return nil
	})
	if !ok {
		return
	}
	s.state.syncCharacterLoadout(req.Token, character.Equipment, character.Stats.Combat)
	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{Character: toProtocolCharacter(character)})
}

func (s *Server) handleCraft(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req protocol.CraftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}
	var output ItemStack
	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) error {
		crafted, err := craftFromGrid(character, req.Grid)
		if err != nil {
			return err
		}
		output = crafted
		return nil
	})
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, protocol.CraftResponse{
		Character: toProtocolCharacter(character),
		Output:    protocol.ItemStack{ItemID: output.ItemID, Quantity: output.Quantity},
	})
}

// handleGiveItem 测试用发放端点：给角色背包塞物品。
func (s *Server) handleGiveItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req protocol.GiveItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json body", http.StatusBadRequest)
		return
	}
	character, ok := s.updateCharacterFromRequest(r.Context(), w, req.Token, req.CharacterID, func(character *Character) error {
		if _, exists := itemDef(req.ItemID); !exists {
			return ErrUnknownItem
		}
		if req.Quantity <= 0 {
			return ErrInvalidQuantity
		}
		normalizeInventory(&character.Inventory)
		return addItemToInventory(&character.Inventory, ItemStack{ItemID: req.ItemID, Quantity: req.Quantity})
	})
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, protocol.CharacterMutationResponse{Character: toProtocolCharacter(character)})
}
