package app

import (
	"context"
	_ "embed"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed sql/migrations/001_init.sql
var migration001 string

//go:embed sql/migrations/002_sessions_and_audit.sql
var migration002 string

//go:embed sql/migrations/003_character_json_indexes.sql
var migration003 string

//go:embed sql/migrations/004_character_appearance.sql
var migration004 string

type sqlMigration struct {
	Version int
	Name    string
	SQL     string
}

func defaultMigrations() []sqlMigration {
	return []sqlMigration{
		{Version: 1, Name: "init", SQL: migration001},
		{Version: 2, Name: "sessions_and_audit", SQL: migration002},
		{Version: 3, Name: "character_json_indexes", SQL: migration003},
		{Version: 4, Name: "character_appearance", SQL: migration004},
	}
}

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`); err != nil {
		return err
	}

	migrations := defaultMigrations()
	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})

	for _, migration := range migrations {
		var exists bool
		if err := pool.QueryRow(
			ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`,
			migration.Version,
		).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, migration.SQL); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %d (%s): %w", migration.Version, migration.Name, err)
		}
		if _, err := tx.Exec(
			ctx,
			`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
			migration.Version,
			migration.Name,
		); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}

	return nil
}

func normalizeMigrationSQL(sql string) string {
	return strings.TrimSpace(sql)
}
