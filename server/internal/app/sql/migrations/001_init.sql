CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    stats JSONB NOT NULL,
    inventory JSONB NOT NULL,
    warehouse JSONB NOT NULL,
    position JSONB NOT NULL,
    equipment JSONB NOT NULL,
    deleted_at TIMESTAMPTZ NULL,
    purge_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_characters_account_active
    ON characters (account_id, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_characters_account_deleted
    ON characters (account_id, purge_at)
    WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_characters_position_gin
    ON characters
    USING GIN (position);

CREATE INDEX IF NOT EXISTS idx_characters_stats_gin
    ON characters
    USING GIN (stats);

CREATE INDEX IF NOT EXISTS idx_characters_inventory_gin
    ON characters
    USING GIN (inventory);

CREATE INDEX IF NOT EXISTS idx_characters_equipment_gin
    ON characters
    USING GIN (equipment);
