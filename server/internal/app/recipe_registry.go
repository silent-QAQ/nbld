package app

import "strings"

// 配方注册表：模仿《我的世界》3x3 工作台。
// shaped 配方按图案匹配（允许在 3x3 内任意平移）；shapeless 只看物品数量集合。
// 客户端拉取 GET /api/v1/recipes 做本地预览，craft 时服务端重新校验。

type Recipe struct {
	ID string `json:"id"`
	// Shaped 为 true 时使用 Pattern（9 格，行优先，空格为 ""）；
	// 否则使用 Inputs（物品 ID → 数量）。
	Shaped  bool           `json:"shaped"`
	Pattern []string       `json:"pattern,omitempty"`
	Inputs  map[string]int `json:"inputs,omitempty"`
	Output  ItemStack      `json:"output"`
}

var recipeDefinitions = []Recipe{
	// 基础材料链
	{ID: "recipe_planks", Shaped: false,
		Inputs: map[string]int{"item_wood_log": 1},
		Output: ItemStack{ItemID: "item_wood_plank", Quantity: 4}},
	{ID: "recipe_sticks", Shaped: true,
		Pattern: []string{
			"item_wood_plank", "", "",
			"item_wood_plank", "", "",
			"", "", ""},
		Output: ItemStack{ItemID: "item_stick", Quantity: 4}},
	{ID: "recipe_iron_ingot", Shaped: false,
		Inputs: map[string]int{"item_iron_ore": 2},
		Output: ItemStack{ItemID: "item_iron_ingot", Quantity: 1}},

	// 采集工具：斧 = 材料×3 + 木棍×2（L形），镐 = 材料×3 + 木棍×2（T形），
	// 镰 = 材料×2 + 木棍×1（弯刃）。与剑同风格的竖排布局。
	{ID: "recipe_wood_axe", Shaped: true,
		Pattern: []string{
			"item_wood_plank", "item_wood_plank", "",
			"item_wood_plank", "item_stick", "",
			"", "item_stick", ""},
		Output: ItemStack{ItemID: "tool_wood_axe", Quantity: 1}},
	{ID: "recipe_stone_axe", Shaped: true,
		Pattern: []string{
			"item_stone", "item_stone", "",
			"item_stone", "item_stick", "",
			"", "item_stick", ""},
		Output: ItemStack{ItemID: "tool_stone_axe", Quantity: 1}},
	{ID: "recipe_iron_axe", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "item_iron_ingot", "",
			"item_iron_ingot", "item_stick", "",
			"", "item_stick", ""},
		Output: ItemStack{ItemID: "tool_iron_axe", Quantity: 1}},
	{ID: "recipe_stone_pickaxe", Shaped: true,
		Pattern: []string{
			"item_stone", "item_stone", "item_stone",
			"", "item_stick", "",
			"", "item_stick", ""},
		Output: ItemStack{ItemID: "tool_stone_pickaxe", Quantity: 1}},
	{ID: "recipe_iron_pickaxe", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "item_iron_ingot", "item_iron_ingot",
			"", "item_stick", "",
			"", "item_stick", ""},
		Output: ItemStack{ItemID: "tool_iron_pickaxe", Quantity: 1}},
	{ID: "recipe_stone_sickle", Shaped: true,
		Pattern: []string{
			"item_stone", "item_stone", "",
			"", "item_stick", "",
			"", "", ""},
		Output: ItemStack{ItemID: "tool_stone_sickle", Quantity: 1}},
	{ID: "recipe_iron_sickle", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "item_iron_ingot", "",
			"", "item_stick", "",
			"", "", ""},
		Output: ItemStack{ItemID: "tool_iron_sickle", Quantity: 1}},

	// 建造方块
	{ID: "recipe_wood_fence", Shaped: true,
		Pattern: []string{
			"item_wood_plank", "item_stick", "item_wood_plank",
			"item_wood_plank", "item_stick", "item_wood_plank",
			"", "", ""},
		Output: ItemStack{ItemID: "block_wood_fence", Quantity: 8}},
	{ID: "recipe_stone_fence", Shaped: true,
		Pattern: []string{
			"item_stone", "item_stick", "item_stone",
			"item_stone", "item_stick", "item_stone",
			"", "", ""},
		Output: ItemStack{ItemID: "block_stone_fence", Quantity: 8}},
	{ID: "recipe_wood_wall", Shaped: true,
		Pattern: []string{
			"item_wood_plank", "", "",
			"item_wood_plank", "", "",
			"item_wood_plank", "", ""},
		Output: ItemStack{ItemID: "block_wood_wall", Quantity: 2}},
	{ID: "recipe_stone_wall", Shaped: true,
		Pattern: []string{
			"item_stone", "", "",
			"item_stone", "", "",
			"item_stone", "", ""},
		Output: ItemStack{ItemID: "block_stone_wall", Quantity: 2}},
	{ID: "recipe_wood_floor", Shaped: true,
		Pattern: []string{
			"item_wood_plank", "item_wood_plank", "",
			"item_wood_plank", "item_wood_plank", "",
			"", "", ""},
		Output: ItemStack{ItemID: "block_wood_floor", Quantity: 4}},
	{ID: "recipe_stone_floor", Shaped: true,
		Pattern: []string{
			"item_stone", "item_stone", "",
			"item_stone", "item_stone", "",
			"", "", ""},
		Output: ItemStack{ItemID: "block_stone_floor", Quantity: 4}},
	{ID: "recipe_torch", Shaped: true,
		Pattern: []string{
			"item_wood_plank", "", "",
			"item_stick", "", "",
			"", "", ""},
		Output: ItemStack{ItemID: "block_torch", Quantity: 4}},

	// 剑：竖排 材料/材料/木棍
	{ID: "recipe_wood_sword", Shaped: true,
		Pattern: []string{
			"item_wood_plank", "", "",
			"item_wood_plank", "", "",
			"item_stick", "", ""},
		Output: ItemStack{ItemID: "weapon_wood_sword", Quantity: 1}},
	{ID: "recipe_stone_sword", Shaped: true,
		Pattern: []string{
			"item_stone", "", "",
			"item_stone", "", "",
			"item_stick", "", ""},
		Output: ItemStack{ItemID: "weapon_stone_sword", Quantity: 1}},
	{ID: "recipe_iron_sword", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "", "",
			"item_iron_ingot", "", "",
			"item_stick", "", ""},
		Output: ItemStack{ItemID: "weapon_iron_sword", Quantity: 1}},

	// 皮甲
	{ID: "recipe_leather_helmet", Shaped: true,
		Pattern: []string{
			"item_leather", "item_leather", "item_leather",
			"item_leather", "", "item_leather",
			"", "", ""},
		Output: ItemStack{ItemID: "armor_leather_helmet", Quantity: 1}},
	{ID: "recipe_leather_chest", Shaped: true,
		Pattern: []string{
			"item_leather", "", "item_leather",
			"item_leather", "item_leather", "item_leather",
			"item_leather", "item_leather", "item_leather"},
		Output: ItemStack{ItemID: "armor_leather_chest", Quantity: 1}},
	{ID: "recipe_leather_pants", Shaped: true,
		Pattern: []string{
			"item_leather", "item_leather", "item_leather",
			"item_leather", "", "item_leather",
			"item_leather", "", "item_leather"},
		Output: ItemStack{ItemID: "armor_leather_pants", Quantity: 1}},
	{ID: "recipe_leather_shoes", Shaped: true,
		Pattern: []string{
			"item_leather", "", "item_leather",
			"item_leather", "", "item_leather",
			"", "", ""},
		Output: ItemStack{ItemID: "armor_leather_shoes", Quantity: 1}},

	// 铁甲
	{ID: "recipe_iron_helmet", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "item_iron_ingot", "item_iron_ingot",
			"item_iron_ingot", "", "item_iron_ingot",
			"", "", ""},
		Output: ItemStack{ItemID: "armor_iron_helmet", Quantity: 1}},
	{ID: "recipe_iron_chest", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "", "item_iron_ingot",
			"item_iron_ingot", "item_iron_ingot", "item_iron_ingot",
			"item_iron_ingot", "item_iron_ingot", "item_iron_ingot"},
		Output: ItemStack{ItemID: "armor_iron_chest", Quantity: 1}},
	{ID: "recipe_iron_pants", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "item_iron_ingot", "item_iron_ingot",
			"item_iron_ingot", "", "item_iron_ingot",
			"item_iron_ingot", "", "item_iron_ingot"},
		Output: ItemStack{ItemID: "armor_iron_pants", Quantity: 1}},
	{ID: "recipe_iron_shoes", Shaped: true,
		Pattern: []string{
			"item_iron_ingot", "", "item_iron_ingot",
			"item_iron_ingot", "", "item_iron_ingot",
			"", "", ""},
		Output: ItemStack{ItemID: "armor_iron_shoes", Quantity: 1}},
}

