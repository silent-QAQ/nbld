using UnityEngine;

namespace NBLD.World
{
    public class SimpleWorldVisuals : MonoBehaviour
    {
        [SerializeField] private Vector2 worldSize = new Vector2(24f, 24f);
        [SerializeField] private Color backgroundColor = new Color(0.08f, 0.11f, 0.14f, 1f);
        [SerializeField] private Color groundColor = new Color(0.18f, 0.24f, 0.18f, 1f);
        [SerializeField] private Color gridColor = new Color(0.28f, 0.35f, 0.28f, 0.75f);
        [SerializeField] private int sortingOrder = -10;

        public void Build()
        {
            BuildBackground();
            BuildGround();
            BuildGrid();
        }

        private void BuildBackground()
        {
            var background = EnsureChild("Background");
            background.localPosition = new Vector3(0f, 0f, 8f);
            var renderer = EnsureSpriteRenderer(background.gameObject, backgroundColor, sortingOrder - 1);
            renderer.sprite = CreateQuadSprite(8, 8);
            background.localScale = new Vector3(worldSize.x * 3f, worldSize.y * 3f, 1f);
        }

        private void BuildGround()
        {
            var ground = EnsureChild("Ground");
            ground.localPosition = Vector3.zero;
            var renderer = EnsureSpriteRenderer(ground.gameObject, groundColor, sortingOrder);
            renderer.sprite = CreateQuadSprite(16, 16);
            ground.localScale = new Vector3(worldSize.x, worldSize.y, 1f);
        }

        private void BuildGrid()
        {
            var gridRoot = EnsureChild("Grid");
            ClearChildren(gridRoot);

            var halfWidth = worldSize.x * 0.5f;
            var halfHeight = worldSize.y * 0.5f;

            for (int x = Mathf.CeilToInt(-halfWidth); x <= Mathf.FloorToInt(halfWidth); x++)
            {
                CreateLine(gridRoot, $"GridV_{x}", new Vector3(x, 0f, 0f), new Vector3(0.04f, worldSize.y, 1f));
            }

            for (int y = Mathf.CeilToInt(-halfHeight); y <= Mathf.FloorToInt(halfHeight); y++)
            {
                CreateLine(gridRoot, $"GridH_{y}", new Vector3(0f, y, 0f), new Vector3(worldSize.x, 0.04f, 1f));
            }
        }

        private void CreateLine(Transform parent, string objectName, Vector3 localPosition, Vector3 localScale)
        {
            var line = new GameObject(objectName).transform;
            line.SetParent(parent, false);
            line.localPosition = localPosition;
            line.localScale = localScale;

            var renderer = EnsureSpriteRenderer(line.gameObject, gridColor, sortingOrder + 1);
            renderer.sprite = CreateQuadSprite(4, 4);
        }

        private Transform EnsureChild(string objectName)
        {
            var child = transform.Find(objectName);
            if (child != null)
            {
                return child;
            }

            var created = new GameObject(objectName).transform;
            created.SetParent(transform, false);
            return created;
        }

        private SpriteRenderer EnsureSpriteRenderer(GameObject go, Color color, int order)
        {
            var renderer = go.GetComponent<SpriteRenderer>();
            if (renderer == null)
            {
                renderer = go.AddComponent<SpriteRenderer>();
            }

            renderer.color = color;
            renderer.sortingOrder = order;
            return renderer;
        }

        private void ClearChildren(Transform parent)
        {
            for (var i = parent.childCount - 1; i >= 0; i--)
            {
                var child = parent.GetChild(i);
#if UNITY_EDITOR
                if (!Application.isPlaying)
                {
                    Object.DestroyImmediate(child.gameObject);
                    continue;
                }
#endif
                Object.Destroy(child.gameObject);
            }
        }

        private Sprite CreateQuadSprite(int width, int height)
        {
            var texture = new Texture2D(width, height);
            var pixels = new Color[width * height];
            for (var i = 0; i < pixels.Length; i++)
            {
                pixels[i] = Color.white;
            }

            texture.SetPixels(pixels);
            texture.Apply();
            return Sprite.Create(texture, new Rect(0, 0, width, height), new Vector2(0.5f, 0.5f), 1f);
        }
    }
}
