package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxActiveCharacters  = 3
	maxDeletedCharacters = 2
	deletedRetentionDays = 30
)

var (
	ErrAccountExists           = errors.New("account already exists")
	ErrUsernameTaken           = errors.New("username already exists")
	ErrAccountNotFound         = errors.New("account not found")
	ErrCharacterNotFound       = errors.New("character not found")
	ErrCharacterDeleted        = errors.New("character deleted")
	ErrCharacterLimitReached   = errors.New("active character limit reached")
	ErrDeletedLimitReached     = errors.New("deleted character limit reached")
	ErrCharacterNameMissing    = errors.New("character name is required")
	ErrCharacterNameTooLong    = errors.New("character name is too long")
	ErrCharacterNameTooShort   = errors.New("character name is too short")
	ErrEmailMissing            = errors.New("email is required")
	ErrUsernameMissing         = errors.New("username is required")
	ErrPasswordMissing         = errors.New("password is required")
	ErrPasswordConfirmation    = errors.New("password confirmation does not match")
	ErrPasswordTooShort        = errors.New("password must be at least 8 characters")
	ErrUsernameTooShort        = errors.New("username must be at least 3 characters")
	ErrUsernameTooLong         = errors.New("username must be at most 24 characters")
	ErrInvalidEmailFormat      = errors.New("invalid email format")
	ErrAuthenticationFailed    = errors.New("invalid email or password")
	ErrCharacterSelectionEmpty = errors.New("characterId is required")
	ErrCharacterAppearance     = errors.New("character appearance is invalid")
)

type accountStore interface {
	CreateAccount(ctx context.Context, email, username, passwordHash string) (Account, error)
	FindAccountByEmail(ctx context.Context, email string) (Account, error)
	Ping(ctx context.Context) error
	PurgeExpiredDeletedCharacters(ctx context.Context, accountID string) error
	PurgeExpiredDeletedCharactersAll(ctx context.Context) error
	ListCharacters(ctx context.Context, accountID string) (CharacterRoster, error)
	CreateCharacter(ctx context.Context, accountID, name string) (Character, error)
	SoftDeleteCharacter(ctx context.Context, accountID, characterID string) (Character, error)
	GetCharacter(ctx context.Context, accountID, characterID string) (Character, error)
	SaveCharacter(ctx context.Context, accountID string, character Character) error
	SaveSession(ctx context.Context, session SessionRecord) error
	DeleteSession(ctx context.Context, token string) error
	AppendAuditLog(ctx context.Context, entry AuditLogEntry) error
	AdminListAccounts(ctx context.Context, limit int) ([]AdminAccountSummary, error)
	AdminListCharactersByAccount(ctx context.Context, accountID string) ([]Character, error)
	AdminGetCharacter(ctx context.Context, characterID string) (Character, error)
	AdminListAuditLogs(ctx context.Context, limit int) ([]AuditLogEntry, error)
	AdminListAuditLogsByTarget(ctx context.Context, targetType, targetID string, limit int) ([]AuditLogEntry, error)
}

type Account struct {
	ID           string
	Email        string
	Username     string
	PasswordHash string
	CreatedAt    time.Time
}

type CharacterRoster struct {
	Active  []Character
	Deleted []Character
}

type Character struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	Version    int64               `json:"version"`
	Stats      CharacterStats      `json:"stats"`
	Inventory  ItemContainer       `json:"inventory"`
	Warehouse  ItemContainer       `json:"warehouse"`
	Position   CharacterPosition   `json:"position"`
	Equipment  CharacterEquipment  `json:"equipment"`
	Appearance CharacterAppearance `json:"appearance"`
	DeletedAt  *time.Time          `json:"deletedAt,omitempty"`
	PurgeAt    *time.Time          `json:"purgeAt,omitempty"`
	CreatedAt  time.Time           `json:"createdAt"`
	UpdatedAt  time.Time           `json:"updatedAt"`
}

type CharacterAppearance struct {
	Body    CharacterBodyAppearance    `json:"body"`
	Style   CharacterStyleAppearance   `json:"style"`
	Hair    CharacterHairAppearance    `json:"hair"`
	Palette CharacterPaletteAppearance `json:"palette"`
}

