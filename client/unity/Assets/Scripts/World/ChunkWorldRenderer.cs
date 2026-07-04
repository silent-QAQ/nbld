using System.Collections.Generic;
using NBLD.Protocol;
using UnityEngine;

namespace NBLD.World
{
    public class ChunkWorldRenderer : MonoBehaviour
    {
        [SerializeField] private int tileSize = 1;
        [SerializeField] private int renderRadiusChunks = 1;

        private readonly Dictionary<string, ChunkRenderRoot> _renderedChunks = new Dictionary<string, ChunkRenderRoot>();
        private Sprite _tileSprite;
        private bool _chunkHighlightEnabled;

        public float CellWorldSize => tileSize;
        public int RenderRadiusChunks => Mathf.Max(0, renderRadiusChunks);

        public void ApplyWindow(ChunkWindowResponse window)
        {
            if (window == null || window.chunks == null)
            {
                return;
            }

            EnsureSprite();

            if (window.unloadedChunks != null)
            {
                foreach (var unloaded in window.unloadedChunks)
                {
                    RemoveChunk(unloaded);
                }
            }

            foreach (var chunk in window.chunks)
            {
                RenderChunk(chunk, window.chunkTileSize);
            }
        }

        public void UpdateVisibleWindow(Vector3 playerPosition, string mapId, int chunkTileSizeValue)
        {
            var playerChunkX = Mathf.FloorToInt(playerPosition.x / (chunkTileSizeValue * tileSize));
            var playerChunkY = Mathf.FloorToInt(playerPosition.y / (chunkTileSizeValue * tileSize));
            var radius = RenderRadiusChunks;

            foreach (var pair in _renderedChunks)
            {
                var root = pair.Value;
                if (root.Snapshot == null || root.Snapshot.coord == null)
                {
                    continue;
                }

                var sameMap = string.IsNullOrWhiteSpace(mapId) || root.Snapshot.coord.mapId == mapId;
                var visible = sameMap
                    && Mathf.Abs(root.Snapshot.coord.chunkX - playerChunkX) <= radius
                    && Mathf.Abs(root.Snapshot.coord.chunkY - playerChunkY) <= radius;
                root.Root.SetActive(visible);
                if (root.Border != null)
                {
                    root.Border.gameObject.SetActive(visible && _chunkHighlightEnabled);
                }
            }
        }

        private void RenderChunk(ChunkSnapshot chunk, int chunkTileSizeValue)
        {
            if (chunk == null || chunk.coord == null)
            {
                return;
            }

            var key = ChunkKey(chunk.coord);
            if (!_renderedChunks.TryGetValue(key, out var renderRoot))
            {
                renderRoot = CreateChunkRenderRoot(key);
                _renderedChunks[key] = renderRoot;
            }

            renderRoot.Snapshot = chunk;
            renderRoot.Root.SetActive(true);
            var mapOffset = ParseMapOffset(chunk.coord.mapId, chunkTileSizeValue);
            renderRoot.Root.transform.position = new Vector3(
                mapOffset.x + chunk.coord.chunkX * chunkTileSizeValue * tileSize,
                mapOffset.y + chunk.coord.chunkY * chunkTileSizeValue * tileSize,
                0f
            );

            RenderChunkTexture(renderRoot, chunk, chunkTileSizeValue);
            UpdateChunkBorder(renderRoot, chunkTileSizeValue);
        }

        private void RenderChunkTexture(ChunkRenderRoot renderRoot, ChunkSnapshot chunk, int chunkTileSizeValue)
        {
            EnsureChunkSprite(renderRoot, chunkTileSizeValue);
            var pixels = renderRoot.TexturePixels;
            var fallback = ColorForTerrain(chunk.biome);

            for (var i = 0; i < pixels.Length; i++)
            {
                pixels[i] = fallback;
            }

            if (chunk.tiles != null)
            {
                for (var i = 0; i < chunk.tiles.Length; i++)
                {
                    var tile = chunk.tiles[i];
                    if (tile.x < 0 || tile.y < 0 || tile.x >= chunkTileSizeValue || tile.y >= chunkTileSizeValue)
                    {
                        continue;
                    }

                    pixels[tile.y * chunkTileSizeValue + tile.x] = ColorForTile(tile);
                }
            }

            renderRoot.Texture.SetPixels(pixels);
            renderRoot.Texture.Apply(false);
            renderRoot.TileRenderer.enabled = true;
        }

