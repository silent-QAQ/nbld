package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type postgresAccountStore struct {
	pool *pgxpool.Pool
}

func newPostgresAccountStore(ctx context.Context, databaseURL string) (*postgresAccountStore, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}

	store := &postgresAccountStore{pool: pool}
	if err := store.ensureSchema(ctx); err != nil {
		pool.Close()
		return nil, err
	}

	return store, nil
}

func (s *postgresAccountStore) ensureSchema(ctx context.Context) error {
	return runMigrations(ctx, s.pool)
}

func (s *postgresAccountStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *postgresAccountStore) Close() error {
	s.pool.Close()
	return nil
}

func (s *postgresAccountStore) CreateAccount(ctx context.Context, email, username, passwordHash string) (Account, error) {
	account := Account{
		ID:           "acct-" + randomHex(8),
		Email:        normalizeEmail(email),
		Username:     strings.TrimSpace(username),
		PasswordHash: passwordHash,
	}

	err := s.pool.QueryRow(
		ctx,
		`INSERT INTO accounts (id, email, username, username_normalized, password_hash)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING created_at`,
		account.ID,
		account.Email,
		account.Username,
		normalizeUsername(account.Username),
		account.PasswordHash,
	).Scan(&account.CreatedAt)
	if err == nil {
		return account, nil
	}

	if isUniqueViolation(err, "accounts_email_key") {
		return Account{}, ErrAccountExists
	}
	if isUniqueViolation(err, "accounts_username_normalized_key") {
		return Account{}, ErrUsernameTaken
	}
	return Account{}, err
}

func (s *postgresAccountStore) FindAccountByEmail(ctx context.Context, email string) (Account, error) {
	var account Account
	err := s.pool.QueryRow(
		ctx,
		`SELECT id, email, username, password_hash, created_at
		 FROM accounts
		 WHERE email = $1`,
		normalizeEmail(email),
	).Scan(&account.ID, &account.Email, &account.Username, &account.PasswordHash, &account.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, ErrAccountNotFound
	}
	return account, err
}

func (s *postgresAccountStore) PurgeExpiredDeletedCharacters(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(
		ctx,
		`DELETE FROM characters
		 WHERE account_id = $1
		   AND deleted_at IS NOT NULL
		   AND purge_at <= NOW()`,
		accountID,
	)
	return err
}

func (s *postgresAccountStore) PurgeExpiredDeletedCharactersAll(ctx context.Context) error {
	_, err := s.pool.Exec(
		ctx,
		`DELETE FROM characters
		 WHERE deleted_at IS NOT NULL
		   AND purge_at <= NOW()`,
	)
	return err
}

