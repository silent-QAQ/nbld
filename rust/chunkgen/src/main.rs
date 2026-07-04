use serde::{Deserialize, Serialize};
use std::env;

const CHUNK_TILE_SIZE: i32 = 80;
const MAP_CHUNK_SPAN: i32 = 6400;

#[derive(Debug, Deserialize)]
struct ChunkRequest {
    map_id: String,
    chunk_x: i32,
    chunk_y: i32,
}

#[derive(Debug, Serialize)]
struct ChunkCoord {
    #[serde(rename = "mapId")]
    map_id: String,
    #[serde(rename = "chunkX")]
    chunk_x: i32,
    #[serde(rename = "chunkY")]
    chunk_y: i32,
}

#[derive(Debug, Serialize)]
struct ChunkTile {
    x: i32,
    y: i32,
    terrain: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    block: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    feature: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    decoration: String,
    #[serde(rename = "levelHint", skip_serializing_if = "String::is_empty")]
    level_hint: String,
}

#[derive(Debug, Serialize)]
struct ChunkSnapshot {
    coord: ChunkCoord,
    biome: String,
    generated: bool,
    dirty: bool,
    tiles: Vec<ChunkTile>,
    #[serde(rename = "edgeNorth")]
    edge_north: String,
    #[serde(rename = "edgeSouth")]
    edge_south: String,
    #[serde(rename = "edgeWest")]
    edge_west: String,
    #[serde(rename = "edgeEast")]
    edge_east: String,
}

struct BiomeCandidate {
    name: &'static str,
    weight: f64,
}

