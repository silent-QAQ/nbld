package app

// 物品注册表：服务端为唯一数据源，客户端通过 GET /api/v1/items 拉取。
// 物品定义是纯代码常量，不落数据库；角色背包只存 {itemId, quantity}。

const (
	ItemTypeMaterial   = "material"
	ItemTypeConsumable = "consumable"
	ItemTypeEquipment  = "equipment"
	ItemTypeTool       = "tool"  // 采集工具：不可堆叠，带耐久
	ItemTypeBlock      = "block" // 建造方块：放置到世界装饰层
)

// 工具类型：决定能采集哪类装饰方块。
const (
	ToolTypeAxe     = "axe"     // 斧：树木类
	ToolTypePickaxe = "pickaxe" // 镐：岩石类
	ToolTypeSickle  = "sickle"  // 镰：植物类（加速）
)

const (
	RarityCommon   = "common"
	RarityUncommon = "uncommon"
	RarityRare     = "rare"
)

// 装备槽位代码，与 CharacterEquipment 字段一一对应。
const (
	EquipSlotMainHand    = "mainHand"
	EquipSlotOffHand     = "offHand"
	EquipSlotHelmet      = "helmet"
	EquipSlotChest       = "chest"
	EquipSlotPants       = "pants"
	EquipSlotShoes       = "shoes"
	EquipSlotShoulders   = "shoulders"
	EquipSlotCloak       = "cloak"
	EquipSlotLeftBracer  = "leftBracer"
	EquipSlotRightBracer = "rightBracer"
)

var equipSlotCodes = []string{
	EquipSlotMainHand, EquipSlotOffHand, EquipSlotHelmet, EquipSlotChest,
	EquipSlotPants, EquipSlotShoes, EquipSlotShoulders, EquipSlotCloak,
	EquipSlotLeftBracer, EquipSlotRightBracer,
}

type ItemDefinition struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Type        string          `json:"type"`
	Rarity      string          `json:"rarity"`
	StackLimit  int             `json:"stackLimit"`
	Weight      float64         `json:"weight"` // 单个重量（千克），预留给负重系统
	EquipSlot   string          `json:"equipSlot,omitempty"`
	Stats       AttributeValues `json:"stats,omitempty"`
	Description string          `json:"description,omitempty"`

	// 工具字段（Type == ItemTypeTool）
	ToolType      string `json:"toolType,omitempty"`      // axe | pickaxe | sickle
	ToolTier      int    `json:"toolTier,omitempty"`      // 1 木 / 2 石 / 3 铁
	MaxDurability int    `json:"maxDurability,omitempty"` // 总耐久（使用次数）

	// 建造字段（Type == ItemTypeBlock）
	PlacesDecoration string `json:"placesDecoration,omitempty"` // 放置后写入 tile.Decoration 的装饰 ID
}