func (s *postgresAccountStore) ListCharacters(ctx context.Context, accountID string) (CharacterRoster, error) {
	if err := s.PurgeExpiredDeletedCharacters(ctx, accountID); err != nil {
		return CharacterRoster{}, err
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT id, name, version, stats, inventory, warehouse, position, equipment, appearance, deleted_at, purge_at, created_at, updated_at
		 FROM characters
		 WHERE account_id = $1
		 ORDER BY created_at ASC`,
		accountID,
	)
	if err != nil {
		return CharacterRoster{}, err
	}
	defer rows.Close()

	roster := CharacterRoster{
		Active:  make([]Character, 0),
		Deleted: make([]Character, 0),
	}

	for rows.Next() {
		character, err := scanCharacter(rows)
		if err != nil {
			return CharacterRoster{}, err
		}
		if character.DeletedAt == nil {
			roster.Active = append(roster.Active, character)
			continue
		}
		roster.Deleted = append(roster.Deleted, character)
	}

	return roster, rows.Err()
}

func (s *postgresAccountStore) CreateCharacter(ctx context.Context, accountID, name string) (Character, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Character{}, err
	}
	defer tx.Rollback(ctx)

	var lockedAccountID string
	if err := tx.QueryRow(ctx, `SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&lockedAccountID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Character{}, ErrAccountNotFound
		}
		return Character{}, err
	}

	if _, err := tx.Exec(
		ctx,
		`DELETE FROM characters
		 WHERE account_id = $1
		   AND deleted_at IS NOT NULL
		   AND purge_at <= NOW()`,
		accountID,
	); err != nil {
		return Character{}, err
	}

	var activeCount int
	if err := tx.QueryRow(
		ctx,
		`SELECT COUNT(*) FROM characters WHERE account_id = $1 AND deleted_at IS NULL`,
		accountID,
	).Scan(&activeCount); err != nil {
		return Character{}, err
	}
	if activeCount >= maxActiveCharacters {
		return Character{}, ErrCharacterLimitReached
	}

	character := newCharacter(name)
	stats, err := json.Marshal(character.Stats)
	if err != nil {
		return Character{}, err
	}
	inventory, err := json.Marshal(character.Inventory)
	if err != nil {
		return Character{}, err
	}
	warehouse, err := json.Marshal(character.Warehouse)
	if err != nil {
		return Character{}, err
	}
	position, err := json.Marshal(character.Position)
	if err != nil {
		return Character{}, err
	}
	character.Equipment.syncVisibleArmor()
	equipment, err := json.Marshal(character.Equipment)
	if err != nil {
		return Character{}, err
	}
	appearance, err := json.Marshal(character.Appearance)
	if err != nil {
		return Character{}, err
	}

	err = tx.QueryRow(
		ctx,
		`INSERT INTO characters (
			id, account_id, name, stats, inventory, warehouse, position, equipment, appearance
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING created_at, updated_at`,
		character.ID,
		accountID,
		character.Name,
		stats,
		inventory,
		warehouse,
		position,
		equipment,
		appearance,
	).Scan(&character.CreatedAt, &character.UpdatedAt)
	if err != nil {
		return Character{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Character{}, err
	}
	return character, nil
}

func (s *postgresAccountStore) SoftDeleteCharacter(ctx context.Context, accountID, characterID string) (Character, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Character{}, err
	}
	defer tx.Rollback(ctx)

	var lockedAccountID string
	if err := tx.QueryRow(ctx, `SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&lockedAccountID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Character{}, ErrAccountNotFound
		}
		return Character{}, err
	}

	if _, err := tx.Exec(
		ctx,
		`DELETE FROM characters
		 WHERE account_id = $1
		   AND deleted_at IS NOT NULL
		   AND purge_at <= NOW()`,
		accountID,
	); err != nil {
		return Character{}, err
	}

	var deletedCount int
	if err := tx.QueryRow(
		ctx,
		`SELECT COUNT(*) FROM characters WHERE account_id = $1 AND deleted_at IS NOT NULL`,
		accountID,
	).Scan(&deletedCount); err != nil {
		return Character{}, err
	}
	if deletedCount >= maxDeletedCharacters {
		return Character{}, ErrDeletedLimitReached
	}

	row := tx.QueryRow(
		ctx,
		`UPDATE characters
		 SET deleted_at = NOW(),
		     purge_at = NOW() + INTERVAL '30 days',
		     updated_at = NOW()
		 WHERE account_id = $1
		   AND id = $2
		   AND deleted_at IS NULL
		 RETURNING id, name, version, stats, inventory, warehouse, position, equipment, appearance, deleted_at, purge_at, created_at, updated_at`,
		accountID,
		characterID,
	)
	character, err := scanCharacter(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Character{}, ErrCharacterNotFound
		}
		return Character{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Character{}, err
	}
	return character, nil
}

func (s *postgresAccountStore) GetCharacter(ctx context.Context, accountID, characterID string) (Character, error) {
	if err := s.PurgeExpiredDeletedCharacters(ctx, accountID); err != nil {
		return Character{}, err
	}

	row := s.pool.QueryRow(
		ctx,
		`SELECT id, name, version, stats, inventory, warehouse, position, equipment, appearance, deleted_at, purge_at, created_at, updated_at
		 FROM characters
		 WHERE account_id = $1 AND id = $2`,
		accountID,
		characterID,
	)
	character, err := scanCharacter(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Character{}, ErrCharacterNotFound
		}
		return Character{}, err
	}
	if character.DeletedAt != nil {
		return Character{}, ErrCharacterDeleted
	}
	return character, nil
}

func (s *postgresAccountStore) SaveCharacter(ctx context.Context, accountID string, character Character) error {
	statsData, err := json.Marshal(character.Stats)
	if err != nil {
		return err
	}
	inventoryData, err := json.Marshal(character.Inventory)
	if err != nil {
		return err
	}
	warehouseData, err := json.Marshal(character.Warehouse)
	if err != nil {
		return err
	}
	positionData, err := json.Marshal(character.Position)
	if err != nil {
		return err
	}
	character.Equipment.syncVisibleArmor()
	equipmentData, err := json.Marshal(character.Equipment)
	if err != nil {
		return err
	}
	appearanceData, err := json.Marshal(character.Appearance)
	if err != nil {
		return err
	}

	tag, err := s.pool.Exec(
		ctx,
		`UPDATE characters
		 SET stats = $3,
		     inventory = $4,
		     warehouse = $5,
		     position = $6,
		     equipment = $7,
		     appearance = $8,
		     version = version + 1,
		     updated_at = NOW()
		 WHERE account_id = $1
		   AND id = $2
		   AND deleted_at IS NULL`,
		accountID,
		character.ID,
		statsData,
		inventoryData,
		warehouseData,
		positionData,
		equipmentData,
		appearanceData,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCharacterNotFound
	}
	return nil
}

func (s *postgresAccountStore) SaveSession(ctx context.Context, session SessionRecord) error {
	metadata, err := json.Marshal(session.Metadata)
	if err != nil {
		return err
	}

	_, err = s.pool.Exec(
		ctx,
		`INSERT INTO account_sessions (
			token, account_id, character_id, last_seen_at, expires_at, metadata
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (token) DO UPDATE
		SET account_id = EXCLUDED.account_id,
		    character_id = EXCLUDED.character_id,
		    last_seen_at = EXCLUDED.last_seen_at,
		    expires_at = EXCLUDED.expires_at,
		    metadata = EXCLUDED.metadata`,
		session.Token,
		session.AccountID,
		nullableString(session.CharacterID),
		session.LastSeenAt,
		session.ExpiresAt,
		metadata,
	)
	return err
}

func (s *postgresAccountStore) DeleteSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM account_sessions WHERE token = $1`, token)
	return err
}

