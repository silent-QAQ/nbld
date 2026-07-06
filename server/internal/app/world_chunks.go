package app

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"nbld/server/internal/protocol"
)

const (
	chunkTileSize = 80
	mapChunkSpan  = 6400
	chunkLoadSpan = 3
	chunkRadius   = chunkLoadSpan / 2
)

type chunkGenerator interface {
	Generate(mapID string, chunkX, chunkY int) (protocol.ChunkSnapshot, error)
}

type goChunkGenerator struct {
	seed *int64
}

func (g *goChunkGenerator) Generate(mapID string, chunkX, chunkY int) (protocol.ChunkSnapshot, error) {
	mapX, mapY := parseMapOffset(mapID)
	globalChunkX := mapX*mapChunkSpan + chunkX
	globalChunkY := mapY*mapChunkSpan + chunkY
	biome := pickBiome(float64(globalChunkX), float64(globalChunkY), *g.seed)
	tiles := make([]protocol.ChunkTile, 0, chunkTileSize*chunkTileSize)

	for y := 0; y < chunkTileSize; y++ {
		for x := 0; x < chunkTileSize; x++ {
			globalX := globalChunkX*chunkTileSize + x
			globalY := globalChunkY*chunkTileSize + y
			tileBiome := pickBiome(float64(globalX)/float64(chunkTileSize), float64(globalY)/float64(chunkTileSize), *g.seed)
			tileFeature, tileLevel := decorateTerrain(tileBiome, globalX, globalY)
			decoration := mapDecorationForTerrain(tileBiome, globalX, globalY, *g.seed)
			tiles = append(tiles, protocol.ChunkTile{
				X:          x,
				Y:          y,
				Terrain:    tileBiome,
				Block:      baseBlockForTerrain(tileBiome, globalX, globalY, *g.seed),
				Feature:    tileFeature,
				Decoration: decoration.Block,
				LevelHint:  tileLevel,
			})
		}
	}

	return protocol.ChunkSnapshot{
		Coord: protocol.ChunkCoord{
			MapID:  mapID,
			ChunkX: chunkX,
			ChunkY: chunkY,
		},
		Biome:     biome,
		Generated: true,
		Tiles:     tiles,
		EdgeNorth: biome,
		EdgeSouth: biome,
		EdgeWest:  biome,
		EdgeEast:  biome,
	}, nil
}

type rustChunkGenerator struct {
	binaryPath string
	fallback   chunkGenerator
	seed       *int64
}

func newRustChunkGenerator(binaryPath string, fallback chunkGenerator, seed *int64) *rustChunkGenerator {
	return &rustChunkGenerator{
		binaryPath: binaryPath,
		fallback:   fallback,
		seed:       seed,
	}
}

func (g *rustChunkGenerator) Generate(mapID string, chunkX, chunkY int) (protocol.ChunkSnapshot, error) {
	cmd := exec.Command(g.binaryPath, mapID, fmt.Sprintf("%d", chunkX), fmt.Sprintf("%d", chunkY), fmt.Sprintf("%d", *g.seed))
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if g.fallback != nil {
			return g.fallback.Generate(mapID, chunkX, chunkY)
		}
		return protocol.ChunkSnapshot{}, fmt.Errorf("rust chunkgen failed: %w: %s", err, stderr.String())
	}

	var chunk protocol.ChunkSnapshot
	if err := json.Unmarshal(stdout.Bytes(), &chunk); err != nil {
		if g.fallback != nil {
			return g.fallback.Generate(mapID, chunkX, chunkY)
		}
		return protocol.ChunkSnapshot{}, err
	}
	return chunk, nil
}

type chunkPersistence struct {
	root string
}

