package app

// 装饰方块注册表：定义装饰层（tile.Decoration）每种方块的破坏规则与掉落。
// 地形层（Terrain/Block/Feature）不可破坏，只有装饰层参与采集与建造。
// 客户端通过 GET /api/v1/decorations 拉取，用于本地进度条与放置预览；
// harvest/place 时服务端以本表为准重新校验。

type DecorationDrop struct {
	ItemID string `json:"itemId"`
	Min    int    `json:"min"`
	Max    int    `json:"max"`
}

type DecorationDefinition struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Kind：plant 植物 | rock 岩石 | wood 树木 | building 玩家建造
	Kind string `json:"kind"`
	// Hardness：徒手（或未达标工具）破坏所需秒数基线；工具按系数加速。
	Hardness float64 `json:"hardness"`
	// RequiredTool：空 = 徒手可破坏；axe/pickaxe/sickle = 必须持对应工具。
	RequiredTool string `json:"requiredTool,omitempty"`
	// MinTier：RequiredTool 非空时需要的最低工具等级（1 木 / 2 石 / 3 铁）。
	MinTier int `json:"minTier,omitempty"`
	// Blocking：是否阻挡移动；放置类装饰同时用于"不可放在玩家脚下"校验。
	Blocking bool `json:"blocking"`
	// PreferredTool：非必须但可加速的工具类型（如镰刀收割植物）。
	PreferredTool string           `json:"preferredTool,omitempty"`
	Drops         []DecorationDrop `json:"drops"`
}

// 工具速度系数：对口工具按等级缩短破坏时间。
// 实际时间 = Hardness × tierSpeedFactor(tier)。
func tierSpeedFactor(tier int) float64 {
	switch {
	case tier >= 3:
		return 0.2
	case tier == 2:
		return 0.35
	case tier == 1:
		return 0.6
	default:
		return 1.0
	}
}

// harvestDuration 计算指定工具（可为 nil）破坏该装饰的秒数；
// 不满足工具要求时返回 (0, false)。
func harvestDuration(def DecorationDefinition, tool *ItemDefinition) (float64, bool) {
	toolType := ""
	toolTier := 0
	if tool != nil && tool.Type == ItemTypeTool {
		toolType = tool.ToolType
		toolTier = tool.ToolTier
	}

	if def.RequiredTool != "" {
		if toolType != def.RequiredTool || toolTier < def.MinTier {
			return 0, false
		}
		return def.Hardness * tierSpeedFactor(toolTier), true
	}

	// 徒手可破坏：对口/偏好工具仍可加速。
	if toolType != "" && (toolType == def.RequiredTool || toolType == def.PreferredTool) {
		return def.Hardness * tierSpeedFactor(toolTier), true
	}
	return def.Hardness, true
}