impl BiomeCandidate {
    fn new(name: &'static str, weight: f64) -> Self {
        Self { name, weight }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 5 {
        eprintln!("usage: chunkgen <map_id> <chunk_x> <chunk_y> <seed>");
        std::process::exit(1);
    }

    let request = ChunkRequest {
        map_id: args[1].clone(),
        chunk_x: args[2].parse().unwrap_or(0),
        chunk_y: args[3].parse().unwrap_or(0),
    };

    let seed = args[4].parse().unwrap_or(0_i64);
    let chunk = generate_chunk(&request, seed);
    println!("{}", serde_json::to_string(&chunk).unwrap());
}

fn generate_chunk(request: &ChunkRequest, seed: i64) -> ChunkSnapshot {
    let (map_x, map_y) = parse_map_offset(&request.map_id);
    let global_chunk_x = map_x * MAP_CHUNK_SPAN + request.chunk_x;
    let global_chunk_y = map_y * MAP_CHUNK_SPAN + request.chunk_y;
    let biome = classify_biome(global_chunk_x as f64, global_chunk_y as f64, seed);
    let mut tiles = Vec::new();

    for y in 0..CHUNK_TILE_SIZE {
        for x in 0..CHUNK_TILE_SIZE {
            let global_x = global_chunk_x * CHUNK_TILE_SIZE + x;
            let global_y = global_chunk_y * CHUNK_TILE_SIZE + y;
            let terrain = classify_terrain(global_x as f64, global_y as f64, seed);
            let (feature, level_hint) = decorate_terrain(&terrain, global_x, global_y);
            let block = base_block_for_terrain(&terrain, global_x, global_y, seed);
            let decoration = map_decoration_for_terrain(&terrain, global_x, global_y, seed);
            tiles.push(ChunkTile {
                x,
                y,
                terrain,
                block,
                feature,
                decoration,
                level_hint,
            });
        }
    }

    ChunkSnapshot {
        coord: ChunkCoord {
            map_id: request.map_id.clone(),
            chunk_x: request.chunk_x,
            chunk_y: request.chunk_y,
        },
        biome: biome.clone(),
        generated: true,
        dirty: false,
        tiles,
        edge_north: biome.clone(),
        edge_south: biome.clone(),
        edge_west: biome.clone(),
        edge_east: biome,
    }
}

fn classify_biome(x: f64, y: f64, seed: i64) -> String {
    classify_terrain(x * CHUNK_TILE_SIZE as f64, y * CHUNK_TILE_SIZE as f64, seed)
}

fn classify_terrain(world_x: f64, world_y: f64, seed: i64) -> String {
    let x = world_x / CHUNK_TILE_SIZE as f64;
    let y = world_y / CHUNK_TILE_SIZE as f64;
    let seed_shift_a = (seed % 104729) as f64 - 52364.0;
    let seed_shift_b = (seed % 130363) as f64 - 65181.0;

    let elevation = (layered_noise(
        (x + seed_shift_a) * 0.00135 - 91.0,
        (y - seed_shift_b) * 0.00135 + 73.0,
        1.0,
        0.58,
        6,
    ) + layered_noise(
        (x - seed_shift_b) * 0.0045 + 13.0,
        (y + seed_shift_a) * 0.0045 - 29.0,
        0.18,
        0.5,
        3,
    ))
    .clamp(-1.0, 1.0);
    let temperature = (layered_noise(
        (x - seed_shift_a) * 0.00115,
        (y + seed_shift_b) * 0.00115,
        1.0,
        0.56,
        5,
    ) + layered_noise(
        (x + seed_shift_b) * 0.0048 + 41.0,
        (y - seed_shift_a) * 0.0048 - 17.0,
        0.24,
        0.52,
        3,
    ))
    .clamp(-1.0, 1.0);
    let moisture = (layered_noise(
        (x + seed_shift_a) * 0.00145,
        (y - seed_shift_b) * 0.00145,
        1.0,
        0.56,
        5,
    ) + layered_noise(
        (x - seed_shift_b) * 0.0055,
        (y + seed_shift_a) * 0.0055,
        0.28,
        0.52,
        3,
    ))
    .clamp(-1.0, 1.0);
    let roughness = layered_noise(
        (x - seed_shift_a) * 0.0038 + 173.0,
        (y + seed_shift_b) * 0.0038 - 83.0,
        1.0,
        0.55,
        4,
    )
    .clamp(-1.0, 1.0);

    if elevation < -0.12 {
        let depth = ((-elevation - 0.12) * 2.0).clamp(0.0, 1.0);
        return match temperature_band(temperature) {
            "frigid" => choose_biome(
                &[
                    BiomeCandidate::new("frozen_ice_ocean", 4.0),
                    BiomeCandidate::new("cold_deep_ocean", 7.0 + depth * 3.0),
                ],
                x,
                y,
                seed,
                11,
            ),
            "cold" => choose_biome(
                &[
                    BiomeCandidate::new("cold_deep_ocean", 7.0 + depth * 3.0),
                    BiomeCandidate::new("temperate_near_sea", 8.0),
                ],
                x,
                y,
                seed,
                12,
            ),
            "tropical" => choose_biome(
                &[
                    BiomeCandidate::new("tropical_coral_sea", 6.0),
                    BiomeCandidate::new("tropical_deep_ocean", 9.0 + depth * 3.0),
                ],
                x,
                y,
                seed,
                13,
            ),
            _ => choose_biome(
                &[
                    BiomeCandidate::new("temperate_near_sea", 8.0),
                    BiomeCandidate::new("temperate_open_ocean", 12.0 + depth * 3.0),
                ],
                x,
                y,
                seed,
                14,
            ),
        };
    }

    let highland = elevation > 0.34 || (elevation > 0.2 && roughness > 0.42);
    let moist_band = moisture_band(moisture);

    match temperature_band(temperature) {
        "frigid" => {
            if highland {
                choose_biome(
                    &[
                        BiomeCandidate::new("snow_plateau", 3.0),
                        BiomeCandidate::new("glacier_mountain", 2.0),
                    ],
                    x,
                    y,
                    seed,
                    21,
                )
            } else {
                match moist_band {
                    "arid" => "polar_tundra".to_string(),
                    "humid" => choose_biome(
                        &[
                            BiomeCandidate::new("frozen_swamp", 3.0),
                            BiomeCandidate::new("snow_conifer_forest", 6.0),
                        ],
                        x,
                        y,
                        seed,
                        22,
                    ),
                    _ => choose_biome(
                        &[
                            BiomeCandidate::new("polar_tundra", 5.0),
                            BiomeCandidate::new("snow_conifer_forest", 6.0),
                        ],
                        x,
                        y,
                        seed,
                        23,
                    ),
                }
            }
        }
        "cold" => {
            if highland {
                if moist_band == "humid" {
                    "conifer_hills".to_string()
                } else {
                    "alpine_meadow".to_string()
                }
            } else {
                if moist_band == "humid" {
                    "boreal_forest".to_string()
                } else {
                    "cold_grassland".to_string()
                }
            }
        }
        "tropical" => match moist_band {
            "arid" => choose_biome(
                &[
                    BiomeCandidate::new("desert", 7.0),
                    BiomeCandidate::new("gobi", 4.0),
                ],
                x,
                y,
                seed,
                31,
            ),
            "humid" => "tropical_rainforest".to_string(),
            _ => "tropical_savanna".to_string(),
        },
        _ => {
            if highland {
                match moist_band {
                    "arid" => "rocky_mountain".to_string(),
                    "humid" => choose_biome(
                        &[
                            BiomeCandidate::new("broadleaf_hills", 6.0),
                            BiomeCandidate::new("cloud_forest", 2.0),
                        ],
                        x,
                        y,
                        seed,
                        41,
                    ),
                    _ => "mountain_meadow".to_string(),
                }
            } else {
                match moist_band {
                    "humid" => choose_biome(
                        &[
                            BiomeCandidate::new("deciduous_forest", 7.0),
                            BiomeCandidate::new("temperate_wetland", 4.0),
                        ],
                        x,
                        y,
                        seed,
                        42,
                    ),
                    _ => "temperate_plains".to_string(),
                }
            }
        }
    }
}

fn decorate_terrain(terrain: &str, global_x: i32, global_y: i32) -> (String, String) {
    let river_line = layered_noise(
        global_x as f64 * 0.00022 - 150.0,
        global_y as f64 * 0.00022 + 70.0,
        1.0,
        0.5,
        4,
    )
    .abs();

    if is_water_terrain(terrain) {
        return (String::new(), String::new());
    }

    if river_line < 0.018 && terrain != "glacier_mountain" && terrain != "rocky_mountain" {
        return ("river".to_string(), String::new());
    }
    (String::new(), String::new())
}

#[derive(Clone)]
struct BlockWeight {
    block: &'static str,
    weight: i32,
}

struct TerrainPalette {
	main: &'static str,
	secondary: Vec<BlockWeight>,
	plants: Vec<BlockWeight>,
	rocks: Vec<BlockWeight>,
}

fn base_block_for_terrain(terrain: &str, global_x: i32, global_y: i32, seed: i64) -> String {
    if should_generate_plateau_mountain_body(terrain, global_x, global_y, seed) {
        return "mountain_rock".to_string();
    }

    match terrain_palette(terrain) {
        Some(palette) => {
            let mut candidates = Vec::with_capacity(1 + palette.secondary.len());
            candidates.push(BlockWeight {
                block: palette.main,
                weight: 70,
            });
			for item in &palette.secondary {
                candidates.push(BlockWeight {
                    block: item.block,
                    weight: item.weight,
                });
            }
            choose_block(&candidates, global_x, global_y, seed, 501).to_string()
        }
        None => "unknown_ground".to_string(),
    }
}

fn should_generate_plateau_mountain_body(terrain: &str, global_x: i32, global_y: i32, seed: i64) -> bool {
    if !is_plateau_terrain(terrain) {
        return false;
    }

    let cluster_x = floor_div(global_x, 5);
    let cluster_y = floor_div(global_y, 5);
    if deterministic_int(cluster_x, cluster_y, seed, 1701) % 10_000 >= 750 {
        return false;
    }

    is_near_plateau_boundary(global_x, global_y, seed)
}

fn is_near_plateau_boundary(global_x: i32, global_y: i32, seed: i64) -> bool {
    let chunk_x = floor_div(global_x, CHUNK_TILE_SIZE);
    let chunk_y = floor_div(global_y, CHUNK_TILE_SIZE);
    let directions = [(1, 0), (-1, 0), (0, 1), (0, -1)];
    for distance in 1..=5 {
        for (dx, dy) in directions {
            let terrain = classify_biome(
                (chunk_x + dx * distance) as f64,
                (chunk_y + dy * distance) as f64,
                seed,
            );
            if !is_plateau_terrain(&terrain) {
                return true;
            }
        }
    }
    false
}

fn is_plateau_terrain(terrain: &str) -> bool {
    matches!(terrain, "snow_plateau" | "mountain_meadow" | "alpine_meadow")
}

fn floor_div(value: i32, divisor: i32) -> i32 {
    if value >= 0 {
        value / divisor
    } else {
        -((-value + divisor - 1) / divisor)
    }
}

fn map_decoration_for_terrain(terrain: &str, global_x: i32, global_y: i32, seed: i64) -> String {
    let Some(palette) = terrain_palette(terrain) else {
        return String::new();
    };

	let rock_chance = decoration_chance(&palette.rocks, 90);
	let plant_chance = decoration_chance(&palette.plants, 220);

	if !palette.rocks.is_empty()
		&& deterministic_int(global_x, global_y, seed, 701) % 10_000 < rock_chance
	{
		return choose_block(&palette.rocks, global_x, global_y, seed, 711).to_string();
	}
	if !palette.plants.is_empty()
		&& deterministic_int(global_x, global_y, seed, 801) % 10_000 < plant_chance
	{
		return choose_block(&palette.plants, global_x, global_y, seed, 811).to_string();
	}
    String::new()
}

fn terrain_palette(terrain: &str) -> Option<TerrainPalette> {
    match terrain {
        "frozen_ice_ocean" => Some(p("deep_ice_water", &[bw("ice_water", 12), bw("packed_ice", 10), bw("cold_deep_water", 6)], &[], &[])),
        "cold_deep_ocean" => Some(p("cold_deep_water", &[bw("deep_ice_water", 8), bw("open_ocean_water", 6)], &[], &[])),
        "temperate_near_sea" => Some(p("shallow_sea_water", &[bw("wave_water", 10), bw("coast_sand", 8), bw("open_ocean_water", 6)], &[], &[])),
        "temperate_open_ocean" => Some(p("open_ocean_water", &[bw("wave_water", 10), bw("cold_deep_water", 6)], &[], &[])),
        "tropical_coral_sea" => Some(p("tropical_shallow_water", &[bw("wave_water", 10), bw("tropical_deep_water", 6)], &[], &[])),
        "tropical_deep_ocean" => Some(p("tropical_deep_water", &[bw("tropical_shallow_water", 8), bw("open_ocean_water", 6)], &[], &[])),
        "polar_tundra" => Some(p("frozen_soil", &[bw("snow", 12), bw("cold_grass", 8), bw("dirt", 6)], &[bw("grass_tuft", 4), bw("snow_bush", 3), bw("lichen_patch", 3)], &[bw("small_stone", 3), bw("flat_stone", 2)])),
        "frozen_swamp" => Some(p("wet_mud", &[bw("ice", 10), bw("frozen_soil", 8), bw("mud", 6)], &[bw("reed", 5), bw("swamp_reed", 5), bw("bog_flower", 2)], &[bw("small_stone", 3), bw("mossy_rock", 2)])),
        "snow_conifer_forest" => Some(p("needle_floor", &[bw("snow", 12), bw("frozen_soil", 8), bw("forest_floor", 6)], &[bw("tree_conifer", 10), bw("pine_sapling", 6), bw("snow_bush", 3)], &[bw("small_stone", 3), bw("mossy_rock", 2)])),
        "snow_plateau" => Some(p("snow", &[bw("frozen_soil", 10), bw("rocky_soil", 8), bw("plateau_grass", 4), bw("hard_snow", 4)], &[bw("alpine_shrub", 4), bw("lichen_patch", 4)], &[bw("small_stone", 5), bw("granite_boulder", 3), bw("sharp_rock", 2)])),
        "glacier_mountain" => Some(p("ice", &[bw("snow", 10), bw("mountain_rock", 8), bw("rock", 6), bw("glacier_rock", 6)], &[], &[bw("small_stone", 6), bw("sharp_rock", 5), bw("granite_boulder", 4), bw("slate_rock", 3)])),
        "cold_grassland" => Some(p("cold_grass", &[bw("grass", 10), bw("frozen_soil", 8), bw("dirt", 6)], &[bw("grass_tuft", 7), bw("cold_shrub", 5), bw("white_flower", 2)], &[bw("small_stone", 3), bw("pebble_cluster", 2)])),
        "boreal_forest" => Some(p("forest_floor", &[bw("forest_floor", 12), bw("cold_grass", 8), bw("snow", 4)], &[bw("tree_conifer", 12), bw("pine_sapling", 6), bw("fallen_log", 3), bw("stump", 2)], &[bw("small_stone", 4), bw("mossy_rock", 3)])),
        "conifer_hills" => Some(p("forest_floor", &[bw("rocky_soil", 10), bw("cold_grass", 8), bw("forest_floor", 6)], &[bw("tree_conifer", 8), bw("pine_sapling", 5), bw("hill_shrub", 4)], &[bw("small_stone", 6), bw("sharp_rock", 4), bw("mossy_rock", 3)])),
        "alpine_meadow" => Some(p("plateau_grass", &[bw("rocky_soil", 12), bw("grass", 8), bw("dirt", 6)], &[bw("grass_tuft", 7), bw("alpine_flower", 5), bw("purple_flower", 3), bw("alpine_shrub", 4)], &[bw("small_stone", 4), bw("flat_stone", 3)])),
        "temperate_plains" => Some(p("grass", &[bw("dirt", 10), bw("dry_grass", 6), bw("plateau_grass", 4)], &[bw("grass_tuft", 8), bw("flower", 5), bw("red_flower", 4), bw("blue_flower", 4), bw("purple_flower", 3), bw("clover_patch", 3)], &[bw("small_stone", 2), bw("pebble_cluster", 2)])),
        "deciduous_forest" => Some(p("forest_floor", &[bw("leaf_litter", 10), bw("grass", 8), bw("dirt", 6), bw("moss", 4)], &[bw("tree_deciduous", 12), bw("broadleaf_sapling", 5), bw("berry_bush", 4), bw("mushroom_red", 3), bw("stump", 2)], &[bw("small_stone", 3), bw("mossy_rock", 3)])),
        "temperate_wetland" => Some(p("wet_mud", &[bw("shallow_sea_water", 8), bw("dirt", 6), bw("grass", 4)], &[bw("reed", 8), bw("swamp_reed", 6), bw("water_lily", 4), bw("bog_flower", 3)], &[bw("small_stone", 2), bw("flat_stone", 2)])),
        "broadleaf_hills" => Some(p("forest_floor", &[bw("rocky_soil", 10), bw("leaf_litter", 8), bw("grass", 6)], &[bw("tree_deciduous", 8), bw("broadleaf_sapling", 5), bw("berry_bush", 4), bw("fern", 3)], &[bw("small_stone", 6), bw("large_stone", 3), bw("mossy_rock", 3)])),
        "mountain_meadow" => Some(p("plateau_grass", &[bw("rocky_soil", 10), bw("plateau_grass", 8), bw("mountain_rock", 6)], &[bw("grass_tuft", 7), bw("alpine_flower", 4), bw("alpine_shrub", 4)], &[bw("small_stone", 5), bw("granite_boulder", 4), bw("flat_stone", 3)])),
        "rocky_mountain" => Some(p("mountain_rock", &[bw("rock", 10), bw("gravel", 8), bw("rocky_soil", 6), bw("cliff_rock", 6)], &[bw("thorn_bush", 2), bw("dead_tree", 1)], &[bw("small_stone", 8), bw("sharp_rock", 6), bw("large_stone", 4), bw("slate_rock", 3), bw("basalt_rock", 3)])),
        "cloud_forest" => Some(p("rainforest_floor", &[bw("forest_floor", 10), bw("wet_mud", 8), bw("grass", 6)], &[bw("tree_jungle", 8), bw("jungle_fern", 7), bw("jungle_vine", 5), bw("mushroom_brown", 3)], &[bw("small_stone", 4), bw("mossy_rock", 4)])),
        "tropical_savanna" => Some(p("dry_grass", &[bw("dirt", 10), bw("sand", 6), bw("grass", 4)], &[bw("bush", 5), bw("dry_bush", 4), bw("acacia_sapling", 3), bw("thorn_bush", 3)], &[bw("small_stone", 3), bw("weathered_stone", 3)])),
        "desert" => Some(p("sand", &[bw("dune_sand", 10), bw("dry_soil", 6), bw("gravel", 6)], &[bw("dry_bush", 2), bw("cactus", 3), bw("desert_cactus", 3)], &[bw("small_stone", 5), bw("sandstone_rock", 4), bw("desert_rock", 3)])),
        "gobi" => Some(p("gravel", &[bw("dry_soil", 10), bw("sand", 8), bw("rocky_soil", 6)], &[bw("dry_bush", 4), bw("thorn_bush", 3)], &[bw("small_stone", 6), bw("weathered_stone", 4), bw("desert_rock", 3)])),
        "tropical_rainforest" => Some(p("rainforest_floor", &[bw("wet_mud", 10), bw("forest_floor", 8), bw("grass", 6)], &[bw("tree_jungle", 12), bw("jungle_fern", 8), bw("jungle_vine", 6), bw("palm_sapling", 4), bw("mushroom_brown", 3)], &[bw("small_stone", 4), bw("mossy_rock", 4)])),
        _ => None,
    }
}

fn p(
	main: &'static str,
	secondary: &[BlockWeight],
	plants: &[BlockWeight],
	rocks: &[BlockWeight],
) -> TerrainPalette {
	TerrainPalette {
		main,
		secondary: secondary.to_vec(),
		plants: plants.to_vec(),
		rocks: rocks.to_vec(),
	}
}

const fn bw(block: &'static str, weight: i32) -> BlockWeight {
    BlockWeight { block, weight }
}

fn decoration_chance(candidates: &[BlockWeight], base: i32) -> i32 {
    let total = candidates
        .iter()
        .filter(|candidate| candidate.weight > 0)
        .map(|candidate| candidate.weight)
        .sum::<i32>()
        .min(20);
    if total <= 0 {
        0
    } else {
        base + total * 18
    }
}

fn choose_block<'a>(
    candidates: &'a [BlockWeight],
    global_x: i32,
    global_y: i32,
    seed: i64,
    salt: i64,
) -> &'a str {
    let total = candidates
        .iter()
        .filter(|candidate| candidate.weight > 0)
        .map(|candidate| candidate.weight)
        .sum::<i32>();
    if total <= 0 {
        return "";
    }

    let mut value = deterministic_int(global_x, global_y, seed, salt) % total;
    for candidate in candidates {
        if candidate.weight <= 0 {
            continue;
        }
        if value < candidate.weight {
            return candidate.block;
        }
        value -= candidate.weight;
    }
    candidates[candidates.len() - 1].block
}