type persistedChunk struct {
	Coord      protocol.ChunkCoord  `json:"coord"`
	Biome      string               `json:"biome"`
	Generated  bool                 `json:"generated"`
	Dirty      bool                 `json:"dirty"`
	LastSaved  string               `json:"lastSaved,omitempty"`
	Tiles      []persistedChunkTile `json:"tiles,omitempty"`
	DeltaTiles []protocol.ChunkTile `json:"deltaTiles,omitempty"`
	EdgeNorth  string               `json:"edgeNorth,omitempty"`
	EdgeSouth  string               `json:"edgeSouth,omitempty"`
	EdgeWest   string               `json:"edgeWest,omitempty"`
	EdgeEast   string               `json:"edgeEast,omitempty"`
}

type persistedChunkTile struct {
	X          int    `json:"x"`
	Y          int    `json:"y"`
	Type       string `json:"type,omitempty"`
	Terrain    string `json:"terrain,omitempty"`
	Block      string `json:"block,omitempty"`
	Feature    string `json:"feature,omitempty"`
	Decoration string `json:"decoration,omitempty"`
	LevelHint  string `json:"levelHint,omitempty"`
}

func newChunkPersistence(root string) *chunkPersistence {
	return &chunkPersistence{root: root}
}

func (p *chunkPersistence) load(coord protocol.ChunkCoord) (protocol.ChunkSnapshot, bool, error) {
	path := p.pathFor(coord)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return protocol.ChunkSnapshot{}, false, nil
		}
		return protocol.ChunkSnapshot{}, false, err
	}

	var chunk persistedChunk
	if err := json.Unmarshal(data, &chunk); err != nil {
		return protocol.ChunkSnapshot{}, false, err
	}
	return protocol.ChunkSnapshot{
		Coord:      chunk.Coord,
		Biome:      chunk.Biome,
		Generated:  chunk.Generated,
		Dirty:      chunk.Dirty,
		LastSaved:  chunk.LastSaved,
		Tiles:      restorePersistedTiles(chunk.Tiles),
		DeltaTiles: chunk.DeltaTiles,
		EdgeNorth:  chunk.EdgeNorth,
		EdgeSouth:  chunk.EdgeSouth,
		EdgeWest:   chunk.EdgeWest,
		EdgeEast:   chunk.EdgeEast,
	}, true, nil
}

func (p *chunkPersistence) save(chunk protocol.ChunkSnapshot) error {
	path := p.pathFor(chunk.Coord)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	persisted := persistedChunk{
		Coord:      chunk.Coord,
		Biome:      chunk.Biome,
		Generated:  chunk.Generated,
		Dirty:      chunk.Dirty,
		LastSaved:  time.Now().UTC().Format(time.RFC3339),
		Tiles:      persistTiles(chunk.Tiles),
		DeltaTiles: chunk.DeltaTiles,
		EdgeNorth:  chunk.EdgeNorth,
		EdgeSouth:  chunk.EdgeSouth,
		EdgeWest:   chunk.EdgeWest,
		EdgeEast:   chunk.EdgeEast,
	}
	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (p *chunkPersistence) pathFor(coord protocol.ChunkCoord) string {
	filename := fmt.Sprintf("chunk_%d_%d.json", coord.ChunkX, coord.ChunkY)
	return filepath.Join(p.root, coord.MapID, filename)
}

type loadedChunk struct {
	snapshot protocol.ChunkSnapshot
}

type biomeCandidate struct {
	name   string
	weight float64
}

type worldChunkManager struct {
	mu          sync.Mutex
	generator   chunkGenerator
	persistence *chunkPersistence
	loaded      map[protocol.ChunkCoord]*loadedChunk
	playerView  map[string]map[protocol.ChunkCoord]struct{}
	seed        int64
	seedPtr     *int64
}

func newWorldChunkManager(dataRoot string, generator chunkGenerator, seedPtr *int64) *worldChunkManager {
	return &worldChunkManager{
		generator:   generator,
		persistence: newChunkPersistence(dataRoot),
		loaded:      make(map[protocol.ChunkCoord]*loadedChunk),
		playerView:  make(map[string]map[protocol.ChunkCoord]struct{}),
		seed:        *seedPtr,
		seedPtr:     seedPtr,
	}
}

func (m *worldChunkManager) randomizeSeed() (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var selected int64
	for attempt := 0; attempt < 32; attempt++ {
		n, err := rand.Int(rand.Reader, big.NewInt(1<<62))
		if err != nil {
			return 0, err
		}
		selected = n.Int64()
		spawnTerrain := pickBiome(0, 0, selected)
		if !isWaterTerrain(spawnTerrain) {
			break
		}
	}
	m.seed = selected
	if m.seedPtr != nil {
		*m.seedPtr = m.seed
	}
	m.loaded = make(map[protocol.ChunkCoord]*loadedChunk)
	m.playerView = make(map[string]map[protocol.ChunkCoord]struct{})
	if err := os.RemoveAll(m.persistence.root); err != nil {
		return 0, err
	}
	return m.seed, nil
}

func (m *worldChunkManager) currentSeed() int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.seed
}