type CharacterBodyAppearance struct {
	Height             int `json:"height"`
	FrontShoulderWidth int `json:"frontShoulderWidth"`
	SideWidth          int `json:"sideWidth"`
	ChestWidth         int `json:"chestWidth"`
	WaistWidth         int `json:"waistWidth"`
	HipWidth           int `json:"hipWidth"`
	TorsoHeight        int `json:"torsoHeight"`
	UpperArmWidth      int `json:"upperArmWidth"`
	UpperArmLength     int `json:"upperArmLength"`
	ForearmWidth       int `json:"forearmWidth"`
	ForearmLength      int `json:"forearmLength"`
	ThighWidth         int `json:"thighWidth"`
	ThighLength        int `json:"thighLength"`
	CalfWidth          int `json:"calfWidth"`
	CalfLength         int `json:"calfLength"`
	ChestDepth         int `json:"chestDepth"`
	WaistDepth         int `json:"waistDepth"`
	HipDepth           int `json:"hipDepth"`
	HeadScale          int `json:"headScale"`
}

type CharacterStyleAppearance struct {
	HairStyle string `json:"hairStyle"`
}

type CharacterHairAppearance struct {
	Front   []string `json:"front"`
	Back    []string `json:"back"`
	Left    []string `json:"left"`
	Right   []string `json:"right"`
	FrontFg []string `json:"frontFg"`
	BackFg  []string `json:"backFg"`
	LeftFg  []string `json:"leftFg"`
	RightFg []string `json:"rightFg"`
}

type CharacterPaletteAppearance struct {
	SkinPrimary  string `json:"skinPrimary"`
	SkinShadow   string `json:"skinShadow"`
	HairPrimary  string `json:"hairPrimary"`
	HairShadow   string `json:"hairShadow"`
	ClothPrimary string `json:"clothPrimary"`
	ClothShadow  string `json:"clothShadow"`
	MetalPrimary string `json:"metalPrimary"`
	MetalShadow  string `json:"metalShadow"`
}

type CharacterStats struct {
	Base    BaseStats    `json:"base"`
	Attack  AttackStats  `json:"attack"`
	Defense DefenseStats `json:"defense"`
}

type BaseStats struct {
	Health  int `json:"health"`
	Stamina int `json:"stamina"`
	Mana    int `json:"mana"`
	MoveSPD int `json:"moveSpeed"`
}

type AttackStats struct {
	PhysicalAttack  int `json:"physicalAttack"`
	SpellAttack     int `json:"spellAttack"`
	PhysicalCrit    int `json:"physicalCrit"`
	SpellCrit       int `json:"spellCrit"`
	DamageBonus     int `json:"damageBonus"`
	CritDamageBonus int `json:"critDamageBonus"`
	BonusDamage     int `json:"bonusDamage"`
}

type DefenseStats struct {
	PhysicalDefense int `json:"physicalDefense"`
	SpellDefense    int `json:"spellDefense"`
	CritResistance  int `json:"critResistance"`
	DamageMitigate  int `json:"damageMitigation"`
	BonusMitigate   int `json:"bonusMitigation"`
}

type ItemContainer struct {
	Items []ItemStack `json:"items"`
}

type ItemStack struct {
	ItemID   string `json:"itemId"`
	Quantity int    `json:"quantity"`
}