func (s *postgresAccountStore) AppendAuditLog(ctx context.Context, entry AuditLogEntry) error {
	payload, err := json.Marshal(entry.Payload)
	if err != nil {
		return err
	}

	_, err = s.pool.Exec(
		ctx,
		`INSERT INTO audit_logs (
			actor_account_id, actor_type, target_type, target_id, action, payload
		) VALUES ($1, $2, $3, $4, $5, $6)`,
		nullableString(entry.ActorAccountID),
		entry.ActorType,
		entry.TargetType,
		entry.TargetID,
		entry.Action,
		payload,
	)
	return err
}

func (s *postgresAccountStore) AdminListAccounts(ctx context.Context, limit int) ([]AdminAccountSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT a.id, a.email, a.username, a.created_at, COUNT(c.id) FILTER (WHERE c.deleted_at IS NULL)
		 FROM accounts a
		 LEFT JOIN characters c ON c.account_id = a.id
		 GROUP BY a.id, a.email, a.username, a.created_at
		 ORDER BY a.created_at DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AdminAccountSummary, 0, limit)
	for rows.Next() {
		var item AdminAccountSummary
		if err := rows.Scan(&item.ID, &item.Email, &item.Username, &item.CreatedAt, &item.ActiveCharacterCount); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *postgresAccountStore) AdminListCharactersByAccount(ctx context.Context, accountID string) ([]Character, error) {
	rows, err := s.pool.Query(
		ctx,
		`SELECT id, name, version, stats, inventory, warehouse, position, equipment, appearance, deleted_at, purge_at, created_at, updated_at
		 FROM characters
		 WHERE account_id = $1
		 ORDER BY created_at ASC`,
		accountID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Character, 0)
	for rows.Next() {
		character, err := scanCharacter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, character)
	}
	return out, rows.Err()
}

func (s *postgresAccountStore) AdminGetCharacter(ctx context.Context, characterID string) (Character, error) {
	row := s.pool.QueryRow(
		ctx,
		`SELECT id, name, version, stats, inventory, warehouse, position, equipment, appearance, deleted_at, purge_at, created_at, updated_at
		 FROM characters
		 WHERE id = $1`,
		characterID,
	)
	character, err := scanCharacter(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Character{}, ErrCharacterNotFound
		}
		return Character{}, err
	}
	return character, nil
}