func (m *worldChunkManager) loadWindow(playerID, currentMapID string, position protocol.Position) (protocol.ChunkWindowResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	mapID, localX, localY, transitioned := resolveMapForPosition(currentMapID, position)
	centerChunkX, centerChunkY := worldToChunk(localX, localY)
	window := make(map[protocol.ChunkCoord]struct{}, chunkLoadSpan*chunkLoadSpan)
	chunks := make([]protocol.ChunkSnapshot, 0, chunkLoadSpan*chunkLoadSpan)

	for dy := -chunkRadius; dy <= chunkRadius; dy++ {
		for dx := -chunkRadius; dx <= chunkRadius; dx++ {
			coord := protocol.ChunkCoord{
				MapID:  mapID,
				ChunkX: centerChunkX + dx,
				ChunkY: centerChunkY + dy,
			}
			window[coord] = struct{}{}

			chunk, err := m.ensureChunkLoaded(coord)
			if err != nil {
				return protocol.ChunkWindowResponse{}, err
			}
			chunks = append(chunks, chunk.snapshot)
		}
	}

	prev := m.playerView[playerID]
	unloaded := make([]protocol.ChunkCoord, 0)
	for coord := range prev {
		if _, keep := window[coord]; keep {
			continue
		}
		unloaded = append(unloaded, coord)
		if err := m.unloadChunk(coord); err != nil {
			return protocol.ChunkWindowResponse{}, err
		}
	}

	m.playerView[playerID] = window
	resp := protocol.ChunkWindowResponse{
		MapID:          mapID,
		CenterChunkX:   centerChunkX,
		CenterChunkY:   centerChunkY,
		LoadRadius:     chunkRadius,
		ChunkTileSize:  chunkTileSize,
		MapChunkSpan:   mapChunkSpan,
		Chunks:         chunks,
		UnloadedChunks: unloaded,
	}
	if transitioned {
		resp.TransitionMapID = mapID
	}

	return resp, nil
}

func (m *worldChunkManager) ensureChunkLoaded(coord protocol.ChunkCoord) (*loadedChunk, error) {
	if chunk, ok := m.loaded[coord]; ok {
		return chunk, nil
	}

	snapshot, found, err := m.persistence.load(coord)
	if err != nil {
		return nil, err
	}
	if !found {
		snapshot, err = m.generator.Generate(coord.MapID, coord.ChunkX, coord.ChunkY)
		if err != nil {
			return nil, err
		}
	} else {
		baseSnapshot, err := m.generator.Generate(coord.MapID, coord.ChunkX, coord.ChunkY)
		if err != nil {
			return nil, err
		}
		snapshot.Tiles = applyChunkDelta(baseSnapshot.Tiles, snapshot.DeltaTiles)
	}

	chunk := &loadedChunk{snapshot: snapshot}
	m.loaded[coord] = chunk
	return chunk, nil
}

func (m *worldChunkManager) unloadChunk(coord protocol.ChunkCoord) error {
	chunk, ok := m.loaded[coord]
	if !ok {
		return nil
	}

	chunk.snapshot.Dirty = true
	if err := m.persistence.save(chunk.snapshot); err != nil {
		return err
	}

	delete(m.loaded, coord)
	return nil
}

