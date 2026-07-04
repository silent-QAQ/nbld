using System;
using System.Text;
using System.Threading.Tasks;
using NBLD.Network;
using NBLD.Protocol;
using UnityEngine;

namespace NBLD.World
{
    public class LoginScreenController : MonoBehaviour
    {
        [SerializeField] private string httpBaseUrl = "http://127.0.0.1:6363";
        [SerializeField] private string defaultCharacterName = "Hero";
        [SerializeField] private bool autoCreateCharacterWhenEmpty = true;

        private HttpSessionClient _httpClient;
        private bool _busy;
        private bool _showRegister;
        private string _email = "";
        private string _username = "";
        private string _password = "";
        private string _confirmPassword = "";
        private string _status = "请输入邮箱和密码";
        private GUIStyle _panelStyle;
        private GUIStyle _titleStyle;
        private GUIStyle _textStyle;

        private void Awake()
        {
            _httpClient = new HttpSessionClient(httpBaseUrl);
            PlayerSessionState.Clear();
        }

        private void OnGUI()
        {
            EnsureStyles();

            var width = Mathf.Min(460f, Screen.width - 32f);
            var height = _showRegister ? 420f : 340f;
            var rect = new Rect((Screen.width - width) * 0.5f, (Screen.height - height) * 0.5f, width, height);

            GUI.Box(rect, GUIContent.none, _panelStyle);
            GUILayout.BeginArea(new Rect(rect.x + 20f, rect.y + 20f, rect.width - 40f, rect.height - 40f));

            GUILayout.Label(_showRegister ? "注册账号" : "邮箱登录", _titleStyle);
            GUILayout.Label("NBLD Online", _textStyle);
            GUILayout.Space(12f);

            GUILayout.Label("邮箱", _textStyle);
            _email = GUILayout.TextField(_email);

            if (_showRegister)
            {
                GUILayout.Label("用户名", _textStyle);
                _username = GUILayout.TextField(_username);
            }

            GUILayout.Label("密码", _textStyle);
            _password = GUILayout.PasswordField(_password, '*');

            if (_showRegister)
            {
                GUILayout.Label("再次输入密码", _textStyle);
                _confirmPassword = GUILayout.PasswordField(_confirmPassword, '*');
            }

            GUILayout.Space(14f);
            GUI.enabled = !_busy;
            if (GUILayout.Button(_showRegister ? "注册并进入游戏" : "登录并进入游戏", GUILayout.Height(36f)))
            {
                _ = SubmitAsync();
            }

            if (GUILayout.Button(_showRegister ? "切换到登录" : "切换到注册", GUILayout.Height(32f)))
            {
                _showRegister = !_showRegister;
                _status = _showRegister ? "请填写注册信息" : "请输入邮箱和密码";
            }
            GUI.enabled = true;

            GUILayout.Space(12f);
            GUILayout.Label(_status, _textStyle);

            GUILayout.EndArea();
        }

        private async Task SubmitAsync()
        {
            if (_busy)
            {
                return;
            }

            _busy = true;
            try
            {
                if (_showRegister)
                {
                    _status = "注册中...";
                    var register = await _httpClient.RegisterAsync(_email, _username, _password, _confirmPassword);
                    PlayerSessionState.AccountId = register.accountId;
                    PlayerSessionState.Email = register.email;
                    PlayerSessionState.Username = register.username;
                }

                _status = "登录中...";
                var login = await _httpClient.LoginAsync(_email, _password);
                PlayerSessionState.Token = login.token;
                PlayerSessionState.AccountId = login.accountId;
                PlayerSessionState.Email = login.email;
                PlayerSessionState.Username = login.username;

                _status = "读取角色...";
                var roster = await _httpClient.GetCharactersAsync(login.token);
                CharacterSummary chosen = null;
                if (roster.active != null && roster.active.Length > 0)
                {
                    chosen = roster.active[0];
                }
                else if (autoCreateCharacterWhenEmpty)
                {
                    _status = "创建角色...";
                    var created = await _httpClient.CreateCharacterAsync(login.token, BuildDefaultCharacterName());
                    chosen = created.character;
                }

                if (chosen == null)
                {
                    throw new Exception("没有可用角色，且未启用自动创建角色。");
                }

                PlayerSessionState.CharacterId = chosen.id;
                PlayerSessionState.CharacterName = chosen.name;
                _status = "进入世界...";

                gameObject.SetActive(false);
            }
            catch (Exception ex)
            {
                _status = SimplifyError(ex.Message);
            }
            finally
            {
                _busy = false;
            }
        }

        private string BuildDefaultCharacterName()
        {
            if (!string.IsNullOrWhiteSpace(PlayerSessionState.Username))
            {
                return PlayerSessionState.Username;
            }

            if (!string.IsNullOrWhiteSpace(defaultCharacterName))
            {
                return defaultCharacterName;
            }

            return "Hero";
        }

        private static string SimplifyError(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
            {
                return "请求失败";
            }

            var lines = input.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length > 0 ? lines[0] : input;
        }

        private void EnsureStyles()
        {
            if (_panelStyle == null)
            {
                _panelStyle = new GUIStyle(GUI.skin.box);
                _panelStyle.normal.background = MakeTexture(new Color(0.96f, 0.94f, 0.89f, 0.96f));
                _panelStyle.border = new RectOffset(12, 12, 12, 12);
                _panelStyle.padding = new RectOffset(18, 18, 18, 18);
            }

            if (_titleStyle == null)
            {
                _titleStyle = new GUIStyle(GUI.skin.label);
                _titleStyle.fontSize = 28;
                _titleStyle.fontStyle = FontStyle.Bold;
                _titleStyle.normal.textColor = new Color(0.13f, 0.16f, 0.2f);
            }

            if (_textStyle == null)
            {
                _textStyle = new GUIStyle(GUI.skin.label);
                _textStyle.fontSize = 15;
                _textStyle.wordWrap = true;
                _textStyle.normal.textColor = new Color(0.22f, 0.25f, 0.28f);
            }
        }

        private static Texture2D MakeTexture(Color color)
        {
            var texture = new Texture2D(1, 1, TextureFormat.RGBA32, false);
            texture.SetPixel(0, 0, color);
            texture.Apply();
            return texture;
        }
    }
