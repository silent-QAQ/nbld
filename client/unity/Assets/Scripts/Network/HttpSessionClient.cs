using System.Text;
using System.Threading.Tasks;
using NBLD.Protocol;
using UnityEngine;
using UnityEngine.Networking;

namespace NBLD.Network
{
    public class HttpSessionClient
    {
        private readonly string _baseUrl;

        public HttpSessionClient(string baseUrl)
        {
            _baseUrl = baseUrl.TrimEnd('/');
        }

        public async Task<GuestLoginResponse> GuestLoginAsync(string deviceId)
        {
            var request = new GuestLoginRequest
            {
                deviceId = deviceId,
            };

            return await PostJsonAsync<GuestLoginResponse>("/api/v1/session/guest", JsonUtility.ToJson(request));
        }

        public async Task<EnterWorldResponse> EnterWorldAsync(string token)
        {
            var request = new EnterWorldRequest
            {
                token = token,
            };

            return await PostJsonAsync<EnterWorldResponse>("/api/v1/world/enter", JsonUtility.ToJson(request));
        }

        public async Task<ChunkWindowResponse> GetChunkWindowAsync(string token)
        {
            return await GetJsonAsync<ChunkWindowResponse>($"/api/v1/world/chunks?token={UnityWebRequest.EscapeURL(token)}");
        }

        public async Task<MoveResponse> MoveAsync(string token, float x, float y)
        {
            var request = new MoveRequest
            {
                token = token,
                position = new Position
                {
                    x = x,
                    y = y,
                },
            };

            return await PostJsonAsync<MoveResponse>("/api/v1/world/move", JsonUtility.ToJson(request));
        }

        public async Task<RandomSeedResponse> RandomizeSeedAsync()
        {
            return await PostJsonAsync<RandomSeedResponse>("/api/v1/world/seed/random", "{}");
        }

        private async Task<T> PostJsonAsync<T>(string path, string json)
        {
            using var request = new UnityWebRequest(_baseUrl + path, UnityWebRequest.kHttpVerbPOST);
            var payload = Encoding.UTF8.GetBytes(json);
            request.uploadHandler = new UploadHandlerRaw(payload);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");

            var operation = request.SendWebRequest();
            while (!operation.isDone)
            {
                await Task.Yield();
            }

            if (request.result != UnityWebRequest.Result.Success)
            {
                throw new UnityException(request.error);
            }

            return JsonUtility.FromJson<T>(request.downloadHandler.text);
        }

        private async Task<T> GetJsonAsync<T>(string path)
        {
            using var request = UnityWebRequest.Get(_baseUrl + path);
            var operation = request.SendWebRequest();
            while (!operation.isDone)
            {
                await Task.Yield();
            }

            if (request.result != UnityWebRequest.Result.Success)
            {
                throw new UnityException(request.error);
            }

            return JsonUtility.FromJson<T>(request.downloadHandler.text);
        }
    }
}
