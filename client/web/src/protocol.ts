export type Position = {
  x: number;
  y: number;
};

export type GuestLoginResponse = {
  playerId: string;
  token: string;
  serverTime: string;
};

export type RegisterResponse = {
  accountId: string;
  email: string;
  username: string;
  serverTime: string;
};

export type LoginResponse = {
  accountId: string;
  email: string;
  username: string;
  token: string;
  serverTime: string;
};

export type RuntimeResources = {
  healthMax?: number;
  healthCurrent?: number;
  manaMax?: number;
  manaCurrent?: number;
  staminaMax?: number;
  staminaCurrent?: number;
};

export type EnterWorldResponse = {
  playerId: string;
  characterId?: string;
  characterName?: string;
  worldId: string;
  mapId?: string;
  position: Position;
  resources?: RuntimeResources;
  sprinting?: boolean;
};

export type MoveResponse = {
  playerId: string;
  characterId?: string;
  mapId?: string;
  position: Position;
  resources?: RuntimeResources;
  sprinting?: boolean;
};

export type WorldStateResponse = {
  worldId: string;
  mapId?: string;
  playerId: string;
  characterId?: string;
  characterName?: string;
  position: Position;
  resources?: RuntimeResources;
  sprinting?: boolean;
  players: WorldPlayer[];
};

export type TileUpdate = {
  mapId: string;
  x: number;
  y: number;
  decoration: string;
};

export type CharacterBaseStats = {
  health: number;
  stamina: number;
  mana: number;
  moveSpeed: number;
};

export type CharacterAttackStats = {
  physicalAttack: number;
  spellAttack: number;
  physicalCrit: number;
  spellCrit: number;
  damageBonus: number;
  critDamageBonus: number;
  bonusDamage: number;
};

export type CharacterDefenseStats = {
  physicalDefense: number;
  spellDefense: number;
  critResistance: number;
  damageMitigation: number;
  bonusMitigation: number;
};

export type AttributeValues = Record<string, number>;

export type CharacterStatSources = {
  base: AttributeValues;
  levelGrowth: AttributeValues;
  talent: AttributeValues;
  equipment: AttributeValues;
  passiveGem: AttributeValues;
  buff: AttributeValues;
  system: AttributeValues;
  manual?: AttributeValues;
  equipmentNote?: string;
};

export type CharacterDerivedStats = {
  baseStats: AttributeValues;
  derivedStats: AttributeValues;
  combatStats: AttributeValues;
};

export type CharacterResourceStats = {
  healthMax: number;
  healthCurrent: number;
  manaMax: number;
  manaCurrent: number;
  staminaMax: number;
  staminaCurrent: number;
};

export type CharacterCombatStats = {
  resources: CharacterResourceStats;
  physicalAttack: number;
  magicAttack: number;
  physicalDefense: number;
  magicDefense: number;
  moveSpeed: number;
  physicalCrit: number;
  magicCrit: number;
  critDamageBonus: number;
  damageBonus: number;
  extraDamage: number;
  critResist: number;
  damageImmunity: number;
  extraImmunity: number;
  healPower: number;
  healTakenBonus: number;
  powerScore: number;
};

export type AttributeDefinition = {
  code: string;
  displayName: string;
  category: "base" | "attack" | "defense" | "healing" | string;
  valueKind: "flat" | "ratio" | string;
  defaultValue: number;
  minValue?: number;
  maxValue?: number;
  clientVisible: boolean;
  description?: string;
};

export type CharacterStatsMetadata = {
  schemaVersion: number;
  profileId: string;
  attributeDefs?: AttributeDefinition[];
  warnings?: string[];
};

export type CharacterStats = {
  base: CharacterBaseStats;
  attack: CharacterAttackStats;
  defense: CharacterDefenseStats;
  level?: number;
  sources?: CharacterStatSources;
  derived?: CharacterDerivedStats;
  combat?: CharacterCombatStats;
  metadata?: CharacterStatsMetadata;
};

export type ItemStack = {
  itemId: string;
  quantity: number;
  durability?: number;
};

export type ItemContainer = {
  items: ItemStack[];
};

export type CharacterPosition = {
  worldId: string;
  mapId: string;
  x: number;
  y: number;
};

export type VisibleArmor = {
  helmet?: string;
  chest?: string;
  pants?: string;
  shoes?: string;
  shoulders?: string;
};

export type CharacterEquipment = {
  mainHand?: string;
  offHand?: string;
  helmet?: string;
  chest?: string;
  pants?: string;
  shoes?: string;
  shoulders?: string;
  cloak?: string;
  leftBracer?: string;
  rightBracer?: string;
  visibleArmor: VisibleArmor;
};

export type CharacterBodyAppearance = {
  height: number;
  headWidth: number;
  headSideWidth: number;
  frontShoulderWidth: number;
  sideWidth: number;
  chestWidth: number;
  waistWidth: number;
  hipWidth: number;
  torsoHeight: number;
  upperArmWidth: number;
  upperArmSideWidth: number;
  upperArmLength: number;
  forearmWidth: number;
  forearmSideWidth: number;
  forearmLength: number;
  thighWidth: number;
  thighSideWidth: number;
  thighLength: number;
  calfWidth: number;
  calfSideWidth: number;
  calfLength: number;
  chestDepth: number;
  waistDepth: number;
  hipDepth: number;
  headScale: number;
};

