using System;
using UnityEngine;

namespace NBLD.World
{
    public class DebugCommandConsole : MonoBehaviour
    {
        [SerializeField] private WorldBootstrap bootstrap;
        [SerializeField] private KeyCode toggleKey = KeyCode.BackQuote;
        [SerializeField] private Vector2 margin = new Vector2(16f, 148f);
        [SerializeField] private Vector2 size = new Vector2(520f, 36f);

        private string _input = "";
        private bool _open;
        private string _result = "";
        private GUIStyle _textFieldStyle;
        private GUIStyle _labelStyle;
        private const string InputControlName = "DebugCommandInput";
        private bool _focusInputNextFrame;

        private void Update()
        {
            if (Input.GetKeyDown(toggleKey))
            {
                _open = !_open;
                if (_open)
                {
                    _focusInputNextFrame = true;
                }
                return;
            }

            if (_open && Input.GetKeyDown(KeyCode.Escape))
            {
                CloseConsole();
                return;
            }

            if (!_open)
            {
                return;
            }

            if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter))
            {
                SubmitInput();
            }
        }

        private void OnGUI()
        {
            if (!_open || bootstrap == null)
            {
                return;
            }

            EnsureStyles();

            GUI.SetNextControlName(InputControlName);
            _input = GUI.TextField(new Rect(margin.x, margin.y, size.x, size.y), _input, _textFieldStyle);
            if (_focusInputNextFrame)
            {
                GUI.FocusControl(InputControlName);
                _focusInputNextFrame = false;
            }

            if (Event.current.type == EventType.KeyDown &&
                (Event.current.keyCode == KeyCode.Return || Event.current.keyCode == KeyCode.KeypadEnter ||
                 Event.current.character == '\n' || Event.current.character == '\r'))
            {
                SubmitInput();
                Event.current.Use();
            }

            if (GUI.Button(new Rect(margin.x + size.x + 8f, margin.y, 84f, size.y), "Execute"))
            {
                SubmitInput();
            }

            if (GUI.Button(new Rect(margin.x + size.x + 100f, margin.y, 84f, size.y), "Close"))
            {
                CloseConsole();
            }

            GUI.Label(
                new Rect(margin.x, margin.y + size.y + 6f, 900f, 28f),
                $"Toggle: `{toggleKey}`  Close: Esc / Close button  {_result}",
                _labelStyle
            );
        }

        private void ExecuteCommand(string commandLine)
        {
            if (string.IsNullOrWhiteSpace(commandLine))
            {
                return;
            }

            var parts = commandLine.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            var command = parts[0].ToLowerInvariant();

            switch (command)
            {
                case "/tp":
                    if (parts.Length < 3 || !float.TryParse(parts[1], out var x) || !float.TryParse(parts[2], out var y))
                    {
                        _result = "Usage: /tp <x> <y>";
                        return;
                    }
                    bootstrap.TeleportTo(new Vector3(x, y, 0f));
                    _result = $"Teleported to ({x:F1}, {y:F1})";
                    break;
                case "/chunklight":
                    var enabled = bootstrap.ToggleChunkHighlight();
                    _result = $"Chunk highlight: {(enabled ? "on" : "off")}";
                    break;
                case "/seedrand":
                    bootstrap.RandomizeWorldSeedAsync().ContinueWith(task =>
                    {
                        _result = task.IsCompletedSuccessfully
                            ? $"Random seed: {task.Result}"
                            : $"Seed randomize failed: {task.Exception?.GetBaseException().Message}";
                    });
                    _result = "Randomizing seed...";
                    break;
                default:
                    _result = $"Unknown command: {command}";
                    break;
            }
        }

        private void EnsureStyles()
        {
            if (_textFieldStyle == null)
            {
                _textFieldStyle = new GUIStyle(GUI.skin.textField)
                {
                    fontSize = 18,
                };
            }

            if (_labelStyle == null)
            {
                _labelStyle = new GUIStyle(GUI.skin.label)
                {
                    fontSize = 16,
                    normal = { textColor = Color.white },
                };
            }
        }

        private void SubmitInput()
        {
            ExecuteCommand(_input);
            _input = "";
            _focusInputNextFrame = true;
        }

        private void CloseConsole()
        {
            _open = false;
            _focusInputNextFrame = false;
            GUI.FocusControl(string.Empty);
        }
    }
}
