package app

import "errors"

var (
	ErrItemNotEquippable = errors.New("item cannot be equipped")
	ErrInvalidEquipSlot  = errors.New("invalid equipment slot")
	ErrEquipSlotEmpty    = errors.New("equipment slot is empty")
	ErrRecipeNotMatched  = errors.New("no recipe matches the crafting grid")
)

// recomputeEquipmentStats 把所有已装备物品的属性求和写入 Sources.Equipment。
// 装备与宝石不得提供生命的规则由 NormalizeCharacterStats 内的
// validateStatSourceRules 继续兜底（非法 health 条目会被忽略并告警）。
func recomputeEquipmentStats(character *Character) {
	totals := AttributeValues{}
	for _, itemID := range equippedItemIDs(character.Equipment) {
		def, ok := itemDef(itemID)
		if !ok {
			continue
		}
		for code, value := range def.Stats {
			totals[code] += value
		}
	}
	character.Stats.Sources.Equipment = totals
}

// applyResourcePreservation 在属性重算后按比例保留当前资源，
// 避免换装导致满血复活或资源凭空蒸发。
// 例：80/100 血，换装后上限 120 → 96/120。
func applyResourcePreservation(oldCombat CharacterCombatStats, stats *CharacterStats) {
	preserve := func(oldCurrent, oldMax, newMax int) int {
		if oldMax <= 0 || newMax <= 0 {
			return newMax
		}
		ratio := float64(oldCurrent) / float64(oldMax)
		value := int(ratio*float64(newMax) + 0.5)
		if value < 0 {
			value = 0
		}
		if value > newMax {
			value = newMax
		}
		return value
	}
	resources := &stats.Combat.Resources
	old := oldCombat.Resources
	resources.HealthCurrent = preserve(old.HealthCurrent, old.HealthMax, resources.HealthMax)
	resources.ManaCurrent = preserve(old.ManaCurrent, old.ManaMax, resources.ManaMax)
	resources.StaminaCurrent = preserve(old.StaminaCurrent, old.StaminaMax, resources.StaminaMax)
}

// equipFromInventory 把背包 inventorySlot 里的装备穿到其定义的槽位。
// 目标槽已有装备时与背包槽互换。
func equipFromInventory(character *Character, inventorySlot int) error {
	if inventorySlot < 0 || inventorySlot >= inventorySlotCount {
		return ErrInvalidInventorySlot
	}
	normalizeInventory(&character.Inventory)
	stack := character.Inventory.Items[inventorySlot]
	if stack.ItemID == "" {
		return ErrItemNotFound
	}
	def, ok := itemDef(stack.ItemID)
	if !ok {
		return ErrUnknownItem
	}
	if def.Type != ItemTypeEquipment || def.EquipSlot == "" || !isValidEquipSlot(def.EquipSlot) {
		return ErrItemNotEquippable
	}

	previous := equipmentSlotValue(character.Equipment, def.EquipSlot)
	setEquipmentSlot(&character.Equipment, def.EquipSlot, stack.ItemID)

	// 背包槽扣掉一件；旧装备放回该槽（装备堆叠上限为 1，正好互换）。
	stack.Quantity--
	if stack.Quantity <= 0 {
		stack = ItemStack{}
	}
	if previous != "" {
		if stack.ItemID == "" {
			stack = ItemStack{ItemID: previous, Quantity: 1}
		} else {
			// 背包槽还有剩余堆叠（理论上装备不可堆叠，防御处理）：找空槽放旧装备
			character.Inventory.Items[inventorySlot] = stack
			if err := addItemToInventory(&character.Inventory, ItemStack{ItemID: previous, Quantity: 1}); err != nil {
				// 回滚装备变更
				setEquipmentSlot(&character.Equipment, def.EquipSlot, previous)
				character.Inventory.Items[inventorySlot].Quantity++
				return err
			}
			return nil
		}
	}
	character.Inventory.Items[inventorySlot] = stack
	return nil
}

// unequipToInventory 把 equipSlot 上的装备卸到背包首个空槽。
func unequipToInventory(character *Character, equipSlot string) error {
	if !isValidEquipSlot(equipSlot) {
		return ErrInvalidEquipSlot
	}
	itemID := equipmentSlotValue(character.Equipment, equipSlot)
	if itemID == "" {
		return ErrEquipSlotEmpty
	}
	normalizeInventory(&character.Inventory)
	if err := addItemToInventory(&character.Inventory, ItemStack{ItemID: itemID, Quantity: 1}); err != nil {
		return err
	}
	setEquipmentSlot(&character.Equipment, equipSlot, "")
	return nil
}

// craftFromGrid 校验 3x3 格子对应配方并执行合成：
// 背包必须实际持有全部输入（格子只是客户端的摆放意图），
// 扣除输入后产物入包。
func craftFromGrid(character *Character, grid [9]string) (ItemStack, error) {
	for _, id := range grid {
		if id == "" {
			continue
		}
		if _, ok := itemDef(id); !ok {
			return ItemStack{}, ErrUnknownItem
		}
	}
	recipe, ok := matchRecipe(grid)
	if !ok {
		return ItemStack{}, ErrRecipeNotMatched
	}

	normalizeInventory(&character.Inventory)
	inputs := recipe.inputCounts()
	for itemID, need := range inputs {
		if countItemsInInventory(character.Inventory, itemID) < need {
			return ItemStack{}, ErrItemNotFound
		}
	}

	// 在副本上模拟扣料+入包，全部成功才提交，保证事务性。
	working := ItemContainer{Items: make([]ItemStack, len(character.Inventory.Items))}
	copy(working.Items, character.Inventory.Items)
	if err := removeItemsFromInventory(&working, inputs); err != nil {
		return ItemStack{}, err
	}
	if err := addItemToInventory(&working, recipe.Output); err != nil {
		return ItemStack{}, err
	}
	character.Inventory = working
	return recipe.Output, nil
}
