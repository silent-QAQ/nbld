package app

type blockWeight struct {
	Block  string
	Weight int
}

type terrainBlockPalette struct {
	Main      blockWeight
	Secondary []blockWeight
	Plants    []blockWeight
	Rocks     []blockWeight
}

type mapDecoration struct {
	Kind  string
	Block string
}

var terrainBlockPalettes = map[string]terrainBlockPalette{
	"frozen_ice_ocean":     palette("deep_ice_water", []blockWeight{{"ice_water", 12}, {"packed_ice", 10}, {"cold_deep_water", 6}}, []blockWeight{}, []blockWeight{}),
	"cold_deep_ocean":      palette("cold_deep_water", []blockWeight{{"deep_ice_water", 8}, {"open_ocean_water", 6}}, []blockWeight{}, []blockWeight{}),
	"temperate_near_sea":   palette("shallow_sea_water", []blockWeight{{"wave_water", 10}, {"coast_sand", 8}, {"open_ocean_water", 6}}, []blockWeight{}, []blockWeight{}),
	"temperate_open_ocean": palette("open_ocean_water", []blockWeight{{"wave_water", 10}, {"cold_deep_water", 6}}, []blockWeight{}, []blockWeight{}),
	"tropical_coral_sea":   palette("tropical_shallow_water", []blockWeight{{"wave_water", 10}, {"tropical_deep_water", 6}}, []blockWeight{}, []blockWeight{}),
	"tropical_deep_ocean":  palette("tropical_deep_water", []blockWeight{{"tropical_shallow_water", 8}, {"open_ocean_water", 6}}, []blockWeight{}, []blockWeight{}),
	"polar_tundra":         palette("frozen_soil", []blockWeight{{"snow", 12}, {"cold_grass", 8}, {"dirt", 6}}, []blockWeight{{"grass_tuft", 4}, {"snow_bush", 3}, {"lichen_patch", 3}}, []blockWeight{{"small_stone", 3}, {"flat_stone", 2}}),
	"frozen_swamp":         palette("wet_mud", []blockWeight{{"ice", 10}, {"frozen_soil", 8}, {"mud", 6}}, []blockWeight{{"reed", 5}, {"swamp_reed", 5}, {"bog_flower", 2}}, []blockWeight{{"small_stone", 3}, {"mossy_rock", 2}}),
	"snow_conifer_forest":  palette("needle_floor", []blockWeight{{"snow", 12}, {"frozen_soil", 8}, {"forest_floor", 6}}, []blockWeight{{"tree_conifer", 10}, {"pine_sapling", 6}, {"snow_bush", 3}}, []blockWeight{{"small_stone", 3}, {"mossy_rock", 2}}),
	"snow_plateau":         palette("snow", []blockWeight{{"frozen_soil", 10}, {"rocky_soil", 8}, {"plateau_grass", 4}, {"hard_snow", 4}}, []blockWeight{{"alpine_shrub", 4}, {"lichen_patch", 4}}, []blockWeight{{"small_stone", 5}, {"granite_boulder", 3}, {"sharp_rock", 2}}),
	"glacier_mountain":     palette("ice", []blockWeight{{"snow", 10}, {"mountain_rock", 8}, {"rock", 6}, {"glacier_rock", 6}}, []blockWeight{}, []blockWeight{{"small_stone", 6}, {"sharp_rock", 5}, {"granite_boulder", 4}, {"slate_rock", 3}}),
	"cold_grassland":       palette("cold_grass", []blockWeight{{"grass", 10}, {"frozen_soil", 8}, {"dirt", 6}}, []blockWeight{{"grass_tuft", 7}, {"cold_shrub", 5}, {"white_flower", 2}}, []blockWeight{{"small_stone", 3}, {"pebble_cluster", 2}}),
	"boreal_forest":        palette("forest_floor", []blockWeight{{"forest_floor", 12}, {"cold_grass", 8}, {"snow", 4}}, []blockWeight{{"tree_conifer", 12}, {"pine_sapling", 6}, {"fallen_log", 3}, {"stump", 2}}, []blockWeight{{"small_stone", 4}, {"mossy_rock", 3}}),
	"conifer_hills":        palette("forest_floor", []blockWeight{{"rocky_soil", 10}, {"cold_grass", 8}, {"forest_floor", 6}}, []blockWeight{{"tree_conifer", 8}, {"pine_sapling", 5}, {"hill_shrub", 4}}, []blockWeight{{"small_stone", 6}, {"sharp_rock", 4}, {"mossy_rock", 3}}),
	"alpine_meadow":        palette("plateau_grass", []blockWeight{{"rocky_soil", 12}, {"grass", 8}, {"dirt", 6}}, []blockWeight{{"grass_tuft", 7}, {"alpine_flower", 5}, {"purple_flower", 3}, {"alpine_shrub", 4}}, []blockWeight{{"small_stone", 4}, {"flat_stone", 3}}),
	"temperate_plains":     palette("grass", []blockWeight{{"dirt", 10}, {"dry_grass", 6}, {"plateau_grass", 4}}, []blockWeight{{"grass_tuft", 8}, {"flower", 5}, {"red_flower", 4}, {"blue_flower", 4}, {"purple_flower", 3}, {"clover_patch", 3}}, []blockWeight{{"small_stone", 2}, {"pebble_cluster", 2}}),
	"deciduous_forest":     palette("forest_floor", []blockWeight{{"leaf_litter", 10}, {"grass", 8}, {"dirt", 6}, {"moss", 4}}, []blockWeight{{"tree_deciduous", 12}, {"broadleaf_sapling", 5}, {"berry_bush", 4}, {"mushroom_red", 3}, {"stump", 2}}, []blockWeight{{"small_stone", 3}, {"mossy_rock", 3}}),
	"temperate_wetland":    palette("wet_mud", []blockWeight{{"shallow_sea_water", 8}, {"dirt", 6}, {"grass", 4}}, []blockWeight{{"reed", 8}, {"swamp_reed", 6}, {"water_lily", 4}, {"bog_flower", 3}}, []blockWeight{{"small_stone", 2}, {"flat_stone", 2}}),
	"broadleaf_hills":      palette("forest_floor", []blockWeight{{"rocky_soil", 10}, {"leaf_litter", 8}, {"grass", 6}}, []blockWeight{{"tree_deciduous", 8}, {"broadleaf_sapling", 5}, {"berry_bush", 4}, {"fern", 3}}, []blockWeight{{"small_stone", 6}, {"large_stone", 3}, {"mossy_rock", 3}}),
	"mountain_meadow":      palette("plateau_grass", []blockWeight{{"rocky_soil", 10}, {"plateau_grass", 8}, {"mountain_rock", 6}}, []blockWeight{{"grass_tuft", 7}, {"alpine_flower", 4}, {"alpine_shrub", 4}}, []blockWeight{{"small_stone", 5}, {"granite_boulder", 4}, {"flat_stone", 3}}),
	"rocky_mountain":       palette("mountain_rock", []blockWeight{{"rock", 10}, {"gravel", 8}, {"rocky_soil", 6}, {"cliff_rock", 6}}, []blockWeight{{"thorn_bush", 2}, {"dead_tree", 1}}, []blockWeight{{"small_stone", 8}, {"sharp_rock", 6}, {"large_stone", 4}, {"slate_rock", 3}, {"basalt_rock", 3}}),
	"cloud_forest":         palette("rainforest_floor", []blockWeight{{"forest_floor", 10}, {"wet_mud", 8}, {"grass", 6}}, []blockWeight{{"tree_jungle", 8}, {"jungle_fern", 7}, {"jungle_vine", 5}, {"mushroom_brown", 3}}, []blockWeight{{"small_stone", 4}, {"mossy_rock", 4}}),
	"tropical_savanna":     palette("dry_grass", []blockWeight{{"dirt", 10}, {"sand", 6}, {"grass", 4}}, []blockWeight{{"bush", 5}, {"dry_bush", 4}, {"acacia_sapling", 3}, {"thorn_bush", 3}}, []blockWeight{{"small_stone", 3}, {"weathered_stone", 3}}),
	"desert":               palette("sand", []blockWeight{{"dune_sand", 10}, {"dry_soil", 6}, {"gravel", 6}}, []blockWeight{{"dry_bush", 2}, {"cactus", 3}, {"desert_cactus", 3}}, []blockWeight{{"small_stone", 5}, {"sandstone_rock", 4}, {"desert_rock", 3}}),
	"gobi":                 palette("gravel", []blockWeight{{"dry_soil", 10}, {"sand", 8}, {"rocky_soil", 6}}, []blockWeight{{"dry_bush", 4}, {"thorn_bush", 3}}, []blockWeight{{"small_stone", 6}, {"weathered_stone", 4}, {"desert_rock", 3}}),
	"tropical_rainforest":  palette("rainforest_floor", []blockWeight{{"wet_mud", 10}, {"forest_floor", 8}, {"grass", 6}}, []blockWeight{{"tree_jungle", 12}, {"jungle_fern", 8}, {"jungle_vine", 6}, {"palm_sapling", 4}, {"mushroom_brown", 3}}, []blockWeight{{"small_stone", 4}, {"mossy_rock", 4}}),
}