// matchRecipe 在注册表中查找与 3x3 格子内容完全匹配的配方。
// grid 为行优先 9 格，空格用 "" 表示。
func matchRecipe(grid [9]string) (Recipe, bool) {
	for _, recipe := range recipeDefinitions {
		if recipe.matches(grid) {
			return recipe, true
		}
	}
	return Recipe{}, false
}

func (r Recipe) matches(grid [9]string) bool {
	if r.Shaped {
		return matchShaped(r.Pattern, grid)
	}
	return matchShapeless(r.Inputs, grid)
}

// matchShapeless：格子里的物品数量集合与配方输入完全一致（不多不少）。
func matchShapeless(inputs map[string]int, grid [9]string) bool {
	counts := make(map[string]int)
	for _, id := range grid {
		if id != "" {
			counts[id]++
		}
	}
	if len(counts) != len(inputs) {
		return false
	}
	for id, need := range inputs {
		if counts[id] != need {
			return false
		}
	}
	return true
}

// matchShaped：把图案和格子内容各自紧凑化（裁掉空行空列）后逐格比较。
// 这样图案在 3x3 内任意平移都能匹配，与《我的世界》行为一致。
func matchShaped(pattern []string, grid [9]string) bool {
	if len(pattern) != 9 {
		return false
	}
	var patternGrid [9]string
	copy(patternGrid[:], pattern)
	pRows, pCols := trimGrid(patternGrid)
	gRows, gCols := trimGrid(grid)
	if len(pRows) != len(gRows) || len(pCols) != len(gCols) {
		return false
	}
	for ri, pr := range pRows {
		for ci, pc := range pCols {
			if patternGrid[pr*3+pc] != grid[gRows[ri]*3+gCols[ci]] {
				return false
			}
		}
	}
	return true
}

