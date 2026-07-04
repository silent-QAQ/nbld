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

export type EnterWorldResponse = {
  playerId: string;
  characterId?: string;
  characterName?: string;
  worldId: string;
  mapId?: string;
  position: Position;
};

export type MoveResponse = {
  playerId: string;
  characterId?: string;
  mapId?: string;
  position: Position;
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

export type CharacterStats = {
  base: CharacterBaseStats;
  attack: CharacterAttackStats;
  defense: CharacterDefenseStats;
};

export type ItemStack = {
  itemId: string;
  quantity: number;
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
  frontShoulderWidth: number;
  sideWidth: number;
  chestWidth: number;
  waistWidth: number;
  hipWidth: number;
  torsoHeight: number;
  upperArmWidth: number;
  upperArmLength: number;
  forearmWidth: number;
  forearmLength: number;
  thighWidth: number;
  thighLength: number;
  calfWidth: number;
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

export type WorldPlayer = {
  playerId: string;
  characterId?: string;
  characterName?: string;
  mapId?: string;
  position: Position;
  appearance?: CharacterAppearance;
  equipment?: CharacterEquipment;
};

export type WSServerMessage = {
  type: "auth_ok" | "player_moved" | "map_transition" | "error" | string;
  playerId?: string;
  characterId?: string;
  characterName?: string;
  worldId?: string;
  mapId?: string;
  position?: Position;
  players?: WorldPlayer[];
  error?: string;
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
