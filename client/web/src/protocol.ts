export type Position = {
  x: number;
  y: number;
};

export type GuestLoginResponse = {
  playerId: string;
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

export type WorldPlayer = {
  playerId: string;
  characterId?: string;
  characterName?: string;
  mapId?: string;
  position: Position;
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