        private Color ColorForTile(ChunkTile tile)
        {
            if (tile == null)
            {
                return ColorForTerrain(null);
            }

            if (!string.IsNullOrWhiteSpace(tile.feature))
            {
                return ColorForFeature(tile.feature);
            }

            if (!string.IsNullOrWhiteSpace(tile.block))
            {
                return ColorForBlock(tile.block);
            }

            return ColorForTerrain(tile.terrain);
        }

        private void EnsureChunkSprite(ChunkRenderRoot renderRoot, int chunkTileSizeValue)
        {
            if (renderRoot.Texture != null && renderRoot.Texture.width == chunkTileSizeValue && renderRoot.Texture.height == chunkTileSizeValue)
            {
                return;
            }

            if (renderRoot.Texture != null)
            {
                SafeDestroy(renderRoot.TileRenderer.sprite);
                SafeDestroy(renderRoot.Texture);
            }

            var texture = new Texture2D(chunkTileSizeValue, chunkTileSizeValue, TextureFormat.RGBA32, false)
            {
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp
            };
            var sprite = Sprite.Create(texture, new Rect(0, 0, chunkTileSizeValue, chunkTileSizeValue), Vector2.zero, 1f);
            renderRoot.Texture = texture;
            renderRoot.TexturePixels = new Color[chunkTileSizeValue * chunkTileSizeValue];
            renderRoot.TileRenderer.sprite = sprite;
            renderRoot.TileRenderer.sortingOrder = -5;
            renderRoot.TileRenderer.transform.localPosition = Vector3.zero;
            renderRoot.TileRenderer.transform.localScale = new Vector3(tileSize, tileSize, 1f);
        }

        private void RemoveChunk(ChunkCoord coord)
        {
            if (coord == null)
            {
                return;
            }

            var key = ChunkKey(coord);
            if (_renderedChunks.TryGetValue(key, out var existing))
            {
                existing.Root.SetActive(false);
            }
        }

        private void SafeDestroy(Object target)
        {
            if (target == null)
            {
                return;
            }

            if (Application.isPlaying)
            {
                Destroy(target);
                return;
            }

            DestroyImmediate(target);
        }

        private string ChunkKey(ChunkCoord coord)
        {
            return $"{coord.mapId}_{coord.chunkX}_{coord.chunkY}";
        }

        private Vector2 ParseMapOffset(string mapId, int chunkTileSizeValue)
        {
            if (string.IsNullOrWhiteSpace(mapId))
            {
                return Vector2.zero;
            }

            var parts = mapId.Split('_');
            if (parts.Length != 3)
            {
                return Vector2.zero;
            }

            if (!int.TryParse(parts[1], out var mapX) || !int.TryParse(parts[2], out var mapY))
            {
                return Vector2.zero;
            }

            var mapWorldSize = 6400 * chunkTileSizeValue * tileSize;
            return new Vector2(mapX * mapWorldSize, mapY * mapWorldSize);
        }

        private ChunkRenderRoot CreateChunkRenderRoot(string key)
        {
            var root = new GameObject(key);
            root.transform.SetParent(transform, false);

            var tileLayer = new GameObject("TileLayer");
            tileLayer.transform.SetParent(root.transform, false);

            return new ChunkRenderRoot
            {
                Root = root,
                TileRenderer = tileLayer.AddComponent<SpriteRenderer>(),
                Border = CreateBorderRoot(root.transform),
            };
        }

