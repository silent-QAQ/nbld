using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NBLD.Protocol;
using UnityEngine;

namespace NBLD.Network
{
    public class WorldWebSocketClient : IDisposable
    {
        private readonly Uri _uri;
        private readonly ClientWebSocket _socket = new ClientWebSocket();
        private readonly byte[] _buffer = new byte[8192];
        private CancellationTokenSource _cts;
        private bool _disposed;

        public event Action<WSServerMessage> MessageReceived;
        public event Action<string> ErrorReceived;

        public bool IsOpen => !_disposed && _socket.State == WebSocketState.Open;

        public WorldWebSocketClient(string url)
        {
            _uri = new Uri(url);
        }

        public async Task ConnectAsync(string token)
        {
            _cts = new CancellationTokenSource();
            try
            {
                await _socket.ConnectAsync(_uri, _cts.Token);
            }
            catch (Exception ex)
            {
                ErrorReceived?.Invoke($"connect failed: {ex.Message}");
                throw;
            }

            var authMessage = new WSClientMessage
            {
                type = "auth",
                token = token,
            };

            await SendAsync(authMessage);
            _ = ReceiveLoop();
        }

        public async Task SendMoveAsync(float x, float y)
        {
            if (!IsOpen)
            {
                ErrorReceived?.Invoke($"move skipped: socket state is {_socket.State}");
                return;
            }

            var message = new WSClientMessage
            {
                type = "move",
                position = new Position
                {
                    x = x,
                    y = y,
                },
            };

            await SendAsync(message);
        }

        private async Task SendAsync(WSClientMessage message)
        {
            if (!IsOpen)
            {
                ErrorReceived?.Invoke($"send skipped: socket state is {_socket.State}");
                return;
            }

            var json = JsonUtility.ToJson(message);
            var bytes = Encoding.UTF8.GetBytes(json);
            try
            {
                await _socket.SendAsync(bytes, WebSocketMessageType.Text, true, _cts.Token);
            }
            catch (Exception ex)
            {
                ErrorReceived?.Invoke($"send failed: {ex.Message}");
            }
        }

        private async Task ReceiveLoop()
        {
            try
            {
                while (_socket.State == WebSocketState.Open)
                {
                    var result = await _socket.ReceiveAsync(_buffer, _cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await CloseSocketAsync();
                        ErrorReceived?.Invoke("socket closed by server");
                        return;
                    }

                    var json = Encoding.UTF8.GetString(_buffer, 0, result.Count);
                    var message = JsonUtility.FromJson<WSServerMessage>(json);
                    if (!string.IsNullOrEmpty(message.error))
                    {
                        ErrorReceived?.Invoke(message.error);
                    }
                    else
                    {
                        MessageReceived?.Invoke(message);
                    }
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                ErrorReceived?.Invoke($"receive failed: {ex.Message}");
            }
        }

        private async Task CloseSocketAsync()
        {
            if (_disposed)
            {
                return;
            }

            if (_socket.State == WebSocketState.Open || _socket.State == WebSocketState.CloseReceived)
            {
                await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "client closing", _cts.Token);
            }
        }

        public void Dispose()
        {
            _disposed = true;
            _cts?.Cancel();
            _socket?.Dispose();
            _cts?.Dispose();
        }
    }
}
