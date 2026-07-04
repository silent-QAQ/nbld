package protocol

type ChunkCoord struct {
	MapID  string `json:"mapId"`
	ChunkX int    `json:"chunkX"`
	ChunkY int    `json:"chunkY"`
}

type ChunkTile struct {
	X          int    `json:"x"`
	Y          int    `json:"y"`
	Terrain    string `json:"terrain"`
	Block      string `json:"block,omitempty"`
	Feature    string `json:"feature,omitempty"`
	Decoration string `json:"decoration,omitempty"`
	LevelHint  string `json:"levelHint,omitempty"`
}

type ChunkSnapshot struct {
	Coord      ChunkCoord  `json:"coord"`
	Biome      string      `json:"biome"`
	Generated  bool        `json:"generated"`
	Dirty      bool        `json:"dirty"`
	LastSaved  string      `json:"lastSaved,omitempty"`
	Tiles      []ChunkTile `json:"tiles"`
	DeltaTiles []ChunkTile `json:"deltaTiles,omitempty"`
	EdgeNorth  string      `json:"edgeNorth,omitempty"`
	EdgeSouth  string      `json:"edgeSouth,omitempty"`
	EdgeWest   string      `json:"edgeWest,omitempty"`
	EdgeEast   string      `json:"edgeEast,omitempty"`
}

type ChunkWindowResponse struct {
	MapID           string          `json:"mapId"`
	CenterChunkX    int             `json:"centerChunkX"`
	CenterChunkY    int             `json:"centerChunkY"`
	LoadRadius      int             `json:"loadRadius"`
	ChunkTileSize   int             `json:"chunkTileSize"`
	MapChunkSpan    int             `json:"mapChunkSpan"`
	Chunks          []ChunkSnapshot `json:"chunks"`
	UnloadedChunks  []ChunkCoord    `json:"unloadedChunks"`
	TransitionMapID string          `json:"transitionMapId,omitempty"`
}
