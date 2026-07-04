package app

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed sql/schema.sql
var postgresSchema string

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
	_, err := s.pool.Exec(ctx, postgresSchema)
	return err
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

func (s *postgresAccountStore) ListCharacters(ctx context.Context, accountID string) (CharacterRoster, error) {
	if err := s.PurgeExpiredDeletedCharacters(ctx, accountID); err != nil {
		return CharacterRoster{}, err
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT id, name, stats, inventory, warehouse, position, equipment, deleted_at, purge_at, created_at, updated_at
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

	err = tx.QueryRow(
		ctx,
		`INSERT INTO characters (
			id, account_id, name, stats, inventory, warehouse, position, equipment
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING created_at, updated_at`,
		character.ID,
		accountID,
		character.Name,
		stats,
		inventory,
		warehouse,
		position,
		equipment,
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
		 RETURNING id, name, stats, inventory, warehouse, position, equipment, deleted_at, purge_at, created_at, updated_at`,
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
		`SELECT id, name, stats, inventory, warehouse, position, equipment, deleted_at, purge_at, created_at, updated_at
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

	tag, err := s.pool.Exec(
		ctx,
		`UPDATE characters
		 SET stats = $3,
		     inventory = $4,
		     warehouse = $5,
		     position = $6,
		     equipment = $7,
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
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCharacterNotFound
	}
	return nil
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

	err := scanner.Scan(
		&character.ID,
		&character.Name,
		&statsData,
		&inventoryData,
		&warehouseData,
		&positionData,
		&equipmentData,
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