fn deterministic_int(global_x: i32, global_y: i32, seed: i64, salt: i64) -> i32 {
    let mut n = (global_x as i64)
        .wrapping_mul(374_761_393)
        .wrapping_add((global_y as i64).wrapping_mul(668_265_263))
        .wrapping_add(seed.wrapping_mul(1_442_695_040_888_963_407))
        .wrapping_add(salt.wrapping_mul(1_274_126_177));
    n = (n ^ (n >> 13)).wrapping_mul(1_274_126_177);
    ((n ^ (n >> 16)) & 0x7fff_ffff) as i32
}

fn parse_map_offset(map_id: &str) -> (i32, i32) {
    let parts: Vec<&str> = map_id.split('_').collect();
    if parts.len() != 3 {
        return (0, 0);
    }

    let map_x = parts[1].parse().unwrap_or(0);
    let map_y = parts[2].parse().unwrap_or(0);
    (map_x, map_y)
}

fn layered_noise(
    mut x: f64,
    mut y: f64,
    mut amplitude: f64,
    persistence: f64,
    octaves: usize,
) -> f64 {
    let mut total = 0.0;
    let mut normalization = 0.0;

    for _ in 0..octaves {
        total += amplitude * value_noise(x, y);
        normalization += amplitude;
        x *= 2.03;
        y *= 2.11;
        amplitude *= persistence;
    }

    total / normalization
}