func palette(main string, secondary []blockWeight, plants []blockWeight, rocks []blockWeight) terrainBlockPalette {
	return terrainBlockPalette{
		Main:      blockWeight{Block: main, Weight: 70},
		Secondary: secondary,
		Plants:    plants,
		Rocks:     rocks,
	}
}

func baseBlockForTerrain(terrain string, globalX, globalY int, seed int64) string {
	if shouldGeneratePlateauMountainBody(terrain, globalX, globalY, seed) {
		return "mountain_rock"
	}

	palette, ok := terrainBlockPalettes[terrain]
	if !ok {
		return "unknown_ground"
	}

	candidates := make([]blockWeight, 0, 1+len(palette.Secondary))
	candidates = append(candidates, palette.Main)
	candidates = append(candidates, palette.Secondary...)
	return chooseBlock(candidates, globalX, globalY, seed, 501)
}

func mainBlockForTerrain(terrain string) string {
	palette, ok := terrainBlockPalettes[terrain]
	if !ok {
		return "unknown_ground"
	}
	return palette.Main.Block
}

func shouldGeneratePlateauMountainBody(terrain string, globalX, globalY int, seed int64) bool {
	if !isPlateauTerrain(terrain) {
		return false
	}

	clusterX := floorDivInt(globalX, 5)
	clusterY := floorDivInt(globalY, 5)
	if deterministicInt(clusterX, clusterY, seed, 1701)%10000 >= 750 {
		return false
	}

	return isNearPlateauBoundary(globalX, globalY, seed)
}

