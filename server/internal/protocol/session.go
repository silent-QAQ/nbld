package protocol

type GuestLoginRequest struct {
	DeviceID string `json:"deviceId"`
}

type GuestLoginResponse struct {
	PlayerID   string `json:"playerId"`
	Token      string `json:"token"`
	ServerTime string `json:"serverTime"`
}

type RegisterRequest struct {
	Email           string `json:"email"`
	Username        string `json:"username"`
	Password        string `json:"password"`
	ConfirmPassword string `json:"confirmPassword"`
}

type RegisterResponse struct {
	AccountID  string `json:"accountId"`
	Email      string `json:"email"`
	Username   string `json:"username"`
	ServerTime string `json:"serverTime"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	AccountID  string `json:"accountId"`
	Email      string `json:"email"`
	Username   string `json:"username"`
	Token      string `json:"token"`
	ServerTime string `json:"serverTime"`
}

type RandomSeedResponse struct {
	Seed  int64  `json:"seed"`
	MapID string `json:"mapId"`
}

type HealthzResponse struct {
	Status     string                 `json:"status"`
	InstanceID string                 `json:"instanceId"`
	StartedAt  string                 `json:"startedAt"`
	Checks     map[string]HealthCheck `json:"checks,omitempty"`
}

type HealthCheck struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type AdminAccountSummary struct {
	ID                   string `json:"id"`
	Email                string `json:"email"`
	Username             string `json:"username"`
	ActiveCharacterCount int    `json:"activeCharacterCount"`
	CreatedAt            string `json:"createdAt"`
}

type AdminAccountsResponse struct {
	Accounts []AdminAccountSummary `json:"accounts"`
}

type AdminCharacterResponse struct {
	Character CharacterSummary `json:"character"`
}

type AdminAuditLogEntry struct {
	ActorAccountID string         `json:"actorAccountId,omitempty"`
	ActorType      string         `json:"actorType"`
	TargetType     string         `json:"targetType"`
	TargetID       string         `json:"targetId"`
	Action         string         `json:"action"`
	Payload        map[string]any `json:"payload"`
	CreatedAt      string         `json:"createdAt"`
}

type AdminAuditLogsResponse struct {
	Logs []AdminAuditLogEntry `json:"logs"`
}

type AdminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type AdminLoginResponse struct {
	Status string `json:"status"`
}

type AdminAccountCharactersResponse struct {
	Characters []CharacterSummary `json:"characters"`
}

type AdminSessionSummary struct {
	Token         string `json:"token"`
	AccountID     string `json:"accountId"`
	CharacterID   string `json:"characterId,omitempty"`
	CharacterName string `json:"characterName,omitempty"`
	WorldID       string `json:"worldId,omitempty"`
	MapID         string `json:"mapId,omitempty"`
	LastSeenAt    string `json:"lastSeenAt"`
}

type AdminSessionsResponse struct {
	Sessions []AdminSessionSummary `json:"sessions"`
}

type EnterWorldRequest struct {
	Token       string `json:"token"`
	CharacterID string `json:"characterId,omitempty"`
}

type Position struct {
	// X and Y represent the entity center in world tile coordinates.
	// Gameplay occupancy still uses a 1x1 tile entity footprint.
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type EnterWorldResponse struct {
	PlayerID      string   `json:"playerId"`
	CharacterID   string   `json:"characterId,omitempty"`
	CharacterName string   `json:"characterName,omitempty"`
	WorldID       string   `json:"worldId"`
	MapID         string   `json:"mapId,omitempty"`
	Position      Position `json:"position"`
}

type WorldStateResponse struct {
	WorldID       string        `json:"worldId"`
	MapID         string        `json:"mapId,omitempty"`
	PlayerID      string        `json:"playerId"`
	CharacterID   string        `json:"characterId,omitempty"`
	CharacterName string        `json:"characterName,omitempty"`
	Position      Position      `json:"position"`
	Biome         string        `json:"biome"`
	Seed          int64         `json:"seed"`
	Players       []WorldPlayer `json:"players"`
}

type MoveRequest struct {
	Token    string   `json:"token"`
	Position Position `json:"position"`
}

type LeaveWorldRequest struct {
	Token string `json:"token"`
}

type MoveResponse struct {
	PlayerID    string   `json:"playerId"`
	CharacterID string   `json:"characterId,omitempty"`
	MapID       string   `json:"mapId,omitempty"`
	Position    Position `json:"position"`
}

type LeaveWorldResponse struct {
	PlayerID    string `json:"playerId"`
	CharacterID string `json:"characterId,omitempty"`
	Status      string `json:"status"`
}

type WorldPlayer struct {
	PlayerID      string   `json:"playerId"`
	CharacterID   string   `json:"characterId,omitempty"`
	CharacterName string   `json:"characterName,omitempty"`
	MapID         string   `json:"mapId,omitempty"`
	Position      Position `json:"position"`
}

type WorldEvent struct {
	Type          string   `json:"type"`
	PlayerID      string   `json:"playerId"`
	CharacterID   string   `json:"characterId,omitempty"`
	CharacterName string   `json:"characterName,omitempty"`
	MapID         string   `json:"mapId,omitempty"`
	Position      Position `json:"position"`
	OccurredAt    string   `json:"occurredAt"`
}

type WSClientMessage struct {
	Type     string   `json:"type"`
	Token    string   `json:"token,omitempty"`
	Position Position `json:"position,omitempty"`
}

type WSServerMessage struct {
	Type          string        `json:"type"`
	PlayerID      string        `json:"playerId,omitempty"`
	CharacterID   string        `json:"characterId,omitempty"`
	CharacterName string        `json:"characterName,omitempty"`
	WorldID       string        `json:"worldId,omitempty"`
	MapID         string        `json:"mapId,omitempty"`
	Position      Position      `json:"position,omitempty"`
	Players       []WorldPlayer `json:"players,omitempty"`
	Error         string        `json:"error,omitempty"`
}

type CharacterStats struct {
	Base    CharacterBaseStats    `json:"base"`
	Attack  CharacterAttackStats  `json:"attack"`
	Defense CharacterDefenseStats `json:"defense"`
}

type CharacterBaseStats struct {
	Health    int `json:"health"`
	Stamina   int `json:"stamina"`
	Mana      int `json:"mana"`
	MoveSpeed int `json:"moveSpeed"`
}

type CharacterAttackStats struct {
	PhysicalAttack  int `json:"physicalAttack"`
	SpellAttack     int `json:"spellAttack"`
	PhysicalCrit    int `json:"physicalCrit"`
	SpellCrit       int `json:"spellCrit"`
	DamageBonus     int `json:"damageBonus"`
	CritDamageBonus int `json:"critDamageBonus"`
	BonusDamage     int `json:"bonusDamage"`
}

type CharacterDefenseStats struct {
	PhysicalDefense  int `json:"physicalDefense"`
	SpellDefense     int `json:"spellDefense"`
	CritResistance   int `json:"critResistance"`
	DamageMitigation int `json:"damageMitigation"`
	BonusMitigation  int `json:"bonusMitigation"`
}

type ItemStack struct {
	ItemID   string `json:"itemId"`
	Quantity int    `json:"quantity"`
}

type ItemContainer struct {
	Items []ItemStack `json:"items"`
}

type CharacterPosition struct {
	WorldID string  `json:"worldId"`
	MapID   string  `json:"mapId"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
}