export type CharacterStyleAppearance = {
  hairStyle: string;
};

export type CharacterHairAppearance = {
  front: string[];
  back: string[];
  left: string[];
  right: string[];
  frontFg: string[];
  backFg: string[];
  leftFg: string[];
  rightFg: string[];
};

export type CharacterSkeletonAppearance = {
  frontTorso: string[];
  backTorso: string[];
  leftTorso: string[];
  rightTorso: string[];
};

export type CharacterPaletteAppearance = {
  skinPrimary: string;
  skinShadow: string;
  hairPrimary: string;
  hairShadow: string;
  clothPrimary: string;
  clothShadow: string;
  metalPrimary: string;
  metalShadow: string;
  pixelSwatches: string[];
};

export type CharacterAppearance = {
  body: CharacterBodyAppearance;
  style: CharacterStyleAppearance;
  hair: CharacterHairAppearance;
  skeleton: CharacterSkeletonAppearance;
  palette: CharacterPaletteAppearance;
};

export type CharacterSummary = {
  id: string;
  name: string;
  version: number;
  stats: CharacterStats;
  inventory: ItemContainer;
  warehouse: ItemContainer;
  position: CharacterPosition;
  equipment: CharacterEquipment;
  appearance: CharacterAppearance;
  deletedAt?: string;
  purgeAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CharacterListResponse = {
  active: CharacterSummary[];
  deleted: CharacterSummary[];
  activeLimit: number;
  deletedLimit: number;
};

export type CharacterMutationResponse = {
  character: CharacterSummary;
};

// 物品/装备/合成系统

export type ItemDefinition = {
  id: string;
  name: string;
  type: "material" | "consumable" | "equipment" | "tool" | "block";
  rarity: "common" | "uncommon" | "rare";
  stackLimit: number;
  weight: number;
  equipSlot?: string;
  stats?: Record<string, number>;
  description?: string;
  toolType?: string;
  toolTier?: number;
  maxDurability?: number;
  placesDecoration?: string;
};

export type ItemRegistryResponse = {
  items: ItemDefinition[];
};

export type Recipe = {
  id: string;
  shaped: boolean;
  pattern?: string[];
  inputs?: Record<string, number>;
  output: ItemStack;
};

export type RecipeRegistryResponse = {
  recipes: Recipe[];
};

export type CraftResponse = {
  character: CharacterSummary;
  output: ItemStack;
};

export type DecorationDrop = {
  itemId: string;
  min: number;
  max: number;
};

export type DecorationDefinition = {
  id: string;
  name: string;
  kind: string;
  hardness: number;
  requiredTool?: string;
  minTier?: number;
  blocking: boolean;
  preferredTool?: string;
  drops: DecorationDrop[];
};

export type DecorationRegistryResponse = {
  decorations: DecorationDefinition[];
};

export type HarvestResponse = {
  character: CharacterSummary;
  drops: ItemStack[];
  tile: TileUpdate;
};

export type PlaceBlockResponse = {
  character: CharacterSummary;
  tile: TileUpdate;
};

export type WorldPlayer = {
  playerId: string;
  characterId?: string;
  characterName?: string;
  mapId?: string;
  position: Position;
  facing?: string;
  resources?: RuntimeResources;
  sprinting?: boolean;
  appearance?: CharacterAppearance;
  equipment?: CharacterEquipment;
};

export type SlimPlayerState = {
  playerId: string;
  mapId?: string;
  position: Position;
  facing?: string;
  sprinting?: boolean;
  staminaCurrent?: number;
};

export type SnapshotSelf = {
  mapId?: string;
  position: Position;
  sprinting?: boolean;
  staminaCurrent: number;
};

export type WSServerMessage = {
  type:
    | "auth_ok"
    | "self_state"
    | "world_snapshot"
    | "player_moved"
    | "map_transition"
    | "error"
    | string;
  playerId?: string;
  characterId?: string;
  characterName?: string;
  worldId?: string;
  mapId?: string;
  position?: Position;
  resources?: RuntimeResources;
  sprinting?: boolean;
  players?: WorldPlayer[];
  error?: string;
  // world_snapshot fields
  tick?: number;
  self?: SnapshotSelf;
  entered?: WorldPlayer[];
  moved?: SlimPlayerState[];
  left?: string[];
  tile?: TileUpdate;
};

export type ChunkCoord = {
  mapId: string;
  chunkX: number;
  chunkY: number;
};

export type ChunkTile = {
  x: number;
  y: number;
  terrain: string;
  block?: string;
  feature?: string;
  decoration?: string;
  levelHint?: string;
};

export type ChunkSnapshot = {
  coord: ChunkCoord;
  biome: string;
  generated: boolean;
  dirty: boolean;
  lastSaved?: string;
  tiles: ChunkTile[];
  deltaTiles?: ChunkTile[];
  edgeNorth?: string;
  edgeSouth?: string;
  edgeWest?: string;
  edgeEast?: string;
};

export type ChunkWindowResponse = {
  mapId: string;
  centerChunkX: number;
  centerChunkY: number;
  loadRadius: number;
  chunkTileSize: number;
  mapChunkSpan: number;
  chunks: ChunkSnapshot[];
  unloadedChunks: ChunkCoord[];
  transitionMapId?: string;
};
