const TILE_IDS = [
  "cliff_rock",
  "coast_sand",
  "cold_deep_water",
  "cold_grass",
  "deep_ice_water",
  "dirt",
  "dry_grass",
  "dry_soil",
  "dune_sand",
  "forest_floor",
  "frozen_soil",
  "glacier_rock",
  "grass",
  "gravel",
  "hard_snow",
  "ice",
  "ice_water",
  "leaf_litter",
  "moss",
  "mountain_rock",
  "mud",
  "needle_floor",
  "open_ocean_water",
  "packed_ice",
  "plateau_grass",
  "rainforest_floor",
  "rock",
  "rocky_soil",
  "sand",
  "shallow_sea_water",
  "snow",
  "tropical_deep_water",
  "tropical_shallow_water",
  "wave_water",
  "wet_mud",
] as const;

const DECORATION_IDS = [
  "acacia_sapling",
  "alpine_flower",
  "alpine_shrub",
  "basalt_rock",
  "berry_bush",
  "blue_flower",
  "bog_flower",
  "broadleaf_sapling",
  "bush",
  "cactus",
  "clover_patch",
  "cold_shrub",
  "dead_tree",
  "desert_cactus",
  "desert_rock",
  "dry_bush",
  "fallen_log",
  "fern",
  "flat_stone",
  "flower",
  "granite_boulder",
  "grass_tuft",
  "hill_shrub",
  "jungle_fern",
  "jungle_vine",
  "large_stone",
  "lichen_patch",
  "mossy_rock",
  "mushroom_brown",
  "mushroom_red",
  "palm_sapling",
  "pebble_cluster",
  "pine_sapling",
  "purple_flower",
  "red_flower",
  "reed",
  "sandstone_rock",
  "sharp_rock",
  "slate_rock",
  "small_stone",
  "snow_bush",
  "stump",
  "swamp_reed",
  "thorn_bush",
  "tree_conifer",
  "tree_deciduous",
  "tree_jungle",
  "water_lily",
  "weathered_stone",
  "white_flower",
] as const;

export type AssetMaps = {
  tiles: Map<string, HTMLImageElement>;
  decorations: Map<string, HTMLImageElement>;
};

export async function loadAssets(): Promise<AssetMaps> {
  const tiles = new Map<string, HTMLImageElement>();
  const decorations = new Map<string, HTMLImageElement>();
  await Promise.all([
    ...TILE_IDS.map(async (id) => tiles.set(id, await loadImage(`/art/tiles/${id}.png`))),
    ...DECORATION_IDS.map(async (id) => decorations.set(id, await loadImage(`/art/decorations/${id}.png`))),
  ]);
  return { tiles, decorations };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}