func (s *postgresAccountStore) AdminListAuditLogs(ctx context.Context, limit int) ([]AuditLogEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT actor_account_id, actor_type, target_type, target_id, action, payload, created_at
		 FROM audit_logs
		 ORDER BY created_at DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AuditLogEntry, 0, limit)
	for rows.Next() {
		var entry AuditLogEntry
		var actorID *string
		var payload []byte
		if err := rows.Scan(&actorID, &entry.ActorType, &entry.TargetType, &entry.TargetID, &entry.Action, &payload, &entry.CreatedAt); err != nil {
			return nil, err
		}
		if actorID != nil {
			entry.ActorAccountID = *actorID
		}
		if err := json.Unmarshal(payload, &entry.Payload); err != nil {
			return nil, fmt.Errorf("decode audit payload: %w", err)
		}
		out = append(out, entry)
	}

	return out, rows.Err()
}

func (s *postgresAccountStore) AdminListAuditLogsByTarget(ctx context.Context, targetType, targetID string, limit int) ([]AuditLogEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT actor_account_id, actor_type, target_type, target_id, action, payload, created_at
		 FROM audit_logs
		 WHERE target_type = $1 AND target_id = $2
		 ORDER BY created_at DESC
		 LIMIT $3`,
		targetType,
		targetID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AuditLogEntry, 0, limit)
	for rows.Next() {
		var entry AuditLogEntry
		var actorID *string
		var payload []byte
		if err := rows.Scan(&actorID, &entry.ActorType, &entry.TargetType, &entry.TargetID, &entry.Action, &payload, &entry.CreatedAt); err != nil {
			return nil, err
		}
		if actorID != nil {
			entry.ActorAccountID = *actorID
		}
		if err := json.Unmarshal(payload, &entry.Payload); err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

type SessionRecord struct {
	Token       string
	AccountID   string
	CharacterID string
	LastSeenAt  time.Time
	ExpiresAt   *time.Time
	Metadata    map[string]any
}

type AuditLogEntry struct {
	ActorAccountID string         `json:"actorAccountId,omitempty"`
	ActorType      string         `json:"actorType"`
	TargetType     string         `json:"targetType"`
	TargetID       string         `json:"targetId"`
	Action         string         `json:"action"`
	Payload        map[string]any `json:"payload"`
	CreatedAt      time.Time      `json:"createdAt"`
}

type AdminAccountSummary struct {
	ID                   string    `json:"id"`
	Email                string    `json:"email"`
	Username             string    `json:"username"`
	ActiveCharacterCount int       `json:"activeCharacterCount"`
	CreatedAt            time.Time `json:"createdAt"`
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

type characterScanner interface {
	Scan(dest ...any) error
}

func scanCharacter(scanner characterScanner) (Character, error) {
	var character Character
	var statsData []byte
	var inventoryData []byte
	var warehouseData []byte
	var positionData []byte
	var equipmentData []byte
	var appearanceData []byte

	err := scanner.Scan(
		&character.ID,
		&character.Name,
		&character.Version,
		&statsData,
		&inventoryData,
		&warehouseData,
		&positionData,
		&equipmentData,
		&appearanceData,
		&character.DeletedAt,
		&character.PurgeAt,
		&character.CreatedAt,
		&character.UpdatedAt,
	)
	if err != nil {
		return Character{}, err
	}

	if err := json.Unmarshal(statsData, &character.Stats); err != nil {
		return Character{}, err
	}
	if err := json.Unmarshal(inventoryData, &character.Inventory); err != nil {
		return Character{}, err
	}
	if err := json.Unmarshal(warehouseData, &character.Warehouse); err != nil {
		return Character{}, err
	}
	if err := json.Unmarshal(positionData, &character.Position); err != nil {
		return Character{}, err
	}
	if err := json.Unmarshal(equipmentData, &character.Equipment); err != nil {
		return Character{}, err
	}
	if err := json.Unmarshal(appearanceData, &character.Appearance); err != nil {
		return Character{}, err
	}
	character.Equipment.syncVisibleArmor()

	return character, nil
}

func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