// setTileDecoration 修改一格装饰层并立即持久化（地形层字段保持不变）。
// tileX/tileY 为地图本地瓦片坐标（floor 后的整数）。返回更新后的瓦片。
func (m *worldChunkManager) setTileDecoration(mapID string, tileX, tileY int, decoration string) (protocol.ChunkTile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	chunkX := floorDivInt(tileX, chunkTileSize)
	chunkY := floorDivInt(tileY, chunkTileSize)
	coord := protocol.ChunkCoord{MapID: mapID, ChunkX: chunkX, ChunkY: chunkY}

	chunk, err := m.ensureChunkLoaded(coord)
	if err != nil {
		return protocol.ChunkTile{}, err
	}

	localX := tileX - chunkX*chunkTileSize
	localY := tileY - chunkY*chunkTileSize
	index := localY*chunkTileSize + localX
	if index < 0 || index >= len(chunk.snapshot.Tiles) {
		return protocol.ChunkTile{}, fmt.Errorf("tile out of range: %d,%d", tileX, tileY)
	}

	tile := chunk.snapshot.Tiles[index]
	if tile.X != localX || tile.Y != localY {
		// 瓦片数组应为行优先布局；不符则回退线性查找。
		found := false
		for i, candidate := range chunk.snapshot.Tiles {
			if candidate.X == localX && candidate.Y == localY {
				index, tile, found = i, candidate, true
				break
			}
		}
		if !found {
			return protocol.ChunkTile{}, fmt.Errorf("tile not found: %d,%d", tileX, tileY)
		}
	}

	tile.Decoration = decoration
	chunk.snapshot.Tiles[index] = tile
	chunk.snapshot.Dirty = true

	// DeltaTiles 记录整格快照：同格重复修改只保留最新一条。
	replaced := false
	for i, delta := range chunk.snapshot.DeltaTiles {
		if delta.X == tile.X && delta.Y == tile.Y {
			chunk.snapshot.DeltaTiles[i] = tile
			replaced = true
			break
		}
	}
	if !replaced {
		chunk.snapshot.DeltaTiles = append(chunk.snapshot.DeltaTiles, tile)
	}

	// 立即持久化，防止进程崩溃丢失玩家建筑。
	if err := m.persistence.save(chunk.snapshot); err != nil {
		return protocol.ChunkTile{}, err
	}
	return tile, nil
}

// tileAt 只读获取一格瓦片（地图本地瓦片坐标）。
func (m *worldChunkManager) tileAt(mapID string, tileX, tileY int) (protocol.ChunkTile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	chunkX := floorDivInt(tileX, chunkTileSize)
	chunkY := floorDivInt(tileY, chunkTileSize)
	coord := protocol.ChunkCoord{MapID: mapID, ChunkX: chunkX, ChunkY: chunkY}

	chunk, err := m.ensureChunkLoaded(coord)
	if err != nil {
		return protocol.ChunkTile{}, err
	}

	localX := tileX - chunkX*chunkTileSize
	localY := tileY - chunkY*chunkTileSize
	index := localY*chunkTileSize + localX
	if index >= 0 && index < len(chunk.snapshot.Tiles) {
		tile := chunk.snapshot.Tiles[index]
		if tile.X == localX && tile.Y == localY {
			return tile, nil
		}
	}
	for _, tile := range chunk.snapshot.Tiles {
		if tile.X == localX && tile.Y == localY {
			return tile, nil
		}
	}
	return protocol.ChunkTile{}, fmt.Errorf("tile not found: %d,%d", tileX, tileY)
}

