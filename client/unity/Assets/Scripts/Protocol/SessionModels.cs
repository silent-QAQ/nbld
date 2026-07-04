using System;

namespace NBLD.Protocol
{
    [Serializable]
    public class GuestLoginRequest
    {
        public string deviceId;
    }

    [Serializable]
    public class GuestLoginResponse
    {
        public string playerId;
        public string token;
        public string serverTime;
    }

    [Serializable]
    public class RandomSeedResponse
    {
        public long seed;
        public string mapId;
    }

    [Serializable]
    public class EnterWorldRequest
    {
        public string token;
    }

    [Serializable]
    public class EnterWorldResponse
    {
        public string playerId;
        public string worldId;
        public string mapId;
        public Position position;
    }

    [Serializable]
    public class MoveRequest
    {
        public string token;
        public Position position;
    }

    [Serializable]
    public class MoveResponse
    {
        public string playerId;
        public string mapId;
        public Position position;
    }

    [Serializable]
    public class Position
    {
        public float x;
        public float y;
    }

    [Serializable]
    public class WorldPlayer
    {
        public string playerId;
        public string mapId;
        public Position position;
    }

    [Serializable]
    public class ChunkCoord
    {
        public string mapId;
        public int chunkX;
        public int chunkY;
    }

    [Serializable]
    public class ChunkTile
    {
        public int x;
        public int y;
        public string terrain;
        public string block;
        public string feature;
        public string decoration;
        public string levelHint;
    }

    [Serializable]
    public class ChunkSnapshot
    {
        public ChunkCoord coord;
        public string biome;
        public bool generated;
        public bool dirty;
        public string lastSaved;
        public ChunkTile[] tiles;
        public string edgeNorth;
        public string edgeSouth;
        public string edgeWest;
        public string edgeEast;
    }

    [Serializable]
    public class ChunkWindowResponse
    {
        public string mapId;
        public int centerChunkX;
        public int centerChunkY;
        public int loadRadius;
        public int chunkTileSize;
        public int mapChunkSpan;
        public ChunkSnapshot[] chunks;
        public ChunkCoord[] unloadedChunks;
        public string transitionMapId;
    }

    [Serializable]
    public class WSClientMessage
    {
        public string type;
        public string token;
        public Position position;
    }

    [Serializable]
    public class WSServerMessage
    {
        public string type;
        public string playerId;
        public string worldId;
        public string mapId;
        public Position position;
        public WorldPlayer[] players;
        public string error;
    }
}
