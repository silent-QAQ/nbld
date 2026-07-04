using System;
using System.Threading.Tasks;
using NBLD.Network;
using NBLD.Protocol;
using UnityEngine;

namespace NBLD.World
{
    public class WorldBootstrap : MonoBehaviour
    {
        [SerializeField] private string httpBaseUrl = "http://127.0.0.1:6363";
        [SerializeField] private string wsUrlOverride = "";
        [SerializeField] private Transform playerTransform;
        [SerializeField] private Camera worldCamera;
        [SerializeField] private ChunkWorldRenderer chunkWorldRenderer;
        [SerializeField] private Vector2 spawnPoint = Vector2.zero;
        [SerializeField] private bool clampPlayerToBounds = false;
        [SerializeField] private Vector2 worldBounds = new Vector2(12f, 12f);
        [SerializeField] private float moveTilesPerSecond = 2f;
        [SerializeField] private float playerSizeInTiles = 0.5f;
        [SerializeField] private float moveSendInterval = 0.08f;
        [SerializeField] private float chunkRefreshInterval = 0.35f;
        [SerializeField] private bool buildSimpleWorldVisuals = true;

        private HttpSessionClient _httpClient;
        private WorldWebSocketClient _wsClient;
        private string _playerId;
        private string _token;
        private string _mapId;
        private bool _connected;
        private bool _chunkRefreshInFlight;
        private string _status = "Booting";
        private float _lastMoveSentAt = -999f;
        private float _lastChunkRefreshAt = -999f;
        private Vector3 _lastSentPosition;
        private string _lastSocketError = "-";

        public string StatusSummary => $"Status: {_status}    Map: {(_mapId ?? "-")}\nPlayer: {(_playerId ?? "-")}    Socket: {CompactSocketStatus()}";
        public Vector3 PlayerPosition => playerTransform != null ? playerTransform.position : Vector3.zero;
        public string CurrentTerrain =>
            chunkWorldRenderer != null && playerTransform != null
                ? chunkWorldRenderer.GetTerrainAtWorldPosition(playerTransform.position)
                : "-";

        private async void Start()
        {
            _httpClient = new HttpSessionClient(httpBaseUrl);
            _status = "Logging in";
            EnsureWorldVisuals();
            EnsureSpawnPoint();
            ConfigurePlayerPresentation();

            try
            {
                await ConnectAsync();
            }
            catch (Exception ex)
            {
                _status = "Connection failed";
                Debug.LogError($"NBLD bootstrap failed: {ex}");
            }
        }

        private async Task ConnectAsync()
        {
            var login = await _httpClient.GuestLoginAsync(SystemInfo.deviceUniqueIdentifier);
            _status = "Entering world";
            _token = login.token;
            var enterWorld = await _httpClient.EnterWorldAsync(login.token);

            _playerId = enterWorld.playerId;
            _mapId = enterWorld.mapId;
            if (playerTransform != null)
            {
                var startPosition = new Vector3(
                    enterWorld.position.x + spawnPoint.x,
                    enterWorld.position.y + spawnPoint.y,
                    0f
                );
                playerTransform.position = ClampToBounds(startPosition);
                _lastSentPosition = playerTransform.position;
            }

            _wsClient = new WorldWebSocketClient(BuildWorldWsUrl());
            _wsClient.MessageReceived += HandleServerMessage;
            _wsClient.ErrorReceived += HandleSocketError;
            await _wsClient.ConnectAsync(login.token);
            _connected = true;
            _status = "Connected";
            BindCamera();
            await RefreshChunkWindowAsync(true);
        }

        private string BuildWorldWsUrl()
        {
            if (!string.IsNullOrWhiteSpace(wsUrlOverride))
            {
                return wsUrlOverride.Trim();
            }

            var httpUri = new Uri(httpBaseUrl.TrimEnd('/'));
            var builder = new UriBuilder(httpUri);
            builder.Scheme = httpUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws";
            builder.Path = "/ws/world";
            return builder.Uri.ToString();
        }

        private async void Update()
        {
            if (!_connected || playerTransform == null)
            {
                return;
            }

            var horizontal = Input.GetAxisRaw("Horizontal");
            var vertical = Input.GetAxisRaw("Vertical");
            if (Mathf.Approximately(horizontal, 0f) && Mathf.Approximately(vertical, 0f))
            {
                return;
            }

            var delta = new Vector3(horizontal, vertical, 0f).normalized * (GetMoveSpeedWorldUnits() * Time.deltaTime);
            playerTransform.position = ClampToBounds(playerTransform.position + delta);
            UpdateRenderedChunksVisibility();

            var movedEnough = Vector3.Distance(playerTransform.position, _lastSentPosition) > 0.01f;
            var due = Time.time - _lastMoveSentAt >= moveSendInterval;
            if (movedEnough && due && _wsClient != null && _wsClient.IsOpen)
            {
                await _wsClient.SendMoveAsync(playerTransform.position.x, playerTransform.position.y);
                _lastMoveSentAt = Time.time;
                _lastSentPosition = playerTransform.position;
            }

            if (Time.time - _lastChunkRefreshAt >= chunkRefreshInterval)
            {
                await RefreshChunkWindowAsync(false);
            }
        }