var decorationDefinitions = []DecorationDefinition{
	// ---- 小型植物：徒手快速采集，镰刀加速 ----
	{ID: "grass_tuft", Name: "草丛", Kind: "plant", Hardness: 0.4, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 1, Max: 2}}},
	{ID: "flower", Name: "花丛", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 2}}},
	{ID: "white_flower", Name: "白花", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 2}}},
	{ID: "red_flower", Name: "红花", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 2}}},
	{ID: "blue_flower", Name: "蓝花", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 2}}},
	{ID: "purple_flower", Name: "紫花", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 2}}},
	{ID: "alpine_flower", Name: "高山花", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 3}}},
	{ID: "bog_flower", Name: "沼泽花", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 2}}},
	{ID: "clover_patch", Name: "三叶草", Kind: "plant", Hardness: 0.3, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 1, Max: 1}}},
	{ID: "lichen_patch", Name: "地衣", Kind: "plant", Hardness: 0.5, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 1, Max: 1}}},
	{ID: "reed", Name: "芦苇", Kind: "plant", Hardness: 0.5, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 1, Max: 3}}},
	{ID: "swamp_reed", Name: "沼泽芦苇", Kind: "plant", Hardness: 0.5, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 1, Max: 3}}},
	{ID: "water_lily", Name: "睡莲", Kind: "plant", Hardness: 0.4, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_flower", Min: 1, Max: 1}}},
	{ID: "fern", Name: "蕨类", Kind: "plant", Hardness: 0.6, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 1, Max: 2}}},
	{ID: "jungle_fern", Name: "雨林蕨", Kind: "plant", Hardness: 0.7, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 2, Max: 3}}},
	{ID: "jungle_vine", Name: "雨林藤蔓", Kind: "plant", Hardness: 0.8, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_fiber", Min: 2, Max: 4}}},
	{ID: "mushroom_red", Name: "红蘑菇", Kind: "plant", Hardness: 0.3,
		Drops: []DecorationDrop{{ItemID: "item_mushroom", Min: 1, Max: 1}}},
	{ID: "mushroom_brown", Name: "棕蘑菇", Kind: "plant", Hardness: 0.3,
		Drops: []DecorationDrop{{ItemID: "item_mushroom", Min: 1, Max: 2}}},

	// ---- 灌木与树苗：徒手较慢，镰刀加速 ----
	{ID: "bush", Name: "灌木", Kind: "plant", Hardness: 1.2, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}, {ItemID: "item_fiber", Min: 1, Max: 2}}},
	{ID: "dry_bush", Name: "枯灌木", Kind: "plant", Hardness: 0.9, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 3}}},
	{ID: "alpine_shrub", Name: "高山灌木", Kind: "plant", Hardness: 1.2, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}, {ItemID: "item_fiber", Min: 1, Max: 1}}},
	{ID: "hill_shrub", Name: "丘陵灌木", Kind: "plant", Hardness: 1.2, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}, {ItemID: "item_fiber", Min: 1, Max: 1}}},
	{ID: "snow_bush", Name: "雪灌木", Kind: "plant", Hardness: 1.2, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}}},
	{ID: "cold_shrub", Name: "寒灌木", Kind: "plant", Hardness: 1.0, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}}},
	{ID: "thorn_bush", Name: "荆棘灌木", Kind: "plant", Hardness: 1.5, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}, {ItemID: "item_fiber", Min: 1, Max: 2}}},
	{ID: "berry_bush", Name: "浆果灌木", Kind: "plant", Hardness: 0.8, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_berry", Min: 1, Max: 3}, {ItemID: "item_stick", Min: 0, Max: 1}}},
	{ID: "cactus", Name: "仙人掌", Kind: "plant", Hardness: 1.2, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_cactus_flesh", Min: 1, Max: 2}}},
	{ID: "desert_cactus", Name: "沙漠巨型仙人掌", Kind: "plant", Hardness: 2.0, Blocking: true, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_cactus_flesh", Min: 2, Max: 4}}},
	{ID: "acacia_sapling", Name: "金合欢苗", Kind: "plant", Hardness: 0.6, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}}},
	{ID: "pine_sapling", Name: "松树苗", Kind: "plant", Hardness: 0.6, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}}},
	{ID: "broadleaf_sapling", Name: "阔叶树苗", Kind: "plant", Hardness: 0.6, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}}},
	{ID: "palm_sapling", Name: "棕榈树苗", Kind: "plant", Hardness: 0.6, PreferredTool: ToolTypeSickle,
		Drops: []DecorationDrop{{ItemID: "item_stick", Min: 1, Max: 2}}},

	// ---- 树木：必须斧头 ----
	{ID: "tree_deciduous", Name: "阔叶树", Kind: "wood", Hardness: 3.0, RequiredTool: ToolTypeAxe, MinTier: 1, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_wood_log", Min: 2, Max: 4}, {ItemID: "item_stick", Min: 1, Max: 2}}},
	{ID: "tree_conifer", Name: "针叶树", Kind: "wood", Hardness: 3.0, RequiredTool: ToolTypeAxe, MinTier: 1, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_wood_log", Min: 2, Max: 4}, {ItemID: "item_stick", Min: 1, Max: 2}}},
	{ID: "tree_jungle", Name: "雨林树", Kind: "wood", Hardness: 4.0, RequiredTool: ToolTypeAxe, MinTier: 1, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_wood_log", Min: 3, Max: 5}, {ItemID: "item_fiber", Min: 0, Max: 2}}},
	{ID: "dead_tree", Name: "枯树", Kind: "wood", Hardness: 2.0, RequiredTool: ToolTypeAxe, MinTier: 1, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_wood_log", Min: 1, Max: 3}, {ItemID: "item_stick", Min: 1, Max: 3}}},
	{ID: "stump", Name: "树桩", Kind: "wood", Hardness: 1.5, RequiredTool: ToolTypeAxe, MinTier: 1,
		Drops: []DecorationDrop{{ItemID: "item_wood_log", Min: 1, Max: 1}}},
	{ID: "fallen_log", Name: "倒木", Kind: "wood", Hardness: 2.0, RequiredTool: ToolTypeAxe, MinTier: 1,
		Drops: []DecorationDrop{{ItemID: "item_wood_log", Min: 1, Max: 3}}},

	// ---- 软岩：徒手可捡的小石 / 一级镐 ----
	{ID: "small_stone", Name: "小石块", Kind: "rock", Hardness: 0.5, PreferredTool: ToolTypePickaxe,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 1, Max: 1}}},
	{ID: "pebble_cluster", Name: "鹅卵石堆", Kind: "rock", Hardness: 0.6, PreferredTool: ToolTypePickaxe,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 1, Max: 2}}},
	{ID: "flat_stone", Name: "平石板", Kind: "rock", Hardness: 1.5, RequiredTool: ToolTypePickaxe, MinTier: 2, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 1, Max: 2}}},
	{ID: "mossy_rock", Name: "苔藓岩", Kind: "rock", Hardness: 1.8, RequiredTool: ToolTypePickaxe, MinTier: 2, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 1, Max: 3}, {ItemID: "item_fiber", Min: 0, Max: 1}}},
	{ID: "weathered_stone", Name: "风化岩", Kind: "rock", Hardness: 1.2, RequiredTool: ToolTypePickaxe, MinTier: 2, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 1, Max: 2}}},
	{ID: "sandstone_rock", Name: "砂岩", Kind: "rock", Hardness: 1.2, RequiredTool: ToolTypePickaxe, MinTier: 2, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_sandstone", Min: 1, Max: 3}}},
	{ID: "desert_rock", Name: "沙漠岩", Kind: "rock", Hardness: 1.5, RequiredTool: ToolTypePickaxe, MinTier: 2, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_sandstone", Min: 1, Max: 2}, {ItemID: "item_stone", Min: 0, Max: 1}}},

	// ---- 硬岩：三级镐 ----
	{ID: "sharp_rock", Name: "尖锐岩", Kind: "rock", Hardness: 3.0, RequiredTool: ToolTypePickaxe, MinTier: 2, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 2, Max: 3}}},
	{ID: "granite_boulder", Name: "花岗岩巨石", Kind: "rock", Hardness: 4.0, RequiredTool: ToolTypePickaxe, MinTier: 3, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_granite", Min: 2, Max: 4}}},
	{ID: "slate_rock", Name: "板岩", Kind: "rock", Hardness: 3.5, RequiredTool: ToolTypePickaxe, MinTier: 3, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 2, Max: 4}}},
	{ID: "basalt_rock", Name: "玄武岩", Kind: "rock", Hardness: 4.5, RequiredTool: ToolTypePickaxe, MinTier: 3, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 3, Max: 5}}},
	{ID: "large_stone", Name: "大石块", Kind: "rock", Hardness: 3.5, RequiredTool: ToolTypePickaxe, MinTier: 3, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "item_stone", Min: 2, Max: 5}}},

	// ---- 玩家建造装饰：对应工具可拆回物品 ----
	{ID: "deco_wood_fence", Name: "木栅栏", Kind: "building", Hardness: 1.0, PreferredTool: ToolTypeAxe, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "block_wood_fence", Min: 1, Max: 1}}},
	{ID: "deco_stone_fence", Name: "石栅栏", Kind: "building", Hardness: 1.8, PreferredTool: ToolTypePickaxe, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "block_stone_fence", Min: 1, Max: 1}}},
	{ID: "deco_wood_wall", Name: "木围墙", Kind: "building", Hardness: 1.5, PreferredTool: ToolTypeAxe, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "block_wood_wall", Min: 1, Max: 1}}},
	{ID: "deco_stone_wall", Name: "石围墙", Kind: "building", Hardness: 2.5, PreferredTool: ToolTypePickaxe, Blocking: true,
		Drops: []DecorationDrop{{ItemID: "block_stone_wall", Min: 1, Max: 1}}},
	{ID: "deco_wood_floor", Name: "木地板", Kind: "building", Hardness: 0.8, PreferredTool: ToolTypeAxe,
		Drops: []DecorationDrop{{ItemID: "block_wood_floor", Min: 1, Max: 1}}},
	{ID: "deco_stone_floor", Name: "石地板", Kind: "building", Hardness: 1.2, PreferredTool: ToolTypePickaxe,
		Drops: []DecorationDrop{{ItemID: "block_stone_floor", Min: 1, Max: 1}}},
	{ID: "deco_torch", Name: "火把", Kind: "building", Hardness: 0.2,
		Drops: []DecorationDrop{{ItemID: "block_torch", Min: 1, Max: 1}}},
}

