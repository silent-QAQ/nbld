ALTER TABLE characters
ADD COLUMN IF NOT EXISTS appearance JSONB NOT NULL DEFAULT '{"body":{"height":50,"frontShoulderWidth":24,"sideWidth":12,"chestWidth":20,"waistWidth":16,"hipWidth":20,"torsoHeight":20,"upperArmWidth":4,"upperArmLength":11,"forearmWidth":4,"forearmLength":10,"thighWidth":5,"thighLength":12,"calfWidth":4,"calfLength":11,"chestDepth":10,"waistDepth":9,"hipDepth":10}}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_characters_appearance_gin
    ON characters
    USING GIN (appearance);