var itemDefinitions = []ItemDefinition{
	// 材料
	{ID: "item_wood_log", Name: "原木", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 2.0, Description: "从树木采集的原木。"},
	{ID: "item_wood_plank", Name: "木板", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 0.5, Description: "原木加工成的木板。"},
	{ID: "item_stick", Name: "木棍", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 0.1, Description: "武器和工具的握柄材料。"},
	{ID: "item_stone", Name: "石头", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 1.5, Description: "坚硬的石块。"},
	{ID: "item_iron_ore", Name: "铁矿石", Type: ItemTypeMaterial, Rarity: RarityUncommon, StackLimit: 64, Weight: 2.5, Description: "未经冶炼的铁矿。"},
	{ID: "item_iron_ingot", Name: "铁锭", Type: ItemTypeMaterial, Rarity: RarityUncommon, StackLimit: 64, Weight: 2.0, Description: "冶炼后的铁锭。"},
	{ID: "item_leather", Name: "皮革", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 0.3, Description: "鞣制过的兽皮。"},

	// 采集材料
	{ID: "item_fiber", Name: "植物纤维", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 0.05, Description: "从草木采集的柔韧纤维。"},
	{ID: "item_flower", Name: "花瓣", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 0.02, Description: "色彩鲜艳的花瓣。"},
	{ID: "item_granite", Name: "花岗岩块", Type: ItemTypeMaterial, Rarity: RarityUncommon, StackLimit: 64, Weight: 2.2, Description: "致密坚硬的花岗岩。"},
	{ID: "item_sandstone", Name: "砂岩块", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 1.2, Description: "疏松的砂质岩块。"},
	{ID: "item_cactus_flesh", Name: "仙人掌肉", Type: ItemTypeMaterial, Rarity: RarityCommon, StackLimit: 64, Weight: 0.4, Description: "多汁的仙人掌果肉。"},

	// 消耗品
	{ID: "potion_health_small", Name: "小型生命药水", Type: ItemTypeConsumable, Rarity: RarityCommon, StackLimit: 16, Weight: 0.3, Description: "恢复少量生命值。"},
	{ID: "item_mushroom", Name: "蘑菇", Type: ItemTypeConsumable, Rarity: RarityCommon, StackLimit: 32, Weight: 0.1, Description: "林间采集的食用蘑菇。"},
	{ID: "item_berry", Name: "浆果", Type: ItemTypeConsumable, Rarity: RarityCommon, StackLimit: 32, Weight: 0.05, Description: "酸甜可口的野生浆果。"},

	// 采集工具（不可堆叠，带耐久）
	{ID: "tool_wood_axe", Name: "木斧", Type: ItemTypeTool, Rarity: RarityCommon, StackLimit: 1, Weight: 1.5,
		ToolType: ToolTypeAxe, ToolTier: 1, MaxDurability: 60, Description: "砍伐树木的基础斧头。"},
	{ID: "tool_stone_axe", Name: "石斧", Type: ItemTypeTool, Rarity: RarityCommon, StackLimit: 1, Weight: 2.2,
		ToolType: ToolTypeAxe, ToolTier: 2, MaxDurability: 132, Description: "石刃斧头，砍伐更快。"},
	{ID: "tool_iron_axe", Name: "铁斧", Type: ItemTypeTool, Rarity: RarityUncommon, StackLimit: 1, Weight: 2.8,
		ToolType: ToolTypeAxe, ToolTier: 3, MaxDurability: 251, Description: "锋利耐用的铁斧。"},
	{ID: "tool_stone_pickaxe", Name: "石镐", Type: ItemTypeTool, Rarity: RarityCommon, StackLimit: 1, Weight: 2.5,
		ToolType: ToolTypePickaxe, ToolTier: 2, MaxDurability: 132, Description: "开采岩石的石制镐。"},
	{ID: "tool_iron_pickaxe", Name: "铁镐", Type: ItemTypeTool, Rarity: RarityUncommon, StackLimit: 1, Weight: 3.0,
		ToolType: ToolTypePickaxe, ToolTier: 3, MaxDurability: 251, Description: "可开采坚硬岩石的铁镐。"},
	{ID: "tool_stone_sickle", Name: "石镰刀", Type: ItemTypeTool, Rarity: RarityCommon, StackLimit: 1, Weight: 1.2,
		ToolType: ToolTypeSickle, ToolTier: 2, MaxDurability: 90, Description: "收割植物的弯刃镰刀。"},
	{ID: "tool_iron_sickle", Name: "铁镰刀", Type: ItemTypeTool, Rarity: RarityUncommon, StackLimit: 1, Weight: 1.6,
		ToolType: ToolTypeSickle, ToolTier: 3, MaxDurability: 251, Description: "锋利的铁制镰刀。"},

	// 建造方块（放置到装饰层）
	{ID: "block_wood_fence", Name: "木栅栏", Type: ItemTypeBlock, Rarity: RarityCommon, StackLimit: 64, Weight: 1.0,
		PlacesDecoration: "deco_wood_fence", Description: "木制栅栏，围出庭院。"},
	{ID: "block_stone_fence", Name: "石栅栏", Type: ItemTypeBlock, Rarity: RarityCommon, StackLimit: 64, Weight: 2.5,
		PlacesDecoration: "deco_stone_fence", Description: "坚固的石制栏杆。"},
	{ID: "block_wood_wall", Name: "木围墙", Type: ItemTypeBlock, Rarity: RarityCommon, StackLimit: 64, Weight: 2.0,
		PlacesDecoration: "deco_wood_wall", Description: "遮挡视线的木墙。"},
	{ID: "block_stone_wall", Name: "石围墙", Type: ItemTypeBlock, Rarity: RarityCommon, StackLimit: 64, Weight: 4.0,
		PlacesDecoration: "deco_stone_wall", Description: "厚重的石砌围墙。"},
	{ID: "block_wood_floor", Name: "木地板", Type: ItemTypeBlock, Rarity: RarityCommon, StackLimit: 64, Weight: 0.8,
		PlacesDecoration: "deco_wood_floor", Description: "温暖的木质地板。"},
	{ID: "block_stone_floor", Name: "石地板", Type: ItemTypeBlock, Rarity: RarityCommon, StackLimit: 64, Weight: 2.0,
		PlacesDecoration: "deco_stone_floor", Description: "平整的石板地面。"},
	{ID: "block_torch", Name: "火把", Type: ItemTypeBlock, Rarity: RarityCommon, StackLimit: 64, Weight: 0.2,
		PlacesDecoration: "deco_torch", Description: "照亮夜晚的火把。"},

	// 武器（主手）
	{ID: "weapon_wood_sword", Name: "木剑", Type: ItemTypeEquipment, Rarity: RarityCommon, StackLimit: 1, Weight: 1.0, EquipSlot: EquipSlotMainHand,
		Stats: AttributeValues{AttributePhysicalAttack: 4}, Description: "木板打造的练习用剑。"},
	{ID: "weapon_stone_sword", Name: "石剑", Type: ItemTypeEquipment, Rarity: RarityCommon, StackLimit: 1, Weight: 2.0, EquipSlot: EquipSlotMainHand,
		Stats: AttributeValues{AttributePhysicalAttack: 7}, Description: "石头磨制的重剑。"},
	{ID: "weapon_iron_sword", Name: "铁剑", Type: ItemTypeEquipment, Rarity: RarityUncommon, StackLimit: 1, Weight: 2.5, EquipSlot: EquipSlotMainHand,
		Stats: AttributeValues{AttributePhysicalAttack: 12, AttributePhysicalCrit: 0.02}, Description: "铁锭锻造的利剑。"},

	// 皮甲
	{ID: "armor_leather_helmet", Name: "皮革头盔", Type: ItemTypeEquipment, Rarity: RarityCommon, StackLimit: 1, Weight: 0.8, EquipSlot: EquipSlotHelmet,
		Stats: AttributeValues{AttributePhysicalDefense: 2, AttributeMagicDefense: 1}, Description: "皮革缝制的头盔。"},
	{ID: "armor_leather_chest", Name: "皮革胸甲", Type: ItemTypeEquipment, Rarity: RarityCommon, StackLimit: 1, Weight: 1.5, EquipSlot: EquipSlotChest,
		Stats: AttributeValues{AttributePhysicalDefense: 4, AttributeMagicDefense: 2}, Description: "皮革缝制的胸甲。"},
	{ID: "armor_leather_pants", Name: "皮革护腿", Type: ItemTypeEquipment, Rarity: RarityCommon, StackLimit: 1, Weight: 1.2, EquipSlot: EquipSlotPants,
		Stats: AttributeValues{AttributePhysicalDefense: 3, AttributeMagicDefense: 1}, Description: "皮革缝制的护腿。"},
	{ID: "armor_leather_shoes", Name: "皮革靴", Type: ItemTypeEquipment, Rarity: RarityCommon, StackLimit: 1, Weight: 0.6, EquipSlot: EquipSlotShoes,
		Stats: AttributeValues{AttributePhysicalDefense: 2, AttributeMoveSpeed: 0.2}, Description: "轻便的皮靴。"},

	// 铁甲
	{ID: "armor_iron_helmet", Name: "铁头盔", Type: ItemTypeEquipment, Rarity: RarityUncommon, StackLimit: 1, Weight: 2.5, EquipSlot: EquipSlotHelmet,
		Stats: AttributeValues{AttributePhysicalDefense: 5, AttributeMagicDefense: 2}, Description: "铁锭锻造的头盔。"},
	{ID: "armor_iron_chest", Name: "铁胸甲", Type: ItemTypeEquipment, Rarity: RarityUncommon, StackLimit: 1, Weight: 5.0, EquipSlot: EquipSlotChest,
		Stats: AttributeValues{AttributePhysicalDefense: 8, AttributeMagicDefense: 3}, Description: "铁锭锻造的胸甲。"},
	{ID: "armor_iron_pants", Name: "铁护腿", Type: ItemTypeEquipment, Rarity: RarityUncommon, StackLimit: 1, Weight: 3.5, EquipSlot: EquipSlotPants,
		Stats: AttributeValues{AttributePhysicalDefense: 6, AttributeMagicDefense: 2}, Description: "铁锭锻造的护腿。"},
	{ID: "armor_iron_shoes", Name: "铁靴", Type: ItemTypeEquipment, Rarity: RarityUncommon, StackLimit: 1, Weight: 2.0, EquipSlot: EquipSlotShoes,
		Stats: AttributeValues{AttributePhysicalDefense: 4}, Description: "铁锭锻造的战靴。"},
}

