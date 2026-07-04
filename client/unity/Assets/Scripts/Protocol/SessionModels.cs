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
    public class RegisterRequest
    {
        public string email;
        public string username;
        public string password;
        public string confirmPassword;
    }

    [Serializable]
    public class RegisterResponse
    {
        public string accountId;
        public string email;
        public string username;
        public string serverTime;
    }

    [Serializable]
    public class LoginRequest
    {
        public string email;
        public string password;
    }

    [Serializable]
    public class LoginResponse
    {
        public string accountId;
        public string email;
        public string username;
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
        public string characterId;
    }

    [Serializable]
    public class EnterWorldResponse
    {
        public string playerId;
        public string characterId;
        public string characterName;
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
        public string characterId;
        public string mapId;
        public Position position;
    }

    [Serializable]
    public class CharacterBaseStats
    {
        public int health;
        public int stamina;
        public int mana;
        public int moveSpeed;
    }

    [Serializable]
    public class CharacterAttackStats
    {
        public int physicalAttack;
        public int spellAttack;
        public int physicalCrit;
        public int spellCrit;
        public int damageBonus;
        public int critDamageBonus;
        public int bonusDamage;
    }

    [Serializable]
    public class CharacterDefenseStats
    {
        public int physicalDefense;
        public int spellDefense;
        public int critResistance;
        public int damageMitigation;
        public int bonusMitigation;
    }

    [Serializable]
    public class CharacterStats
    {
        public CharacterBaseStats @base;
        public CharacterAttackStats attack;
        public CharacterDefenseStats defense;
    }

    [Serializable]
    public class ItemStack
    {
        public string itemId;
        public int quantity;
    }

    [Serializable]
    public class ItemContainer
    {
        public ItemStack[] items;
    }

    [Serializable]
    public class CharacterPosition
    {
        public string worldId;
        public string mapId;
        public float x;
        public float y;
    }

    [Serializable]
    public class VisibleArmor
    {
        public string helmet;
        public string chest;
        public string pants;
        public string shoes;
        public string shoulders;
    }

    [Serializable]
    public class CharacterEquipment
    {
        public string mainHand;
        public string offHand;
        public string helmet;
        public string chest;
        public string pants;
        public string shoes;
        public string shoulders;
        public string cloak;
        public string leftBracer;
        public string rightBracer;
        public VisibleArmor visibleArmor;
    }

    [Serializable]
    public class CharacterSummary
    {
        public string id;
        public string name;
        public long version;
        public CharacterStats stats;
        public ItemContainer inventory;
        public ItemContainer warehouse;
        public CharacterPosition position;
        public CharacterEquipment equipment;
        public string deletedAt;
        public string purgeAt;
        public string createdAt;
        public string updatedAt;
    }

    [Serializable]
    public class CharacterListResponse
    {
        public CharacterSummary[] active;
        public CharacterSummary[] deleted;
        public int activeLimit;
        public int deletedLimit;
    }

    [Serializable]
    public class CreateCharacterRequest
    {
        public string token;
        public string name;
    }

    [Serializable]
    public class CharacterMutationResponse
    {
        public CharacterSummary character;
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