type CharacterPosition struct {
	WorldID string  `json:"worldId"`
	MapID   string  `json:"mapId"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
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

type VisibleArmor struct {
	Helmet    string `json:"helmet,omitempty"`
	Chest     string `json:"chest,omitempty"`
	Pants     string `json:"pants,omitempty"`
	Shoes     string `json:"shoes,omitempty"`
	Shoulders string `json:"shoulders,omitempty"`
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}

func validateRegistration(email, username, password, confirmPassword string) error {
	email = normalizeEmail(email)
	username = strings.TrimSpace(username)

	switch {
	case email == "":
		return ErrEmailMissing
	case !strings.Contains(email, "@"):
		return ErrInvalidEmailFormat
	case username == "":
		return ErrUsernameMissing
	case len([]rune(username)) < 3:
		return ErrUsernameTooShort
	case len([]rune(username)) > 24:
		return ErrUsernameTooLong
	case password == "":
		return ErrPasswordMissing
	case len(password) < 8:
		return ErrPasswordTooShort
	case password != confirmPassword:
		return ErrPasswordConfirmation
	default:
		return nil
	}
}

func validateCharacterName(name string) error {
	length := len([]rune(strings.TrimSpace(name)))
	switch {
	case length == 0:
		return ErrCharacterNameMissing
	case length < 2:
		return ErrCharacterNameTooShort
	case length > 24:
		return ErrCharacterNameTooLong
	default:
		return nil
	}
}

func defaultCharacterStats() CharacterStats {
	return CharacterStats{
		Base: BaseStats{
			Health:  100,
			Stamina: 100,
			Mana:    60,
			MoveSPD: 5,
		},
		Attack: AttackStats{
			PhysicalAttack:  10,
			SpellAttack:     10,
			PhysicalCrit:    5,
			SpellCrit:       5,
			DamageBonus:     0,
			CritDamageBonus: 0,
			BonusDamage:     0,
		},
		Defense: DefenseStats{
			PhysicalDefense: 5,
			SpellDefense:    5,
			CritResistance:  0,
			DamageMitigate:  0,
			BonusMitigate:   0,
		},
	}
}

func defaultCharacterPosition() CharacterPosition {
	return CharacterPosition{
		WorldID: "world-dev-001",
		MapID:   "map_0_0",
		X:       0,
		Y:       0,
	}
}

func defaultCharacterEquipment() CharacterEquipment {
	equipment := CharacterEquipment{}
	equipment.syncVisibleArmor()
	return equipment
}

func defaultCharacterAppearance() CharacterAppearance {
	return CharacterAppearance{
		Body: CharacterBodyAppearance{
			Height:             50,
			FrontShoulderWidth: 24,
			SideWidth:          12,
			ChestWidth:         20,
			WaistWidth:         16,
			HipWidth:           20,
			TorsoHeight:        20,
			UpperArmWidth:      4,
			UpperArmLength:     11,
			ForearmWidth:       4,
			ForearmLength:      10,
			ThighWidth:         5,
			ThighLength:        12,
			CalfWidth:          4,
			CalfLength:         11,
			ChestDepth:         10,
			WaistDepth:         9,
			HipDepth:           10,
			HeadScale:          100,
		},
		Style: CharacterStyleAppearance{
			HairStyle: "short",
		},
		Hair: CharacterHairAppearance{
			Front:   []string{"01110", "11111", "11111"},
			Back:    []string{"11111", "11111", "01110"},
			Left:    []string{"1110", "1111", "0111"},
			Right:   []string{"0111", "1111", "1110"},
			FrontFg: []string{"00100"},
			BackFg:  []string{},
			LeftFg:  []string{"001"},
			RightFg: []string{"100"},
		},
		Palette: CharacterPaletteAppearance{
			SkinPrimary:  "#f2c199",
			SkinShadow:   "#d89b72",
			HairPrimary:  "#2d1a13",
			HairShadow:   "#140b08",
			ClothPrimary: "#ff4040",
			ClothShadow:  "#b42222",
			MetalPrimary: "#cfd8e3",
			MetalShadow:  "#7e8794",
		},
	}
}

func (e *CharacterEquipment) syncVisibleArmor() {
	e.VisibleArmor = VisibleArmor{
		Helmet:    e.Helmet,
		Chest:     e.Chest,
		Pants:     e.Pants,
		Shoes:     e.Shoes,
		Shoulders: e.Shoulders,
	}
}

func newCharacter(name string) Character {
	now := time.Now().UTC()
	equipment := defaultCharacterEquipment()
	return Character{
		ID:         "char-" + randomHex(8),
		Name:       strings.TrimSpace(name),
		Version:    1,
		Stats:      defaultCharacterStats(),
		Inventory:  ItemContainer{Items: []ItemStack{}},
		Warehouse:  ItemContainer{Items: []ItemStack{}},
		Position:   defaultCharacterPosition(),
		Equipment:  equipment,
		Appearance: defaultCharacterAppearance(),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}

func validateCharacterAppearance(appearance CharacterAppearance) error {
	body := appearance.Body

	validations := []struct {
		value int
		min   int
		max   int
	}{
		{body.Height, 42, 58},
		{body.FrontShoulderWidth, 22, 28},
		{body.SideWidth, 10, 16},
		{body.ChestWidth, 14, 28},
		{body.WaistWidth, 10, 26},
		{body.HipWidth, 12, 27},
		{body.TorsoHeight, 14, 26},
		{body.UpperArmWidth, 2, 8},
		{body.UpperArmLength, 6, 18},
		{body.ForearmWidth, 2, 7},
		{body.ForearmLength, 5, 17},
		{body.ThighWidth, 3, 9},
		{body.ThighLength, 7, 20},
		{body.CalfWidth, 2, 8},
		{body.CalfLength, 6, 19},
		{body.ChestDepth, 7, 16},
		{body.WaistDepth, 6, 15},
		{body.HipDepth, 7, 16},
		{body.HeadScale, 70, 140},
	}
	for _, item := range validations {
		if item.value < item.min || item.value > item.max {
			return ErrCharacterAppearance
		}
	}

	if body.ChestWidth > 28 || body.WaistWidth > 28 || body.HipWidth > 28 {
		return ErrCharacterAppearance
	}
	if body.ChestWidth < 10 || body.WaistWidth < 10 || body.HipWidth < 10 {
		return ErrCharacterAppearance
	}
	if body.ChestDepth > 16 || body.WaistDepth > 16 || body.HipDepth > 16 {
		return ErrCharacterAppearance
	}
	if body.UpperArmWidth+body.ForearmWidth > 28 {
		return ErrCharacterAppearance
	}
	if !validateHexColor(appearance.Palette.SkinPrimary) ||
		!validateHexColor(appearance.Palette.SkinShadow) ||
		!validateHexColor(appearance.Palette.HairPrimary) ||
		!validateHexColor(appearance.Palette.HairShadow) ||
		!validateHexColor(appearance.Palette.ClothPrimary) ||
		!validateHexColor(appearance.Palette.ClothShadow) ||
		!validateHexColor(appearance.Palette.MetalPrimary) ||
		!validateHexColor(appearance.Palette.MetalShadow) {
		return ErrCharacterAppearance
	}
	if !validateHairLayer(appearance.Hair.Front) ||
		!validateHairLayer(appearance.Hair.Back) ||
		!validateHairLayer(appearance.Hair.Left) ||
		!validateHairLayer(appearance.Hair.Right) ||
		!validateHairLayer(appearance.Hair.FrontFg) ||
		!validateHairLayer(appearance.Hair.BackFg) ||
		!validateHairLayer(appearance.Hair.LeftFg) ||
		!validateHairLayer(appearance.Hair.RightFg) {
		return ErrCharacterAppearance
	}

	return nil
}

func validateHexColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, ch := range value[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", ch) {
			return false
		}
	}
	return true
}

func validateHairLayer(rows []string) bool {
	if len(rows) > 24 {
		return false
	}
	for _, row := range rows {
		if len(row) > 24 {
			return false
		}
		for _, ch := range row {
			if ch != '0' && ch != '1' {
				return false
			}
		}
	}
	return true
}

type memoryAccountStore struct {
	mu         sync.Mutex
	accounts   map[string]Account
	emailIndex map[string]string
	userIndex  map[string]string
	characters map[string][]Character
	sessions   map[string]SessionRecord
	auditLogs  []AuditLogEntry
}

func newMemoryAccountStore() *memoryAccountStore {
	return &memoryAccountStore{
		accounts:   make(map[string]Account),
		emailIndex: make(map[string]string),
		userIndex:  make(map[string]string),
		characters: make(map[string][]Character),
		sessions:   make(map[string]SessionRecord),
		auditLogs:  make([]AuditLogEntry, 0),
	}
}

func (s *memoryAccountStore) CreateAccount(_ context.Context, email, username, passwordHash string) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	emailKey := normalizeEmail(email)
	if _, exists := s.emailIndex[emailKey]; exists {
		return Account{}, ErrAccountExists
	}

	userKey := normalizeUsername(username)
	if _, exists := s.userIndex[userKey]; exists {
		return Account{}, ErrUsernameTaken
	}

	account := Account{
		ID:           "acct-" + randomHex(8),
		Email:        emailKey,
		Username:     strings.TrimSpace(username),
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().UTC(),
	}

	s.accounts[account.ID] = account
	s.emailIndex[emailKey] = account.ID
	s.userIndex[userKey] = account.ID
	return account, nil
}

func (s *memoryAccountStore) FindAccountByEmail(_ context.Context, email string) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	accountID, ok := s.emailIndex[normalizeEmail(email)]
	if !ok {
		return Account{}, ErrAccountNotFound
	}
	return s.accounts[accountID], nil
}

func (s *memoryAccountStore) Ping(_ context.Context) error {
	return nil
}

func (s *memoryAccountStore) PurgeExpiredDeletedCharacters(_ context.Context, accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeExpiredLocked(accountID, time.Now().UTC())
	return nil
}

func (s *memoryAccountStore) PurgeExpiredDeletedCharactersAll(_ context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	for accountID := range s.characters {
		s.purgeExpiredLocked(accountID, now)
	}
	return nil
}

func (s *memoryAccountStore) ListCharacters(_ context.Context, accountID string) (CharacterRoster, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	s.purgeExpiredLocked(accountID, now)

	roster := CharacterRoster{
		Active:  make([]Character, 0),
		Deleted: make([]Character, 0),
	}

	for _, character := range s.characters[accountID] {
		character.Equipment.syncVisibleArmor()
		if character.DeletedAt == nil {
			roster.Active = append(roster.Active, character)
			continue
		}
		roster.Deleted = append(roster.Deleted, character)
	}

	sort.Slice(roster.Active, func(i, j int) bool {
		return roster.Active[i].CreatedAt.Before(roster.Active[j].CreatedAt)
	})
	sort.Slice(roster.Deleted, func(i, j int) bool {
		return roster.Deleted[i].DeletedAt.Before(*roster.Deleted[j].DeletedAt)
	})

	return roster, nil
}

func (s *memoryAccountStore) CreateCharacter(_ context.Context, accountID, name string) (Character, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	s.purgeExpiredLocked(accountID, now)

	activeCount := 0
	for _, character := range s.characters[accountID] {
		if character.DeletedAt == nil {
			activeCount++
		}
	}
	if activeCount >= maxActiveCharacters {
		return Character{}, ErrCharacterLimitReached
	}

	character := newCharacter(name)
	s.characters[accountID] = append(s.characters[accountID], character)
	return character, nil
}

func (s *memoryAccountStore) SoftDeleteCharacter(_ context.Context, accountID, characterID string) (Character, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	s.purgeExpiredLocked(accountID, now)

	deletedCount := 0
	for _, character := range s.characters[accountID] {
		if character.DeletedAt != nil {
			deletedCount++
		}
	}
	if deletedCount >= maxDeletedCharacters {
		return Character{}, ErrDeletedLimitReached
	}

	characters := s.characters[accountID]
	for i := range characters {
		if characters[i].ID != characterID {
			continue
		}
		if characters[i].DeletedAt != nil {
			return Character{}, ErrCharacterDeleted
		}

		deletedAt := now
		purgeAt := now.Add(deletedRetentionDays * 24 * time.Hour)
		characters[i].DeletedAt = &deletedAt
		characters[i].PurgeAt = &purgeAt
		characters[i].UpdatedAt = now
		characters[i].Equipment.syncVisibleArmor()
		s.characters[accountID] = characters
		return characters[i], nil
	}

	return Character{}, ErrCharacterNotFound
}

func (s *memoryAccountStore) GetCharacter(_ context.Context, accountID, characterID string) (Character, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	s.purgeExpiredLocked(accountID, now)

	for _, character := range s.characters[accountID] {
		if character.ID != characterID {
			continue
		}
		if character.DeletedAt != nil {
			return Character{}, ErrCharacterDeleted
		}
		character.Equipment.syncVisibleArmor()
		return character, nil
	}
	return Character{}, ErrCharacterNotFound
}

func (s *memoryAccountStore) SaveCharacter(_ context.Context, accountID string, character Character) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	characters := s.characters[accountID]
	for i := range characters {
		if characters[i].ID != character.ID {
			continue
		}
		if characters[i].DeletedAt != nil {
			return ErrCharacterDeleted
		}
		character.Version = characters[i].Version + 1
		character.UpdatedAt = time.Now().UTC()
		characters[i] = character
		s.characters[accountID] = characters
		return nil
	}

	return ErrCharacterNotFound
}

func (s *memoryAccountStore) SaveSession(_ context.Context, session SessionRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[session.Token] = session
	return nil
}

func (s *memoryAccountStore) DeleteSession(_ context.Context, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
	return nil
}

func (s *memoryAccountStore) AppendAuditLog(_ context.Context, entry AuditLogEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry.CreatedAt = time.Now().UTC()
	s.auditLogs = append([]AuditLogEntry{entry}, s.auditLogs...)
	return nil
}

func (s *memoryAccountStore) AdminListAccounts(_ context.Context, limit int) ([]AdminAccountSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if limit <= 0 || limit > 200 {
		limit = 50
	}

	out := make([]AdminAccountSummary, 0, len(s.accounts))
	for _, account := range s.accounts {
		count := 0
		for _, character := range s.characters[account.ID] {
			if character.DeletedAt == nil {
				count++
			}
		}
		out = append(out, AdminAccountSummary{
			ID:                   account.ID,
			Email:                account.Email,
			Username:             account.Username,
			ActiveCharacterCount: count,
			CreatedAt:            account.CreatedAt,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *memoryAccountStore) AdminGetCharacter(_ context.Context, characterID string) (Character, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, characters := range s.characters {
		for _, character := range characters {
			if character.ID == characterID {
				return character, nil
			}
		}
	}
	return Character{}, ErrCharacterNotFound
}

func (s *memoryAccountStore) AdminListCharactersByAccount(_ context.Context, accountID string) ([]Character, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]Character, len(s.characters[accountID]))
	copy(out, s.characters[accountID])
	return out, nil
}

func (s *memoryAccountStore) AdminListAuditLogs(_ context.Context, limit int) ([]AuditLogEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if limit <= 0 || limit > 200 {
		limit = 100
	}

	out := make([]AuditLogEntry, len(s.auditLogs))
	copy(out, s.auditLogs)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *memoryAccountStore) AdminListAuditLogsByTarget(_ context.Context, targetType, targetID string, limit int) ([]AuditLogEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if limit <= 0 || limit > 200 {
		limit = 100
	}

	out := make([]AuditLogEntry, 0, limit)
	for _, entry := range s.auditLogs {
		if entry.TargetType == targetType && entry.TargetID == targetID {
			out = append(out, entry)
		}
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *memoryAccountStore) purgeExpiredLocked(accountID string, now time.Time) {
	characters := s.characters[accountID]
	filtered := characters[:0]
	for _, character := range characters {
		if character.PurgeAt != nil && !character.PurgeAt.After(now) {
			continue
		}
		filtered = append(filtered, character)
	}
	s.characters[accountID] = filtered
}

func mapStoreError(err error) (int, string) {
	switch {
	case err == nil:
		return 0, ""
	case errors.Is(err, ErrAccountExists):
		return 409, err.Error()
	case errors.Is(err, ErrUsernameTaken):
		return 409, err.Error()
	case errors.Is(err, ErrAccountNotFound):
		return 401, ErrAuthenticationFailed.Error()
	case errors.Is(err, ErrAuthenticationFailed):
		return 401, err.Error()
	case errors.Is(err, ErrCharacterLimitReached):
		return 409, fmt.Sprintf("each account can only keep %d active characters", maxActiveCharacters)
	case errors.Is(err, ErrDeletedLimitReached):
		return 409, fmt.Sprintf("each account can only keep %d deleted characters pending purge", maxDeletedCharacters)
	case errors.Is(err, ErrCharacterDeleted):
		return 409, err.Error()
	case errors.Is(err, ErrCharacterNotFound):
		return 404, err.Error()
	case errors.Is(err, ErrCharacterNameMissing),
		errors.Is(err, ErrCharacterNameTooLong),
		errors.Is(err, ErrCharacterNameTooShort),
		errors.Is(err, ErrCharacterAppearance),
		errors.Is(err, ErrEmailMissing),
		errors.Is(err, ErrUsernameMissing),
		errors.Is(err, ErrPasswordMissing),
		errors.Is(err, ErrPasswordConfirmation),
		errors.Is(err, ErrPasswordTooShort),
		errors.Is(err, ErrUsernameTooShort),
		errors.Is(err, ErrUsernameTooLong),
		errors.Is(err, ErrInvalidEmailFormat),
		errors.Is(err, ErrCharacterSelectionEmpty):
		return 400, err.Error()
	default:
		return 500, "internal server error"
	}
}
