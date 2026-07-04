CREATE INDEX IF NOT EXISTS idx_characters_position_world_map
    ON characters (
        (position->>'worldId'),
        (position->>'mapId')
    )
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_characters_stats_health
    ON characters (((stats->'base'->>'health')::int))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_characters_stats_move_speed
    ON characters (((stats->'base'->>'moveSpeed')::int))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_characters_equipment_main_hand
    ON characters ((equipment->>'mainHand'))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_characters_equipment_visible_helmet
    ON characters ((equipment->'visibleArmor'->>'helmet'))
    WHERE deleted_at IS NULL;
