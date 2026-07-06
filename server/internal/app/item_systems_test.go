package app

import "testing"

func TestRecipeDefinitionsAreValid(t *testing.T) {
	if problems := validateRecipeDefinitions(); len(problems) > 0 {
		t.Fatalf("invalid recipe definitions: %v", problems)
	}
}

func TestDecorationDefinitionsAreValid(t *testing.T) {
	if problems := validateDecorationDefinitions(); len(problems) > 0 {
		t.Fatalf("invalid decoration definitions: %v", problems)
	}
}

func TestItemDefinitionsHaveWeightAndToolFields(t *testing.T) {
	for _, def := range itemDefinitions {
		if def.Weight <= 0 {
			t.Fatalf("item %s must have positive weight", def.ID)
		}
		if def.Type == ItemTypeTool {
			if def.StackLimit != 1 {
				t.Fatalf("tool %s must have stack limit 1", def.ID)
			}
			if def.ToolType == "" || def.ToolTier <= 0 || def.MaxDurability <= 0 {
				t.Fatalf("tool %s missing toolType/toolTier/maxDurability", def.ID)
			}
		}
	}
}

func TestHarvestDurationToolGating(t *testing.T) {
	tree, ok := decorationDef("tree_deciduous")
	if !ok {
		t.Fatal("tree_deciduous not registered")
	}
	// 徒手砍树：拒绝。
	if _, allowed := harvestDuration(tree, nil); allowed {
		t.Fatal("tree should require an axe")
	}
	// 木斧可砍且比基线快。
	axe, _ := itemDef("tool_wood_axe")
	duration, allowed := harvestDuration(tree, &axe)
	if !allowed {
		t.Fatal("wood axe should harvest tree")
	}
	if duration >= tree.Hardness {
		t.Fatalf("tool should speed up harvest, got %.2f >= %.2f", duration, tree.Hardness)
	}
	// 镐不能砍树。
	pickaxe, _ := itemDef("tool_stone_pickaxe")
	if _, allowed := harvestDuration(tree, &pickaxe); allowed {
		t.Fatal("pickaxe must not harvest tree")
	}
	// 草丛徒手可采；镰刀更快。
	grass, _ := decorationDef("grass_tuft")
	bare, allowed := harvestDuration(grass, nil)
	if !allowed {
		t.Fatal("grass should be hand-harvestable")
	}
	sickle, _ := itemDef("tool_stone_sickle")
	fast, allowed := harvestDuration(grass, &sickle)
	if !allowed || fast >= bare {
		t.Fatalf("sickle should speed up grass harvest: %.2f vs %.2f", fast, bare)
	}
}

func TestItemDefinitionsHaveValidEquipSlots(t *testing.T) {
	for _, def := range itemDefinitions {
		if def.Type == ItemTypeEquipment {
			if def.EquipSlot == "" || !isValidEquipSlot(def.EquipSlot) {
				t.Fatalf("equipment %s has invalid slot %q", def.ID, def.EquipSlot)
			}
			if def.StackLimit != 1 {
				t.Fatalf("equipment %s must have stack limit 1, got %d", def.ID, def.StackLimit)
			}
		}
		if def.StackLimit <= 0 {
			t.Fatalf("item %s has non-positive stack limit", def.ID)
		}
	}
}

func TestMatchShapedRecipeWithTranslation(t *testing.T) {
	// 木棍配方图案在左上角；把两块木板放在右下竖排也应命中。
	grid := [9]string{
		"", "", "",
		"", "", "item_wood_plank",
		"", "", "item_wood_plank",
	}
	recipe, ok := matchRecipe(grid)
	if !ok {
		t.Fatalf("expected translated shaped recipe to match")
	}
	if recipe.ID != "recipe_sticks" {
		t.Fatalf("expected recipe_sticks, got %s", recipe.ID)
	}
}

func TestMatchShapedRecipeRejectsWrongShape(t *testing.T) {
	// 两块木板横排 ≠ 竖排图案。
	grid := [9]string{
		"item_wood_plank", "item_wood_plank", "",
		"", "", "",
		"", "", "",
	}
	if _, ok := matchRecipe(grid); ok {
		t.Fatalf("horizontal planks should not match the vertical sticks recipe")
	}
}

func TestMatchShapelessRecipe(t *testing.T) {
	grid := [9]string{"", "", "", "", "item_wood_log", "", "", "", ""}
	recipe, ok := matchRecipe(grid)
	if !ok || recipe.ID != "recipe_planks" {
		t.Fatalf("single log should match recipe_planks, got ok=%v id=%s", ok, recipe.ID)
	}

	// 多放一件材料不应匹配。
	grid[0] = "item_stone"
	if _, ok := matchRecipe(grid); ok {
		t.Fatalf("extra stone should prevent the planks recipe from matching")
	}
}

func TestSwordRecipeMatches(t *testing.T) {
	grid := [9]string{
		"", "item_iron_ingot", "",
		"", "item_iron_ingot", "",
		"", "item_stick", "",
	}
	recipe, ok := matchRecipe(grid)
	if !ok || recipe.Output.ItemID != "weapon_iron_sword" {
		t.Fatalf("iron sword recipe should match, got ok=%v output=%s", ok, recipe.Output.ItemID)
	}
}