type VisibleArmor struct {
	Helmet    string `json:"helmet,omitempty"`
	Chest     string `json:"chest,omitempty"`
	Pants     string `json:"pants,omitempty"`
	Shoes     string `json:"shoes,omitempty"`
	Shoulders string `json:"shoulders,omitempty"`
}

type CharacterEquipment struct {
	MainHand     string       `json:"mainHand,omitempty"`
	OffHand      string       `json:"offHand,omitempty"`
	Helmet       string       `json:"helmet,omitempty"`
	Chest        string       `json:"chest,omitempty"`
	Pants        string       `json:"pants,omitempty"`
	Shoes        string       `json:"shoes,omitempty"`
	Shoulders    string       `json:"shoulders,omitempty"`
	Cloak        string       `json:"cloak,omitempty"`
	LeftBracer   string       `json:"leftBracer,omitempty"`
	RightBracer  string       `json:"rightBracer,omitempty"`
	VisibleArmor VisibleArmor `json:"visibleArmor"`
}

type CharacterSummary struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Version   int64              `json:"version"`
	Stats     CharacterStats     `json:"stats"`
	Inventory ItemContainer      `json:"inventory"`
	Warehouse ItemContainer      `json:"warehouse"`
	Position  CharacterPosition  `json:"position"`
	Equipment CharacterEquipment `json:"equipment"`
	DeletedAt string             `json:"deletedAt,omitempty"`
	PurgeAt   string             `json:"purgeAt,omitempty"`
	CreatedAt string             `json:"createdAt"`
	UpdatedAt string             `json:"updatedAt"`
}

type CharacterListResponse struct {
	Active       []CharacterSummary `json:"active"`
	Deleted      []CharacterSummary `json:"deleted"`
	ActiveLimit  int                `json:"activeLimit"`
	DeletedLimit int                `json:"deletedLimit"`
}

type CreateCharacterRequest struct {
	Token string `json:"token"`
	Name  string `json:"name"`
}

type UpdateCharacterStatsRequest struct {
	Token       string         `json:"token"`
	CharacterID string         `json:"characterId"`
	Stats       CharacterStats `json:"stats"`
}

type UpdateCharacterInventoryRequest struct {
	Token       string        `json:"token"`
	CharacterID string        `json:"characterId"`
	Inventory   ItemContainer `json:"inventory"`
}

type UpdateCharacterWarehouseRequest struct {
	Token       string        `json:"token"`
	CharacterID string        `json:"characterId"`
	Warehouse   ItemContainer `json:"warehouse"`
}

type UpdateCharacterEquipmentRequest struct {
	Token       string             `json:"token"`
	CharacterID string             `json:"characterId"`
	Equipment   CharacterEquipment `json:"equipment"`
}

type DeleteCharacterRequest struct {
	Token       string `json:"token"`
	CharacterID string `json:"characterId"`
}

type CharacterMutationResponse struct {
	Character CharacterSummary `json:"character"`
}

type DeleteCharacterResponse struct {
	Character CharacterSummary `json:"character"`
}