func isNearPlateauBoundary(globalX, globalY int, seed int64) bool {
	chunkX := floorDivInt(globalX, chunkTileSize)
	chunkY := floorDivInt(globalY, chunkTileSize)
	directions := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for distance := 1; distance <= 5; distance++ {
		for _, direction := range directions {
			terrain := pickBiome(float64(chunkX+direction[0]*distance), float64(chunkY+direction[1]*distance), seed)
			if !isPlateauTerrain(terrain) {
				return true
			}
		}
	}
	return false
}

func isPlateauTerrain(terrain string) bool {
	switch terrain {
	case "snow_plateau", "mountain_meadow", "alpine_meadow":
		return true
	default:
		return false
	}
}

func floorDivInt(value, divisor int) int {
	if value >= 0 {
		return value / divisor
	}
	return -((-value + divisor - 1) / divisor)
}

func mapDecorationForTerrain(terrain string, globalX, globalY int, seed int64) mapDecoration {
	palette, ok := terrainBlockPalettes[terrain]
	if !ok {
		return mapDecoration{}
	}

	rockChance := decorationChance(palette.Rocks, 90)
	plantChance := decorationChance(palette.Plants, 220)

	if len(palette.Rocks) > 0 && deterministicInt(globalX, globalY, seed, 701)%10000 < rockChance {
		return mapDecoration{Kind: "rock", Block: chooseBlock(palette.Rocks, globalX, globalY, seed, 711)}
	}
	if len(palette.Plants) > 0 && deterministicInt(globalX, globalY, seed, 801)%10000 < plantChance {
		return mapDecoration{Kind: "plant", Block: chooseBlock(palette.Plants, globalX, globalY, seed, 811)}
	}
	return mapDecoration{}
}

func decorationChance(candidates []blockWeight, base int) int {
	total := 0
	for _, candidate := range candidates {
		if candidate.Weight > 0 {
			total += candidate.Weight
		}
	}
	if total <= 0 {
		return 0
	}
	if total > 20 {
		total = 20
	}
	return base + total*18
}

func chooseBlock(candidates []blockWeight, globalX, globalY int, seed int64, salt int64) string {
	total := 0
	for _, candidate := range candidates {
		if candidate.Weight > 0 {
			total += candidate.Weight
		}
	}
	if total <= 0 {
		return ""
	}

	value := deterministicInt(globalX, globalY, seed, salt) % total
	accumulated := 0
	for _, candidate := range candidates {
		if candidate.Weight <= 0 {
			continue
		}
		accumulated += candidate.Weight
		if value < accumulated {
			return candidate.Block
		}
	}
	return candidates[len(candidates)-1].Block
}

func deterministicInt(globalX, globalY int, seed int64, salt int64) int {
	n := int64(globalX)*374761393 + int64(globalY)*668265263 + seed*1442695040888963407 + salt*1274126177
	n = (n ^ (n >> 13)) * 1274126177
	if n < 0 {
		n = -n
	}
	return int(n & 0x7fffffff)
}