func TestInventoryAddMergesAndRespectsStackLimit(t *testing.T) {
	container := ItemContainer{}
	normalizeInventory(&container)

	if err := addItemToInventory(&container, ItemStack{ItemID: "item_wood_log", Quantity: 60}); err != nil {
		t.Fatalf("first add failed: %v", err)
	}
	if err := addItemToInventory(&container, ItemStack{ItemID: "item_wood_log", Quantity: 10}); err != nil {
		t.Fatalf("second add failed: %v", err)
	}
	if container.Items[0].Quantity != 64 {
		t.Fatalf("slot 0 should be capped at 64, got %d", container.Items[0].Quantity)
	}
	if container.Items[1].Quantity != 6 {
		t.Fatalf("slot 1 should hold overflow 6, got %d", container.Items[1].Quantity)
	}
	if total := countItemsInInventory(container, "item_wood_log"); total != 70 {
		t.Fatalf("expected 70 logs total, got %d", total)
	}
}

func TestInventoryAddFailsWhenFull(t *testing.T) {
	container := ItemContainer{}
	normalizeInventory(&container)
	for index := range container.Items {
		container.Items[index] = ItemStack{ItemID: "weapon_wood_sword", Quantity: 1}
	}
	err := addItemToInventory(&container, ItemStack{ItemID: "item_stone", Quantity: 1})
	if err != ErrInventoryFull {
		t.Fatalf("expected ErrInventoryFull, got %v", err)
	}
}

func TestMoveInventoryItemSwapAndMerge(t *testing.T) {
	container := ItemContainer{}
	normalizeInventory(&container)
	container.Items[0] = ItemStack{ItemID: "item_stone", Quantity: 30}
	container.Items[5] = ItemStack{ItemID: "item_stone", Quantity: 40}
	container.Items[7] = ItemStack{ItemID: "item_leather", Quantity: 2}

	// 合并：30 + 40 = 70 → 目标 64，源剩 6
	if err := moveInventoryItem(&container, 0, 5); err != nil {
		t.Fatalf("merge move failed: %v", err)
	}
	if container.Items[5].Quantity != 64 || container.Items[0].Quantity != 6 {
		t.Fatalf("merge should cap at 64 and keep 6, got target=%d source=%d", container.Items[5].Quantity, container.Items[0].Quantity)
	}

	// 交换
	if err := moveInventoryItem(&container, 7, 0); err != nil {
		t.Fatalf("swap move failed: %v", err)
	}
	if container.Items[0].ItemID != "item_leather" || container.Items[7].ItemID != "item_stone" {
		t.Fatalf("swap did not exchange slots: %+v / %+v", container.Items[0], container.Items[7])
	}
}

func TestEquipFromInventoryAppliesStats(t *testing.T) {
	character := newCharacter("Tester")
	character.Stats = NormalizeCharacterStats(character.Stats)
	baseAttack := character.Stats.Combat.PhysicalAttack

	slot := firstEmptyInventorySlot(character.Inventory)
	character.Inventory.Items[slot] = ItemStack{ItemID: "weapon_iron_sword", Quantity: 1}

	if err := equipFromInventory(&character, slot); err != nil {
		t.Fatalf("equip failed: %v", err)
	}
	recomputeEquipmentStats(&character)
	character.Stats = NormalizeCharacterStats(character.Stats)

	if character.Equipment.MainHand != "weapon_iron_sword" {
		t.Fatalf("main hand should hold the iron sword, got %q", character.Equipment.MainHand)
	}
	if character.Inventory.Items[slot].ItemID != "" {
		t.Fatalf("inventory slot should be empty after equipping, got %+v", character.Inventory.Items[slot])
	}
	gained := character.Stats.Combat.PhysicalAttack - baseAttack
	if gained != 12 {
		t.Fatalf("iron sword should add 12 physical attack, got %d", gained)
	}
}

func TestEquipSwapsWithExistingEquipment(t *testing.T) {
	character := newCharacter("Tester")
	slot := firstEmptyInventorySlot(character.Inventory)
	character.Inventory.Items[slot] = ItemStack{ItemID: "weapon_wood_sword", Quantity: 1}
	if err := equipFromInventory(&character, slot); err != nil {
		t.Fatalf("first equip failed: %v", err)
	}

	character.Inventory.Items[slot] = ItemStack{ItemID: "weapon_iron_sword", Quantity: 1}
	if err := equipFromInventory(&character, slot); err != nil {
		t.Fatalf("swap equip failed: %v", err)
	}
	if character.Equipment.MainHand != "weapon_iron_sword" {
		t.Fatalf("main hand should be iron sword, got %q", character.Equipment.MainHand)
	}
	if character.Inventory.Items[slot].ItemID != "weapon_wood_sword" {
		t.Fatalf("old sword should return to the same slot, got %+v", character.Inventory.Items[slot])
	}
}