func pickBiome(x, y float64, seed int64) string {
	seedShiftA := float64(seed%104729) - 52364.0
	seedShiftB := float64(seed%130363) - 65181.0

	elevation := clampFloat(layeredNoise((x+seedShiftA)*0.00135-91.0, (y-seedShiftB)*0.00135+73.0, 1.0, 0.58, 6)+layeredNoise((x-seedShiftB)*0.0045+13.0, (y+seedShiftA)*0.0045-29.0, 0.18, 0.5, 3), -1.0, 1.0)
	temperature := clampFloat(layeredNoise((x-seedShiftA)*0.00115, (y+seedShiftB)*0.00115, 1.0, 0.56, 5)+layeredNoise((x+seedShiftB)*0.0048+41.0, (y-seedShiftA)*0.0048-17.0, 0.24, 0.52, 3), -1.0, 1.0)
	moisture := clampFloat(layeredNoise((x+seedShiftA)*0.00145, (y-seedShiftB)*0.00145, 1.0, 0.56, 5)+layeredNoise((x-seedShiftB)*0.0055, (y+seedShiftA)*0.0055, 0.28, 0.52, 3), -1.0, 1.0)
	roughness := clampFloat(layeredNoise((x-seedShiftA)*0.0038+173.0, (y+seedShiftB)*0.0038-83.0, 1.0, 0.55, 4), -1.0, 1.0)

	if elevation < -0.12 {
		depth := clampFloat((-elevation-0.12)*2.0, 0.0, 1.0)
		switch temperatureBand(temperature) {
		case "frigid":
			return chooseWeightedBiome([]biomeCandidate{{name: "frozen_ice_ocean", weight: 4}, {name: "cold_deep_ocean", weight: 7 + depth*3}}, x, y, seed, 11)
		case "cold":
			return chooseWeightedBiome([]biomeCandidate{{name: "cold_deep_ocean", weight: 7 + depth*3}, {name: "temperate_near_sea", weight: 8}}, x, y, seed, 12)
		case "tropical":
			return chooseWeightedBiome([]biomeCandidate{{name: "tropical_coral_sea", weight: 6}, {name: "tropical_deep_ocean", weight: 9 + depth*3}}, x, y, seed, 13)
		default:
			return chooseWeightedBiome([]biomeCandidate{{name: "temperate_near_sea", weight: 8}, {name: "temperate_open_ocean", weight: 12 + depth*3}}, x, y, seed, 14)
		}
	}

	highland := elevation > 0.34 || (elevation > 0.2 && roughness > 0.42)
	moistBand := moistureBand(moisture)

	switch temperatureBand(temperature) {
	case "frigid":
		if highland {
			return chooseWeightedBiome([]biomeCandidate{{name: "snow_plateau", weight: 3}, {name: "glacier_mountain", weight: 2}}, x, y, seed, 21)
		}
		switch moistBand {
		case "arid":
			return "polar_tundra"
		case "humid":
			return chooseWeightedBiome([]biomeCandidate{{name: "frozen_swamp", weight: 3}, {name: "snow_conifer_forest", weight: 6}}, x, y, seed, 22)
		default:
			return chooseWeightedBiome([]biomeCandidate{{name: "polar_tundra", weight: 5}, {name: "snow_conifer_forest", weight: 6}}, x, y, seed, 23)
		}
	case "cold":
		if highland {
			if moistBand == "humid" {
				return "conifer_hills"
			}
			return "alpine_meadow"
		}
		if moistBand == "humid" {
			return "boreal_forest"
		}
		return "cold_grassland"
	case "tropical":
		switch moistBand {
		case "arid":
			return chooseWeightedBiome([]biomeCandidate{{name: "desert", weight: 7}, {name: "gobi", weight: 4}}, x, y, seed, 31)
		case "humid":
			return "tropical_rainforest"
		default:
			return "tropical_savanna"
		}
	default:
		if highland {
			switch moistBand {
			case "arid":
				return "rocky_mountain"
			case "humid":
				return chooseWeightedBiome([]biomeCandidate{{name: "broadleaf_hills", weight: 6}, {name: "cloud_forest", weight: 2}}, x, y, seed, 41)
			default:
				return "mountain_meadow"
			}
		}
		switch moistBand {
		case "humid":
			return chooseWeightedBiome([]biomeCandidate{{name: "deciduous_forest", weight: 7}, {name: "temperate_wetland", weight: 4}}, x, y, seed, 42)
		default:
			return "temperate_plains"
		}
	}
}