        public string GetTerrainAtWorldPosition(Vector3 worldPosition)
        {
            foreach (var pair in _renderedChunks)
            {
                var renderRoot = pair.Value;
                if (renderRoot.Snapshot == null || !renderRoot.Root.activeSelf)
                {
                    continue;
                }

                var local = worldPosition - renderRoot.Root.transform.position;
                const int chunkTileSizeValue = 80;
                var chunkWorldSize = chunkTileSizeValue * tileSize;
                if (local.x < 0f || local.y < 0f || local.x >= chunkWorldSize || local.y >= chunkWorldSize)
                {
                    continue;
                }

                if (renderRoot.Snapshot.tiles == null)
                {
                    return renderRoot.Snapshot.biome;
                }

                var tileX = Mathf.FloorToInt(local.x / tileSize);
                var tileY = Mathf.FloorToInt(local.y / tileSize);
                for (var i = 0; i < renderRoot.Snapshot.tiles.Length; i++)
                {
                    var tile = renderRoot.Snapshot.tiles[i];
                    if (tile.x == tileX && tile.y == tileY)
                    {
                        return string.IsNullOrWhiteSpace(tile.terrain) ? renderRoot.Snapshot.biome : tile.terrain;
                    }
                }

                return renderRoot.Snapshot.biome;
            }

            return "-";
        }

        public bool ToggleChunkHighlight()
        {
            _chunkHighlightEnabled = !_chunkHighlightEnabled;
            foreach (var pair in _renderedChunks)
            {
                if (pair.Value.Border != null)
                {
                    pair.Value.Border.gameObject.SetActive(_chunkHighlightEnabled && pair.Value.Root.activeSelf);
                }
            }

            return _chunkHighlightEnabled;
        }

        private Transform CreateBorderRoot(Transform parent)
        {
            var root = new GameObject("Border").transform;
            root.SetParent(parent, false);
            root.gameObject.SetActive(false);

            CreateBorderLine(root, "Top");
            CreateBorderLine(root, "Bottom");
            CreateBorderLine(root, "Left");
            CreateBorderLine(root, "Right");
            return root;
        }

        private void CreateBorderLine(Transform parent, string lineName)
        {
            var line = new GameObject(lineName);
            line.transform.SetParent(parent, false);
            var renderer = line.AddComponent<SpriteRenderer>();
            renderer.sprite = _tileSprite;
            renderer.color = new Color(1f, 0.92f, 0.2f, 0.95f);
            renderer.sortingOrder = 20;
        }

        private void UpdateChunkBorder(ChunkRenderRoot renderRoot, int chunkTileSizeValue)
        {
            if (renderRoot.Border == null)
            {
                return;
            }

            var worldSize = chunkTileSizeValue * tileSize;
            var thickness = Mathf.Max(0.2f, tileSize * 0.4f);

            var top = renderRoot.Border.Find("Top");
            var bottom = renderRoot.Border.Find("Bottom");
            var left = renderRoot.Border.Find("Left");
            var right = renderRoot.Border.Find("Right");

            ConfigureBorderLine(top, new Vector3(worldSize * 0.5f, worldSize, 0f), new Vector3(worldSize, thickness, 1f));
            ConfigureBorderLine(bottom, new Vector3(worldSize * 0.5f, 0f, 0f), new Vector3(worldSize, thickness, 1f));
            ConfigureBorderLine(left, new Vector3(0f, worldSize * 0.5f, 0f), new Vector3(thickness, worldSize, 1f));
            ConfigureBorderLine(right, new Vector3(worldSize, worldSize * 0.5f, 0f), new Vector3(thickness, worldSize, 1f));

            renderRoot.Border.gameObject.SetActive(_chunkHighlightEnabled && renderRoot.Root.activeSelf);
        }

        private void ConfigureBorderLine(Transform line, Vector3 localPosition, Vector3 localScale)
        {
            if (line == null)
            {
                return;
            }

            line.localPosition = localPosition;
            line.localScale = localScale;
        }