var itemDefinitionByID = func() map[string]ItemDefinition {
	out := make(map[string]ItemDefinition, len(itemDefinitions))
	for _, def := range itemDefinitions {
		out[def.ID] = def
	}
	return out
}()

func itemDef(id string) (ItemDefinition, bool) {
	def, ok := itemDefinitionByID[id]
	return def, ok
}

// itemStackLimit 返回物品堆叠上限；未注册物品按 1 处理（最保守）。
func itemStackLimit(id string) int {
	if def, ok := itemDefinitionByID[id]; ok && def.StackLimit > 0 {
		return def.StackLimit
	}
	return 1
}

func isValidEquipSlot(slot string) bool {
	for _, code := range equipSlotCodes {
		if code == slot {
			return true
		}
	}
	return false
}

// equipmentSlotValue 按槽位代码读取装备字段。
func equipmentSlotValue(equipment CharacterEquipment, slot string) string {
	switch slot {
	case EquipSlotMainHand:
		return equipment.MainHand
	case EquipSlotOffHand:
		return equipment.OffHand
	case EquipSlotHelmet:
		return equipment.Helmet
	case EquipSlotChest:
		return equipment.Chest
	case EquipSlotPants:
		return equipment.Pants
	case EquipSlotShoes:
		return equipment.Shoes
	case EquipSlotShoulders:
		return equipment.Shoulders
	case EquipSlotCloak:
		return equipment.Cloak
	case EquipSlotLeftBracer:
		return equipment.LeftBracer
	case EquipSlotRightBracer:
		return equipment.RightBracer
	}
	return ""
}