func TestEquipRejectsNonEquipment(t *testing.T) {
	character := newCharacter("Tester")
	slot := firstEmptyInventorySlot(character.Inventory)
	character.Inventory.Items[slot] = ItemStack{ItemID: "item_stone", Quantity: 1}
	if err := equipFromInventory(&character, slot); err != ErrItemNotEquippable {
		t.Fatalf("expected ErrItemNotEquippable, got %v", err)
	}
}

func TestUnequipReturnsItemToInventory(t *testing.T) {
	character := newCharacter("Tester")
	slot := firstEmptyInventorySlot(character.Inventory)
	character.Inventory.Items[slot] = ItemStack{ItemID: "armor_iron_chest", Quantity: 1}
	if err := equipFromInventory(&character, slot); err != nil {
		t.Fatalf("equip failed: %v", err)
	}
	if err := unequipToInventory(&character, EquipSlotChest); err != nil {
		t.Fatalf("unequip failed: %v", err)
	}
	if character.Equipment.Chest != "" {
		t.Fatalf("chest slot should be empty, got %q", character.Equipment.Chest)
	}
	if countItemsInInventory(character.Inventory, "armor_iron_chest") != 1 {
		t.Fatalf("chest armor should be back in inventory")
	}
	if err := unequipToInventory(&character, EquipSlotChest); err != ErrEquipSlotEmpty {
		t.Fatalf("expected ErrEquipSlotEmpty, got %v", err)
	}
}

func TestApplyResourcePreservationKeepsRatio(t *testing.T) {
	old := CharacterCombatStats{Resources: CharacterResourceStats{
		HealthMax: 100, HealthCurrent: 80,
		ManaMax: 60, ManaCurrent: 30,
		StaminaMax: 100, StaminaCurrent: 100,
	}}
	stats := CharacterStats{Combat: CharacterCombatStats{Resources: CharacterResourceStats{
		HealthMax: 120, HealthCurrent: 120,
		ManaMax: 60, ManaCurrent: 60,
		StaminaMax: 100, StaminaCurrent: 100,
	}}}
	applyResourcePreservation(old, &stats)
	if stats.Combat.Resources.HealthCurrent != 96 {
		t.Fatalf("80/100 -> x/120 should preserve ratio to 96, got %d", stats.Combat.Resources.HealthCurrent)
	}
	if stats.Combat.Resources.ManaCurrent != 30 {
		t.Fatalf("mana should stay 30/60, got %d", stats.Combat.Resources.ManaCurrent)
	}
}

func TestCraftFromGridConsumesAndProduces(t *testing.T) {
	character := newCharacter("Tester")
	// 新手包里有原木；先合成木板
	grid := [9]string{"item_wood_log", "", "", "", "", "", "", "", ""}
	output, err := craftFromGrid(&character, grid)
	if err != nil {
		t.Fatalf("craft planks failed: %v", err)
	}
	if output.ItemID != "item_wood_plank" || output.Quantity != 4 {
		t.Fatalf("expected 4 planks, got %+v", output)
	}
	if countItemsInInventory(character.Inventory, "item_wood_log") != 15 {
		t.Fatalf("log count should drop 16->15, got %d", countItemsInInventory(character.Inventory, "item_wood_log"))
	}
	if countItemsInInventory(character.Inventory, "item_wood_plank") != 4 {
		t.Fatalf("plank count should be 4")
	}
}

func TestCraftFailsWithoutMaterials(t *testing.T) {
	character := newCharacter("Tester")
	character.Inventory = ItemContainer{}
	normalizeInventory(&character.Inventory)
	grid := [9]string{"item_wood_log", "", "", "", "", "", "", "", ""}
	if _, err := craftFromGrid(&character, grid); err != ErrItemNotFound {
		t.Fatalf("expected ErrItemNotFound, got %v", err)
	}
}

func TestCraftFailsOnUnknownRecipe(t *testing.T) {
	character := newCharacter("Tester")
	grid := [9]string{"item_stone", "item_wood_log", "", "", "", "", "", "", ""}
	if _, err := craftFromGrid(&character, grid); err != ErrRecipeNotMatched {
		t.Fatalf("expected ErrRecipeNotMatched, got %v", err)
	}
}

func TestStarterInventoryCanCraftWoodSword(t *testing.T) {
	character := newCharacter("Tester")

	// 原木→木板
	if _, err := craftFromGrid(&character, [9]string{"item_wood_log", "", "", "", "", "", "", "", ""}); err != nil {
		t.Fatalf("craft planks: %v", err)
	}
	// 木板→木棍
	if _, err := craftFromGrid(&character, [9]string{"item_wood_plank", "", "", "item_wood_plank", "", "", "", "", ""}); err != nil {
		t.Fatalf("craft sticks: %v", err)
	}
	// 木板x2 + 木棍 → 木剑
	grid := [9]string{
		"item_wood_plank", "", "",
		"item_wood_plank", "", "",
		"item_stick", "", "",
	}
	output, err := craftFromGrid(&character, grid)
	if err != nil {
		t.Fatalf("craft wood sword: %v", err)
	}
	if output.ItemID != "weapon_wood_sword" {
		t.Fatalf("expected wood sword, got %s", output.ItemID)
	}
}