func decorateTerrain(terrain string, globalX, globalY int) (string, string) {
	riverLine := math.Abs(layeredNoise(float64(globalX)*0.00022-150.0, float64(globalY)*0.00022+70.0, 1.0, 0.5, 4))

	if isWaterTerrain(terrain) {
		return "", ""
	}

	if riverLine < 0.018 && terrain != "glacier_mountain" && terrain != "rocky_mountain" {
		return "river", ""
	}
	return "", ""
}

func isWaterTerrain(terrain string) bool {
	switch terrain {
	case "frozen_ice_ocean", "cold_deep_ocean", "temperate_near_sea", "temperate_open_ocean", "tropical_coral_sea", "tropical_deep_ocean", "ocean", "tropical_ocean", "ice_ocean", "lake", "river":
		return true
	default:
		return false
	}
}

func applyChunkDelta(baseTiles, deltaTiles []protocol.ChunkTile) []protocol.ChunkTile {
	if len(deltaTiles) == 0 {
		return baseTiles
	}

	merged := make([]protocol.ChunkTile, len(baseTiles))
	copy(merged, baseTiles)
	indexByCoord := make(map[string]int, len(merged))
	for i, tile := range merged {
		indexByCoord[fmt.Sprintf("%d:%d", tile.X, tile.Y)] = i
	}

	for _, delta := range deltaTiles {
		key := fmt.Sprintf("%d:%d", delta.X, delta.Y)
		if index, ok := indexByCoord[key]; ok {
			merged[index] = delta
		} else {
			merged = append(merged, delta)
		}
	}

	return merged
}

func restorePersistedTiles(stored []persistedChunkTile) []protocol.ChunkTile {
	if len(stored) == 0 {
		return nil
	}

	tiles := make([]protocol.ChunkTile, 0, len(stored))
	for _, tile := range stored {
		terrain := tile.Terrain
		if terrain == "" {
			terrain = legacyTypeToTerrain(tile.Type)
		}
		tiles = append(tiles, protocol.ChunkTile{
			X:          tile.X,
			Y:          tile.Y,
			Terrain:    terrain,
			Block:      tile.Block,
			Feature:    tile.Feature,
			Decoration: tile.Decoration,
			LevelHint:  tile.LevelHint,
		})
	}
	return tiles
}

func persistTiles(tiles []protocol.ChunkTile) []persistedChunkTile {
	if len(tiles) == 0 {
		return nil
	}

	stored := make([]persistedChunkTile, 0, len(tiles))
	for _, tile := range tiles {
		stored = append(stored, persistedChunkTile{
			X:          tile.X,
			Y:          tile.Y,
			Terrain:    tile.Terrain,
			Block:      tile.Block,
			Feature:    tile.Feature,
			Decoration: tile.Decoration,
			LevelHint:  tile.LevelHint,
		})
	}
	return stored
}

func legacyTypeToTerrain(tileType string) string {
	switch tileType {
	case "forest", "tree":
		return "broadleaf_forest"
	case "lake", "water":
		return "lake"
	case "sand":
		return "desert"
	case "rock":
		return "mountain"
	case "path":
		return "plain"
	case "meadow":
		return "plain"
	case "grassland":
		return "grassland"
	case "":
		return ""
	default:
		return tileType
	}
}

func parseMapOffset(mapID string) (int, int) {
	var mapX int
	var mapY int
	if _, err := fmt.Sscanf(mapID, "map_%d_%d", &mapX, &mapY); err != nil {
		return 0, 0
	}
	return mapX, mapY
}

func layeredNoise(x, y, amplitude, persistence float64, octaves int) float64 {
	total := 0.0
	normalization := 0.0

	for i := 0; i < octaves; i++ {
		total += amplitude * valueNoise(x, y)
		normalization += amplitude
		x *= 2.03
		y *= 2.11
		amplitude *= persistence
	}

	return total / normalization
}

