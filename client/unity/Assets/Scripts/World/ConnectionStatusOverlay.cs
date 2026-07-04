using UnityEngine;

namespace NBLD.World
{
    public class ConnectionStatusOverlay : MonoBehaviour
    {
        [SerializeField] private WorldBootstrap bootstrap;
        [SerializeField] private Vector2 margin = new Vector2(16f, 16f);
        [SerializeField] private Vector2 size = new Vector2(420f, 114f);

        private GUIStyle _labelStyle;
        private GUIStyle _boxStyle;
        private GUIStyle _coordStyle;

        private void OnGUI()
        {
            if (bootstrap == null)
            {
                return;
            }

            EnsureStyles();

            var rect = new Rect(margin.x, margin.y, size.x, size.y);
            GUI.Box(rect, GUIContent.none, _boxStyle);

            var textRect = new Rect(rect.x + 12f, rect.y + 8f, rect.width - 24f, 48f);
            var playerPosition = bootstrap.PlayerPosition;
            GUI.Label(textRect, bootstrap.StatusSummary, _labelStyle);

            var coordRect = new Rect(rect.x + 12f, rect.y + 54f, rect.width - 24f, 30f);
            GUI.Label(
                coordRect,
                $"POS  X:{playerPosition.x:F2}  Y:{playerPosition.y:F2}  Z:{playerPosition.z:F2}",
                _coordStyle
            );

            var terrainRect = new Rect(rect.x + 12f, rect.y + 78f, rect.width - 24f, 24f);
            GUI.Label(terrainRect, $"TERRAIN  {bootstrap.CurrentTerrain}", _labelStyle);
        }

        private void EnsureStyles()
        {
            if (_labelStyle == null)
            {
                _labelStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 18,
                    normal = { textColor = Color.white },
                    wordWrap = true,
                };
            }

            if (_boxStyle == null)
            {
                _boxStyle = new GUIStyle(GUI.skin.box);
                var background = new Texture2D(1, 1);
                background.SetPixel(0, 0, new Color(0f, 0f, 0f, 0.55f));
                background.Apply();
                _boxStyle.normal.background = background;
            }

            if (_coordStyle == null)
            {
                _coordStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 20,
                    fontStyle = FontStyle.Bold,
                    normal = { textColor = new Color(0.95f, 0.95f, 0.75f, 1f) },
                };
            }
        }
    }
}