// setEquipmentSlot 按槽位代码写入装备字段并同步可见护甲。
func setEquipmentSlot(equipment *CharacterEquipment, slot, itemID string) {
	switch slot {
	case EquipSlotMainHand:
		equipment.MainHand = itemID
	case EquipSlotOffHand:
		equipment.OffHand = itemID
	case EquipSlotHelmet:
		equipment.Helmet = itemID
	case EquipSlotChest:
		equipment.Chest = itemID
	case EquipSlotPants:
		equipment.Pants = itemID
	case EquipSlotShoes:
		equipment.Shoes = itemID
	case EquipSlotShoulders:
		equipment.Shoulders = itemID
	case EquipSlotCloak:
		equipment.Cloak = itemID
	case EquipSlotLeftBracer:
		equipment.LeftBracer = itemID
	case EquipSlotRightBracer:
		equipment.RightBracer = itemID
	}
	equipment.syncVisibleArmor()
}

// equippedItemIDs 返回所有已装备（非空）的物品 ID。
func equippedItemIDs(equipment CharacterEquipment) []string {
	out := make([]string, 0, len(equipSlotCodes))
	for _, slot := range equipSlotCodes {
		if id := equipmentSlotValue(equipment, slot); id != "" {
			out = append(out, id)
		}
	}
	return out
}