func valueNoise(x, y float64) float64 {
	x0 := math.Floor(x)
	y0 := math.Floor(y)
	tx := x - x0
	ty := y - y0

	v00 := pseudoRandom(int64(x0), int64(y0))
	v10 := pseudoRandom(int64(x0)+1, int64(y0))
	v01 := pseudoRandom(int64(x0), int64(y0)+1)
	v11 := pseudoRandom(int64(x0)+1, int64(y0)+1)

	sx := smoothstep(tx)
	sy := smoothstep(ty)

	ix0 := lerp(v00, v10, sx)
	ix1 := lerp(v01, v11, sx)
	return lerp(ix0, ix1, sy)
}

func pseudoRandom(x, y int64) float64 {
	n := x*374761393 + y*668265263
	n = (n ^ (n >> 13)) * 1274126177
	normalized := float64((n^(n>>16))&0x7fffffff) / 2147483647.0
	return normalized*2.0 - 1.0
}

func smoothstep(t float64) float64 {
	return t * t * (3.0 - 2.0*t)
}

func lerp(a, b, t float64) float64 {
	return a + (b-a)*t
}

func chooseWeightedBiome(candidates []biomeCandidate, x, y float64, seed int64, salt int64) string {
	if len(candidates) == 0 {
		return "temperate_plains"
	}

	total := 0.0
	for _, candidate := range candidates {
		total += maxFloat(candidate.weight, 0.0)
	}
	if total <= 0 {
		return candidates[0].name
	}

	noise := valueNoise((x+float64(seed%104729)+float64(salt)*113.0)*0.0032, (y-float64(seed%130363)-float64(salt)*67.0)*0.0032)
	pick := (noise + 1.0) * 0.5 * total
	accumulated := 0.0
	for _, candidate := range candidates {
		accumulated += maxFloat(candidate.weight, 0.0)
		if pick <= accumulated {
			return candidate.name
		}
	}
	return candidates[len(candidates)-1].name
}

func temperatureBand(temperature float64) string {
	switch {
	case temperature < -0.55:
		return "frigid"
	case temperature < -0.18:
		return "cold"
	case temperature > 0.48:
		return "tropical"
	default:
		return "temperate"
	}
}

func moistureBand(moisture float64) string {
	switch {
	case moisture < -0.28:
		return "arid"
	case moisture > 0.28:
		return "humid"
	default:
		return "semi_humid"
	}
}

func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func worldToChunk(x, y float64) (int, int) {
	return int(math.Floor(x / chunkTileSize)), int(math.Floor(y / chunkTileSize))
}

func resolveMapForPosition(currentMapID string, position protocol.Position) (string, float64, float64, bool) {
	mapWorldSize := float64(mapChunkSpan * chunkTileSize)
	halfWorldSize := mapWorldSize * 0.5

	mapOffsetX := 0
	mapOffsetY := 0
	if position.X >= halfWorldSize || position.X < -halfWorldSize {
		mapOffsetX = int(math.Floor((position.X + halfWorldSize) / mapWorldSize))
	}
	if position.Y >= halfWorldSize || position.Y < -halfWorldSize {
		mapOffsetY = int(math.Floor((position.Y + halfWorldSize) / mapWorldSize))
	}

	targetMapID := currentMapID
	if currentMapID == "" {
		targetMapID = "map_0_0"
	}

	if mapOffsetX != 0 || mapOffsetY != 0 {
		targetMapID = fmt.Sprintf("map_%d_%d", mapOffsetX, mapOffsetY)
	}

	localX := normalizeLocalCoord(position.X, halfWorldSize, mapWorldSize)
	localY := normalizeLocalCoord(position.Y, halfWorldSize, mapWorldSize)
	return targetMapID, localX, localY, targetMapID != currentMapID
}

func normalizeLocalCoord(value, halfWorldSize, mapWorldSize float64) float64 {
	if value >= -halfWorldSize && value < halfWorldSize {
		return value
	}

	result := math.Mod(value+halfWorldSize, mapWorldSize)
	if result < 0 {
		result += mapWorldSize
	}
	return result - halfWorldSize
}