// trimGrid 返回非空的行、列下标（保持顺序），即内容的最小包围盒。
func trimGrid(grid [9]string) (rows []int, cols []int) {
	for r := 0; r < 3; r++ {
		for c := 0; c < 3; c++ {
			if grid[r*3+c] != "" {
				rows = appendUniqueInt(rows, r)
				cols = appendUniqueInt(cols, c)
			}
		}
	}
	return rows, cols
}

func appendUniqueInt(list []int, value int) []int {
	for _, existing := range list {
		if existing == value {
			return list
		}
	}
	return append(list, value)
}

// recipeInputCounts 汇总配方消耗的物品数量（shaped 从图案统计）。
func (r Recipe) inputCounts() map[string]int {
	if !r.Shaped {
		out := make(map[string]int, len(r.Inputs))
		for id, count := range r.Inputs {
			out[id] = count
		}
		return out
	}
	out := make(map[string]int)
	for _, id := range r.Pattern {
		if id != "" {
			out[id]++
		}
	}
	return out
}

// validateRecipeDefinitions 供测试断言配方引用的物品都已注册。
func validateRecipeDefinitions() []string {
	var problems []string
	seen := make(map[string]bool, len(recipeDefinitions))
	for _, recipe := range recipeDefinitions {
		if seen[recipe.ID] {
			problems = append(problems, "duplicate recipe id: "+recipe.ID)
		}
		seen[recipe.ID] = true
		if _, ok := itemDef(recipe.Output.ItemID); !ok {
			problems = append(problems, recipe.ID+": unknown output "+recipe.Output.ItemID)
		}
		for id := range recipe.inputCounts() {
			if _, ok := itemDef(id); !ok {
				problems = append(problems, recipe.ID+": unknown input "+id)
			}
		}
		if recipe.Shaped && len(recipe.Pattern) != 9 {
			problems = append(problems, recipe.ID+": pattern must have 9 cells")
		}
		if recipe.Output.Quantity <= 0 {
			problems = append(problems, recipe.ID+": output quantity must be positive")
		}
	}
	if len(problems) > 0 {
		return []string{strings.Join(problems, "; ")}
	}
	return nil
}