var decorationDefinitionByID = func() map[string]DecorationDefinition {
	out := make(map[string]DecorationDefinition, len(decorationDefinitions))
	for _, def := range decorationDefinitions {
		out[def.ID] = def
	}
	return out
}()

func decorationDef(id string) (DecorationDefinition, bool) {
	def, ok := decorationDefinitionByID[id]
	return def, ok
}

// validateDecorationDefinitions 供测试断言：掉落物品已注册、建造物品的
// PlacesDecoration 指向已注册装饰、数值合法。
func validateDecorationDefinitions() []string {
	var problems []string
	seen := make(map[string]bool, len(decorationDefinitions))
	for _, def := range decorationDefinitions {
		if seen[def.ID] {
			problems = append(problems, "duplicate decoration id: "+def.ID)
		}
		seen[def.ID] = true
		if def.Hardness <= 0 {
			problems = append(problems, def.ID+": hardness must be positive")
		}
		if def.RequiredTool != "" && def.MinTier <= 0 {
			problems = append(problems, def.ID+": required tool needs min tier")
		}
		for _, drop := range def.Drops {
			if _, ok := itemDef(drop.ItemID); !ok {
				problems = append(problems, def.ID+": unknown drop item "+drop.ItemID)
			}
			if drop.Min < 0 || drop.Max < drop.Min {
				problems = append(problems, def.ID+": invalid drop range for "+drop.ItemID)
			}
		}
	}
	for _, item := range itemDefinitions {
		if item.Type != ItemTypeBlock {
			continue
		}
		if item.PlacesDecoration == "" {
			problems = append(problems, item.ID+": block item missing placesDecoration")
			continue
		}
		if _, ok := decorationDefinitionByID[item.PlacesDecoration]; !ok {
			problems = append(problems, item.ID+": placesDecoration not registered: "+item.PlacesDecoration)
		}
	}
	return problems
}