fn value_noise(x: f64, y: f64) -> f64 {
    let x0 = x.floor();
    let y0 = y.floor();
    let tx = x - x0;
    let ty = y - y0;

    let v00 = pseudo_random(x0 as i64, y0 as i64);
    let v10 = pseudo_random(x0 as i64 + 1, y0 as i64);
    let v01 = pseudo_random(x0 as i64, y0 as i64 + 1);
    let v11 = pseudo_random(x0 as i64 + 1, y0 as i64 + 1);

    let sx = smoothstep(tx);
    let sy = smoothstep(ty);

    let ix0 = lerp(v00, v10, sx);
    let ix1 = lerp(v01, v11, sx);
    lerp(ix0, ix1, sy)
}

fn pseudo_random(x: i64, y: i64) -> f64 {
    let mut n = x
        .wrapping_mul(374_761_393)
        .wrapping_add(y.wrapping_mul(668_265_263));
    n = (n ^ (n >> 13)).wrapping_mul(1_274_126_177);
    let normalized = ((n ^ (n >> 16)) & 0x7fff_ffff) as f64 / 2_147_483_647.0;
    normalized * 2.0 - 1.0
}

fn smoothstep(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn is_water_terrain(terrain: &str) -> bool {
    matches!(
        terrain,
        "frozen_ice_ocean"
            | "cold_deep_ocean"
            | "temperate_near_sea"
            | "temperate_open_ocean"
            | "tropical_coral_sea"
            | "tropical_deep_ocean"
            | "ocean"
            | "tropical_ocean"
            | "ice_ocean"
            | "lake"
            | "river"
    )
}

fn choose_biome(candidates: &[BiomeCandidate], x: f64, y: f64, seed: i64, salt: i64) -> String {
    if candidates.is_empty() {
        return "temperate_plains".to_string();
    }

    let total = candidates
        .iter()
        .map(|candidate| candidate.weight.max(0.0))
        .sum::<f64>();
    if total <= 0.0 {
        return candidates[0].name.to_string();
    }

    let noise = value_noise(
        (x + (seed % 104729) as f64 + salt as f64 * 113.0) * 0.0032,
        (y - (seed % 130363) as f64 - salt as f64 * 67.0) * 0.0032,
    );
    let pick = (noise + 1.0) * 0.5 * total;
    let mut accumulated = 0.0;
    for candidate in candidates {
        accumulated += candidate.weight.max(0.0);
        if pick <= accumulated {
            return candidate.name.to_string();
        }
    }

    candidates[candidates.len() - 1].name.to_string()
}

fn temperature_band(temperature: f64) -> &'static str {
    if temperature < -0.55 {
        "frigid"
    } else if temperature < -0.18 {
        "cold"
    } else if temperature > 0.48 {
        "tropical"
    } else {
        "temperate"
    }
}

fn moisture_band(moisture: f64) -> &'static str {
    if moisture < -0.28 {
        "arid"
    } else if moisture > 0.28 {
        "humid"
    } else {
        "semi_humid"
    }
}