        private void EnsureSprite()
        {
            if (_tileSprite != null)
            {
                return;
            }

            var texture = new Texture2D(1, 1);
            texture.SetPixel(0, 0, Color.white);
            texture.Apply();
            _tileSprite = Sprite.Create(texture, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
        }

        private Color ColorForFeature(string feature)
        {
            switch (feature)
            {
                case "river":
                    return new Color(0.33f, 0.73f, 1f, 1f);
                default:
                    return ColorForTerrain(feature);
            }
        }

        private Color ColorForBlock(string block)
        {
            switch (block)
            {
                case "grass": return new Color(0.41f, 0.72f, 0.31f, 1f);
                case "cold_grass": return new Color(0.44f, 0.56f, 0.31f, 1f);
                case "dry_grass": return new Color(0.66f, 0.66f, 0.29f, 1f);
                case "plateau_grass": return new Color(0.54f, 0.61f, 0.35f, 1f);
                case "forest_floor": return new Color(0.18f, 0.44f, 0.21f, 1f);
                case "needle_floor": return new Color(0.14f, 0.31f, 0.2f, 1f);
                case "rainforest_floor": return new Color(0.14f, 0.33f, 0.22f, 1f);
                case "leaf_litter": return new Color(0.42f, 0.35f, 0.18f, 1f);
                case "dirt": return new Color(0.61f, 0.5f, 0.31f, 1f);
                case "dirt": return new Color(0.5f, 0.41f, 0.3f, 1f);
                case "dry_soil": return new Color(0.6f, 0.51f, 0.32f, 1f);
                case "wet_mud": return new Color(0.24f, 0.29f, 0.21f, 1f);
                case "mud": return new Color(0.3f, 0.27f, 0.2f, 1f);
                case "frozen_soil": return new Color(0.56f, 0.55f, 0.47f, 1f);
                case "rocky_soil": return new Color(0.42f, 0.4f, 0.35f, 1f);
                case "moss": return new Color(0.18f, 0.37f, 0.22f, 1f);
                case "rock": return new Color(0.47f, 0.47f, 0.45f, 1f);
                case "mountain_rock": return new Color(0.37f, 0.38f, 0.38f, 1f);
                case "cliff_rock": return new Color(0.31f, 0.32f, 0.32f, 1f);
                case "glacier_rock": return new Color(0.6f, 0.65f, 0.67f, 1f);
                case "gravel": return new Color(0.56f, 0.55f, 0.49f, 1f);
                case "sand": return new Color(0.85f, 0.77f, 0.42f, 1f);
                case "dune_sand": return new Color(0.88f, 0.79f, 0.45f, 1f);
                case "coast_sand": return new Color(0.84f, 0.78f, 0.54f, 1f);
                case "snow": return new Color(0.84f, 0.87f, 0.85f, 1f);
                case "hard_snow": return new Color(0.93f, 0.95f, 0.94f, 1f);
                case "ice": return new Color(0.73f, 0.85f, 0.93f, 1f);
                case "packed_ice": return new Color(0.56f, 0.77f, 0.87f, 1f);
                case "deep_ice_water": return new Color(0.44f, 0.69f, 0.84f, 1f);
                case "ice_water": return new Color(0.58f, 0.8f, 0.9f, 1f);
                case "cold_deep_water": return new Color(0.09f, 0.24f, 0.44f, 1f);
                case "shallow_sea_water": return new Color(0.24f, 0.57f, 0.76f, 1f);
                case "open_ocean_water": return new Color(0.08f, 0.25f, 0.57f, 1f);
                case "wave_water": return new Color(0.16f, 0.38f, 0.66f, 1f);
                case "tropical_shallow_water": return new Color(0.13f, 0.71f, 0.72f, 1f);
                case "tropical_deep_water": return new Color(0.05f, 0.4f, 0.66f, 1f);
                case "grass_tuft": return new Color(0.18f, 0.48f, 0.2f, 1f);
                case "flower": return new Color(0.9f, 0.83f, 0.42f, 1f);
                case "bush": return new Color(0.12f, 0.37f, 0.2f, 1f);
                case "dry_bush": return new Color(0.54f, 0.45f, 0.25f, 1f);
                case "reed": return new Color(0.42f, 0.56f, 0.25f, 1f);
                case "cactus": return new Color(0.2f, 0.48f, 0.25f, 1f);
                case "tree_deciduous": return new Color(0.14f, 0.37f, 0.17f, 1f);
                case "tree_conifer": return new Color(0.09f, 0.25f, 0.15f, 1f);
                case "tree_jungle": return new Color(0.05f, 0.31f, 0.14f, 1f);
                case "small_stone": return new Color(0.37f, 0.37f, 0.36f, 1f);
                default:
                    return ColorForTerrain(block);
            }
        }

        private Color ColorForTerrain(string terrain)
        {
            switch (terrain)
            {
                case "frozen_ice_ocean": return new Color(0.66f, 0.82f, 0.94f, 1f);
                case "cold_deep_ocean": return new Color(0.08f, 0.2f, 0.42f, 1f);
                case "temperate_near_sea": return new Color(0.16f, 0.48f, 0.72f, 1f);
                case "temperate_open_ocean": return new Color(0.06f, 0.24f, 0.58f, 1f);
                case "tropical_coral_sea": return new Color(0.1f, 0.68f, 0.72f, 1f);
                case "tropical_deep_ocean": return new Color(0.04f, 0.36f, 0.66f, 1f);
                case "polar_tundra": return new Color(0.68f, 0.67f, 0.55f, 1f);
                case "frozen_swamp": return new Color(0.48f, 0.62f, 0.66f, 1f);
                case "snow_conifer_forest": return new Color(0.66f, 0.78f, 0.72f, 1f);
                case "snow_plateau": return new Color(0.82f, 0.84f, 0.82f, 1f);
                case "glacier_mountain": return new Color(0.88f, 0.92f, 0.98f, 1f);
                case "cold_grassland": return new Color(0.48f, 0.58f, 0.32f, 1f);
                case "boreal_forest": return new Color(0.12f, 0.32f, 0.2f, 1f);
                case "conifer_hills": return new Color(0.16f, 0.36f, 0.22f, 1f);
                case "alpine_meadow": return new Color(0.46f, 0.64f, 0.38f, 1f);
                case "temperate_plains": return new Color(0.44f, 0.74f, 0.34f, 1f);
                case "deciduous_forest": return new Color(0.18f, 0.48f, 0.22f, 1f);
                case "temperate_wetland": return new Color(0.24f, 0.42f, 0.32f, 1f);
                case "broadleaf_hills": return new Color(0.24f, 0.5f, 0.24f, 1f);
                case "mountain_meadow": return new Color(0.46f, 0.62f, 0.36f, 1f);
                case "rocky_mountain": return new Color(0.46f, 0.46f, 0.44f, 1f);
                case "cloud_forest": return new Color(0.08f, 0.34f, 0.18f, 1f);
                case "tropical_savanna": return new Color(0.68f, 0.68f, 0.28f, 1f);
                case "desert": return new Color(0.84f, 0.74f, 0.38f, 1f);
                case "gobi": return new Color(0.69f, 0.6f, 0.42f, 1f);
                case "tropical_rainforest": return new Color(0.04f, 0.42f, 0.18f, 1f);
                case "river": return new Color(0.2f, 0.45f, 0.75f, 1f);
                default: return new Color(0.36f, 0.58f, 0.32f, 1f);
            }
        }

        private class ChunkRenderRoot
        {
            public GameObject Root;
            public SpriteRenderer TileRenderer;
            public Texture2D Texture;
            public Color[] TexturePixels;
            public Transform Border;
            public ChunkSnapshot Snapshot;
        }
    }
}
