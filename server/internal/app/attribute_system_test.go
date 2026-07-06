package app

import "testing"

// TestNormalizeCharacterStatsRoundTripsLegacy verifies that normalizing a stat
// block built only from the legacy Base/Attack/Defense values reproduces those
// same legacy values (via Combat -> legacy), and populates the layered model.
func TestNormalizeCharacterStatsRoundTripsLegacy(t *testing.T) {
	stats := defaultCharacterStats()

	if stats.Level != 1 {
		t.Fatalf("expected level defaulted to 1, got %d", stats.Level)
	}

	// Legacy blocks must be preserved by the round trip.
	if stats.Base.Health != 100 || stats.Base.Mana != 60 || stats.Base.MoveSPD != 5 {
		t.Fatalf("legacy base stats not preserved: %+v", stats.Base)
	}
	if stats.Attack.PhysicalAttack != 10 || stats.Attack.PhysicalCrit != 5 {
		t.Fatalf("legacy attack stats not preserved: %+v", stats.Attack)
	}
	if stats.Defense.PhysicalDefense != 5 {
		t.Fatalf("legacy defense stats not preserved: %+v", stats.Defense)
	}

	// Layered model must be populated and consistent with the legacy values.
	if stats.Combat.Resources.HealthMax != 100 || stats.Combat.Resources.HealthCurrent != 100 {
		t.Fatalf("combat health not derived: %+v", stats.Combat.Resources)
	}
	if stats.Combat.PhysicalAttack != 10 {
		t.Fatalf("combat physical attack not derived: %d", stats.Combat.PhysicalAttack)
	}
	// Legacy crit percent (5) must map to a 0.05 ratio in the combat block.
	if stats.Combat.PhysicalCrit != 0.05 {
		t.Fatalf("expected physical crit ratio 0.05, got %v", stats.Combat.PhysicalCrit)
	}
	if stats.Combat.PowerScore <= 0 {
		t.Fatalf("expected positive power score, got %d", stats.Combat.PowerScore)
	}
	if stats.Metadata.SchemaVersion != attributeSchemaVersion || stats.Metadata.ProfileID != defaultStatProfileID {
		t.Fatalf("unexpected stats metadata: %+v", stats.Metadata)
	}
}

// TestNormalizeIgnoresEquipmentHealth locks in the design rule that equipment
// and passive gems cannot contribute health; the values are dropped and a
// warning is recorded.
func TestNormalizeIgnoresEquipmentHealth(t *testing.T) {
	stats := defaultCharacterStats()
	stats.Sources.Equipment = AttributeValues{
		AttributeHealth:         500,
		AttributePhysicalAttack: 25,
	}

	normalized := NormalizeCharacterStats(stats)

	// Health stays at the base-derived value; the +500 from equipment is ignored.
	if normalized.Combat.Resources.HealthMax != 100 {
		t.Fatalf("equipment health should be ignored, got HealthMax=%d", normalized.Combat.Resources.HealthMax)
	}
	// Non-health equipment stats still apply.
	if normalized.Combat.PhysicalAttack != 35 {
		t.Fatalf("expected physical attack 35 (10 base + 25 equipment), got %d", normalized.Combat.PhysicalAttack)
	}

	var warned bool
	for _, w := range normalized.Metadata.Warnings {
		if w == "equipment health is ignored by design" {
			warned = true
		}
	}
	if !warned {
		t.Fatalf("expected equipment-health warning, got %v", normalized.Metadata.Warnings)
	}
}

// TestRuntimeResourcesFromDefaults verifies the runtime resource snapshot is
// derived from a valid default combat block.
func TestRuntimeResourcesFromDefaults(t *testing.T) {
	res := defaultRuntimeResources()
	if res.HealthMax != 100 || res.HealthCurrent != 100 {
		t.Fatalf("unexpected default runtime health: %+v", res)
	}
	if res.StaminaMax != 100 {
		t.Fatalf("unexpected default runtime stamina max: %d", res.StaminaMax)
	}

	proto := res.toProtocol()
	if proto.HealthMax != 100 || proto.StaminaMax != 100 {
		t.Fatalf("unexpected protocol runtime resources: %+v", proto)
	}
}