        private void HandleServerMessage(WSServerMessage message)
        {
            if (message.type == "auth_ok")
            {
                _status = "Connected";
                Debug.Log($"NBLD ws auth ok: {_playerId}");
                return;
            }

            if (message.type == "map_transition" && !string.IsNullOrWhiteSpace(message.mapId))
            {
                _mapId = message.mapId;
            }

            if (message.type == "player_moved" && message.playerId == _playerId && playerTransform != null)
            {
                if (!string.IsNullOrWhiteSpace(message.mapId))
                {
                    _mapId = message.mapId;
                }
                playerTransform.position = ClampToBounds(new Vector3(message.position.x, message.position.y, 0f));
                UpdateRenderedChunksVisibility();
            }
        }

        private void HandleSocketError(string error)
        {
            _lastSocketError = error;
            _status = "Socket error";
            Debug.LogError($"NBLD ws error: {error}");
        }

        private void BindCamera()
        {
            if (worldCamera == null)
            {
                worldCamera = Camera.main;
            }

            if (worldCamera == null || playerTransform == null)
            {
                return;
            }

            var follow = worldCamera.GetComponent<FollowCamera>();
            if (follow == null)
            {
                follow = worldCamera.gameObject.AddComponent<FollowCamera>();
            }

            follow.SetTarget(playerTransform);
        }

        private void EnsureSpawnPoint()
        {
            if (playerTransform == null)
            {
                return;
            }

            if (playerTransform.position == Vector3.zero)
            {
                playerTransform.position = ClampToBounds(new Vector3(spawnPoint.x, spawnPoint.y, 0f));
            }
        }

        private void ConfigurePlayerPresentation()
        {
            if (playerTransform == null)
            {
                return;
            }

            var cellWorldSize = chunkWorldRenderer != null ? chunkWorldRenderer.CellWorldSize : 4f;
            var playerWorldSize = cellWorldSize * playerSizeInTiles;
            playerTransform.localScale = new Vector3(playerWorldSize, playerWorldSize, 1f);
        }

        private Vector3 ClampToBounds(Vector3 position)
        {
            if (!clampPlayerToBounds)
            {
                position.z = 0f;
                return position;
            }

            var halfWidth = worldBounds.x * 0.5f;
            var halfHeight = worldBounds.y * 0.5f;

            position.x = Mathf.Clamp(position.x, -halfWidth, halfWidth);
            position.y = Mathf.Clamp(position.y, -halfHeight, halfHeight);
            position.z = 0f;
            return position;
        }

        private void EnsureWorldVisuals()
        {
            if (!buildSimpleWorldVisuals || chunkWorldRenderer != null)
            {
                return;
            }

            var visuals = GetComponent<SimpleWorldVisuals>();
            if (visuals == null)
            {
                visuals = gameObject.AddComponent<SimpleWorldVisuals>();
            }

            visuals.Build();
        }

        private float GetMoveSpeedWorldUnits()
        {
            var cellWorldSize = chunkWorldRenderer != null ? chunkWorldRenderer.CellWorldSize : 4f;
            return moveTilesPerSecond * cellWorldSize;
        }

        private async Task RefreshChunkWindowAsync(bool force)
        {
            if (string.IsNullOrWhiteSpace(_token) || chunkWorldRenderer == null)
            {
                return;
            }

            if (_chunkRefreshInFlight)
            {
                return;
            }

            if (!force && Time.time - _lastChunkRefreshAt < chunkRefreshInterval)
            {
                return;
            }

            _chunkRefreshInFlight = true;
            _lastChunkRefreshAt = Time.time;
            try
            {
                var window = await _httpClient.GetChunkWindowAsync(_token);
                if (!string.IsNullOrWhiteSpace(window.mapId))
                {
                    _mapId = window.mapId;
                }
                chunkWorldRenderer.ApplyWindow(window);
                UpdateRenderedChunksVisibility();
            }
            catch (Exception ex)
            {
                _lastSocketError = $"chunk refresh failed: {ex.Message}";
            }
            finally
            {
                _chunkRefreshInFlight = false;
            }
        }

        public async void TeleportTo(Vector3 targetPosition)
        {
            if (playerTransform == null || string.IsNullOrWhiteSpace(_token))
            {
                return;
            }

            playerTransform.position = ClampToBounds(targetPosition);
            try
            {
                var move = await _httpClient.MoveAsync(_token, playerTransform.position.x, playerTransform.position.y);
                _mapId = move.mapId;
                playerTransform.position = new Vector3(move.position.x, move.position.y, 0f);
                _lastSentPosition = playerTransform.position;
            }
            catch (Exception ex)
            {
                _lastSocketError = $"teleport failed: {ex.Message}";
            }
            await RefreshChunkWindowAsync(true);
        }

        public bool ToggleChunkHighlight()
        {
            if (chunkWorldRenderer == null)
            {
                return false;
            }

            return chunkWorldRenderer.ToggleChunkHighlight();
        }

        private void UpdateRenderedChunksVisibility()
        {
            if (chunkWorldRenderer == null || playerTransform == null)
            {
                return;
            }

            chunkWorldRenderer.UpdateVisibleWindow(playerTransform.position, _mapId, 80);
        }

        public async Task<long> RandomizeWorldSeedAsync()
        {
            var response = await _httpClient.RandomizeSeedAsync();
            _mapId = response.MapID;
            await RefreshChunkWindowAsync(true);
            return response.Seed;
        }

        private string CompactSocketStatus()
        {
            if (string.IsNullOrWhiteSpace(_lastSocketError) || _lastSocketError == "-")
            {
                return "ok";
            }

            const int maxLength = 48;
            if (_lastSocketError.Length <= maxLength)
            {
                return _lastSocketError;
            }

            return _lastSocketError.Substring(0, maxLength) + "...";
        }

        private void OnDestroy()
        {
            if (_wsClient != null)
            {
                _wsClient.Dispose();
            }
        }
    }
}
