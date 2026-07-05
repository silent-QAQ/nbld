package app

import (
	"math"
	"sort"
)

const (
	attributeSchemaVersion = 1
	defaultStatProfileID   = "default_player"
)

const (
	AttributeHealth          = "health"
	AttributeStamina         = "stamina"
	AttributeMana            = "mana"
	AttributeMoveSpeed       = "move_speed"
	AttributePhysicalAttack  = "physical_attack"
	AttributeMagicAttack     = "magic_attack"
	AttributePhysicalDefense = "physical_defense"
	AttributeMagicDefense    = "magic_defense"
	AttributePhysicalCrit    = "physical_crit"
	AttributeMagicCrit       = "magic_crit"
	AttributeCritDamageBonus = "crit_damage_bonus"
	AttributeDamageBonus     = "damage_bonus"
	AttributeExtraDamage     = "extra_damage"
	AttributeCritResist      = "crit_resist"
	AttributeDamageImmunity  = "damage_immunity"
	AttributeExtraImmunity   = "extra_immunity"
	AttributeHealPower       = "heal_power"
	AttributeHealTakenBonus  = "heal_taken_bonus"
)

type AttributeDefinition struct {
	Code          string  `json:"code"`
	DisplayName   string  `json:"displayName"`
	Category      string  `json:"category"`
	ValueKind     string  `json:"valueKind"`
	DefaultValue  float64 `json:"defaultValue"`
	MinValue      float64 `json:"minValue,omitempty"`
	MaxValue      float64 `json:"maxValue,omitempty"`
	ClientVisible bool    `json:"clientVisible"`
	Description   string  `json:"description,omitempty"`
}

var attributeDefinitions = []AttributeDefinition{
	{Code: AttributeHealth, DisplayName: "生命", Category: "base", ValueKind: "flat", DefaultValue: 0, MinValue: 1, ClientVisible: true, Description: "生命上限，仅来自角色、等级、天赋和系统成长。"},
	{Code: AttributeStamina, DisplayName: "耐力", Category: "base", ValueKind: "flat", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeMana, DisplayName: "法力", Category: "base", ValueKind: "flat", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeMoveSpeed, DisplayName: "移速", Category: "base", ValueKind: "flat", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributePhysicalAttack, DisplayName: "物理攻击", Category: "attack", ValueKind: "flat", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeMagicAttack, DisplayName: "法术攻击", Category: "attack", ValueKind: "flat", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributePhysicalDefense, DisplayName: "物理防御", Category: "defense", ValueKind: "flat", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeMagicDefense, DisplayName: "法术防御", Category: "defense", ValueKind: "flat", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributePhysicalCrit, DisplayName: "物理暴击", Category: "attack", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, MaxValue: 1, ClientVisible: true},
	{Code: AttributeMagicCrit, DisplayName: "法术暴击", Category: "attack", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, MaxValue: 1, ClientVisible: true},
	{Code: AttributeCritDamageBonus, DisplayName: "爆伤加成", Category: "attack", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeDamageBonus, DisplayName: "伤害加成", Category: "attack", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeExtraDamage, DisplayName: "追加伤害", Category: "attack", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeCritResist, DisplayName: "暴击抵抗", Category: "defense", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, MaxValue: 1, ClientVisible: true},
	{Code: AttributeDamageImmunity, DisplayName: "伤害免疫", Category: "defense", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, MaxValue: 0.95, ClientVisible: true},
	{Code: AttributeExtraImmunity, DisplayName: "追加免疫", Category: "defense", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, MaxValue: 0.95, ClientVisible: true},
	{Code: AttributeHealPower, DisplayName: "治疗强度", Category: "healing", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, ClientVisible: true},
	{Code: AttributeHealTakenBonus, DisplayName: "受治疗加成", Category: "healing", ValueKind: "ratio", DefaultValue: 0, MinValue: 0, ClientVisible: true},
}

var attributeDefinitionByCode = func() map[string]AttributeDefinition {
	out := make(map[string]AttributeDefinition, len(attributeDefinitions))
	for _, def := range attributeDefinitions {
		out[def.Code] = def
	}
	return out
}()

func NormalizeCharacterStats(stats CharacterStats) CharacterStats {
	if stats.Level <= 0 {
		stats.Level = 1
	}

	stats.Sources = normalizeStatSources(stats)
	stats.Derived = deriveCharacterStats(stats.Sources)
	stats.Combat = combatStatsFromAttributes(stats.Derived.CombatStats)
	stats.Base, stats.Attack, stats.Defense = legacyStatsFromCombat(stats.Combat)
	stats.Metadata = CharacterStatsMeta{
		SchemaVersion: attributeSchemaVersion,
		ProfileID:     defaultStatProfileID,
		AttributeDefs: attributeDefinitions,
		Warnings:      uniqueStrings(stats.Metadata.Warnings),
	}
	stats.Metadata.Warnings = uniqueStrings(append(stats.Metadata.Warnings, validateStatSourceRules(stats.Sources)...))
	return stats
}

func normalizeStatSources(stats CharacterStats) CharacterStatSources {
	sources := stats.Sources
	if len(sources.Base) == 0 {
		sources.Base = legacyStatsToAttributes(stats.Base, stats.Attack, stats.Defense)
	}
	sources.Base = normalizeAttributeValues(sources.Base)
	sources.LevelGrowth = normalizeAttributeValues(sources.LevelGrowth)
	sources.Talent = normalizeAttributeValues(sources.Talent)
	sources.Equipment = normalizeAttributeValues(sources.Equipment)
	sources.PassiveGem = normalizeAttributeValues(sources.PassiveGem)
	sources.Buff = normalizeAttributeValues(sources.Buff)
	sources.System = normalizeAttributeValues(sources.System)
	sources.Manual = normalizeAttributeValues(sources.Manual)
	if sources.EquipmentNote == "" {
		sources.EquipmentNote = "equipment and passive gems must not provide health; invalid health entries are ignored during stat derivation"
	}
	return sources
}

func normalizeAttributeValues(values AttributeValues) AttributeValues {
	out := make(AttributeValues, len(attributeDefinitions))
	for _, def := range attributeDefinitions {
		out[def.Code] = def.DefaultValue
	}
	for code, value := range values {
		if _, ok := attributeDefinitionByCode[code]; !ok || math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		out[code] = roundStatValue(value)
	}
	return out
}

func normalizeFinalAttributeValues(values AttributeValues) AttributeValues {
	out := make(AttributeValues, len(attributeDefinitions))
	for _, def := range attributeDefinitions {
		out[def.Code] = clampAttributeValue(def, values[def.Code])
	}
	return out
}

func clampAttributeValue(def AttributeDefinition, value float64) float64 {
	if value < def.MinValue {
		value = def.MinValue
	}
	if def.MaxValue > def.MinValue && value > def.MaxValue {
		value = def.MaxValue
	}
	return roundStatValue(value)
}

func roundStatValue(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func legacyStatsToAttributes(base BaseStats, attack AttackStats, defense DefenseStats) AttributeValues {
	return AttributeValues{
		AttributeHealth:          float64(base.Health),
		AttributeStamina:         float64(base.Stamina),
		AttributeMana:            float64(base.Mana),
		AttributeMoveSpeed:       float64(base.MoveSPD),
		AttributePhysicalAttack:  float64(attack.PhysicalAttack),
		AttributeMagicAttack:     float64(attack.SpellAttack),
		AttributePhysicalDefense: float64(defense.PhysicalDefense),
		AttributeMagicDefense:    float64(defense.SpellDefense),
		AttributePhysicalCrit:    legacyPercentToRatio(attack.PhysicalCrit),
		AttributeMagicCrit:       legacyPercentToRatio(attack.SpellCrit),
		AttributeCritDamageBonus: legacyPercentToRatio(attack.CritDamageBonus),
		AttributeDamageBonus:     legacyPercentToRatio(attack.DamageBonus),
		AttributeExtraDamage:     legacyPercentToRatio(attack.BonusDamage),
		AttributeCritResist:      legacyPercentToRatio(defense.CritResistance),
		AttributeDamageImmunity:  legacyPercentToRatio(defense.DamageMitigate),
		AttributeExtraImmunity:   legacyPercentToRatio(defense.BonusMitigate),
		AttributeHealPower:       0,
		AttributeHealTakenBonus:  0,
	}
}

func legacyPercentToRatio(value int) float64 {
	if value <= 0 {
		return 0
	}
	return roundStatValue(float64(value) / 100)
}

func deriveCharacterStats(sources CharacterStatSources) CharacterDerivedStats {
	baseStats := copyAttributeValues(sources.Base)
	derivedStats := sumAttributeSources(
		sources.Base,
		sources.LevelGrowth,
		sources.Talent,
		sources.Equipment,
		sources.PassiveGem,
		sources.System,
		sources.Manual,
	)
	combatStats := sumAttributeSources(derivedStats, sources.Buff)

	derivedStats[AttributeHealth] = sources.Base[AttributeHealth] +
		sources.LevelGrowth[AttributeHealth] +
		sources.Talent[AttributeHealth] +
		sources.System[AttributeHealth] +
		sources.Manual[AttributeHealth]
	combatStats[AttributeHealth] = derivedStats[AttributeHealth] + sources.Buff[AttributeHealth]

	return CharacterDerivedStats{
		BaseStats:    normalizeFinalAttributeValues(baseStats),
		DerivedStats: normalizeFinalAttributeValues(derivedStats),
		CombatStats:  normalizeFinalAttributeValues(combatStats),
	}
}

func sumAttributeSources(sources ...AttributeValues) AttributeValues {
	out := make(AttributeValues, len(attributeDefinitions))
	for _, def := range attributeDefinitions {
		var total float64
		for _, source := range sources {
			total += source[def.Code]
		}
		out[def.Code] = clampAttributeValue(def, total)
	}
	return out
}

func copyAttributeValues(values AttributeValues) AttributeValues {
	out := make(AttributeValues, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func combatStatsFromAttributes(values AttributeValues) CharacterCombatStats {
	health := intStat(values[AttributeHealth])
	mana := intStat(values[AttributeMana])
	stamina := intStat(values[AttributeStamina])
	combat := CharacterCombatStats{
		Resources: CharacterResourceStats{
			HealthMax:      health,
			HealthCurrent:  health,
			ManaMax:        mana,
			ManaCurrent:    mana,
			StaminaMax:     stamina,
			StaminaCurrent: stamina,
		},
		PhysicalAttack:  intStat(values[AttributePhysicalAttack]),
		MagicAttack:     intStat(values[AttributeMagicAttack]),
		PhysicalDefense: intStat(values[AttributePhysicalDefense]),
		MagicDefense:    intStat(values[AttributeMagicDefense]),
		MoveSpeed:       roundStatValue(values[AttributeMoveSpeed]),
		PhysicalCrit:    roundStatValue(values[AttributePhysicalCrit]),
		MagicCrit:       roundStatValue(values[AttributeMagicCrit]),
		CritDamageBonus: roundStatValue(values[AttributeCritDamageBonus]),
		DamageBonus:     roundStatValue(values[AttributeDamageBonus]),
		ExtraDamage:     roundStatValue(values[AttributeExtraDamage]),
		CritResist:      roundStatValue(values[AttributeCritResist]),
		DamageImmunity:  roundStatValue(values[AttributeDamageImmunity]),
		ExtraImmunity:   roundStatValue(values[AttributeExtraImmunity]),
		HealPower:       roundStatValue(values[AttributeHealPower]),
		HealTakenBonus:  roundStatValue(values[AttributeHealTakenBonus]),
	}
	combat.PowerScore = calculatePowerScore(combat)
	return combat
}

func intStat(value float64) int {
	return int(math.Round(value))
}

func calculatePowerScore(combat CharacterCombatStats) int {
	offense := combat.PhysicalAttack + combat.MagicAttack
	defense := combat.PhysicalDefense + combat.MagicDefense
	resources := combat.Resources.HealthMax/5 + combat.Resources.ManaMax/10 + combat.Resources.StaminaMax/10
	ratios := int(math.Round(100 * (combat.PhysicalCrit + combat.MagicCrit + combat.DamageBonus + combat.CritDamageBonus + combat.DamageImmunity)))
	return offense*8 + defense*6 + resources + ratios
}

func legacyStatsFromCombat(combat CharacterCombatStats) (BaseStats, AttackStats, DefenseStats) {
	return BaseStats{
			Health:  combat.Resources.HealthMax,
			Stamina: combat.Resources.StaminaMax,
			Mana:    combat.Resources.ManaMax,
			MoveSPD: intStat(combat.MoveSpeed),
		},
		AttackStats{
			PhysicalAttack:  combat.PhysicalAttack,
			SpellAttack:     combat.MagicAttack,
			PhysicalCrit:    ratioToLegacyPercent(combat.PhysicalCrit),
			SpellCrit:       ratioToLegacyPercent(combat.MagicCrit),
			DamageBonus:     ratioToLegacyPercent(combat.DamageBonus),
			CritDamageBonus: ratioToLegacyPercent(combat.CritDamageBonus),
			BonusDamage:     ratioToLegacyPercent(combat.ExtraDamage),
		},
		DefenseStats{
			PhysicalDefense: combat.PhysicalDefense,
			SpellDefense:    combat.MagicDefense,
			CritResistance:  ratioToLegacyPercent(combat.CritResist),
			DamageMitigate:  ratioToLegacyPercent(combat.DamageImmunity),
			BonusMitigate:   ratioToLegacyPercent(combat.ExtraImmunity),
		}
}

func ratioToLegacyPercent(value float64) int {
	return int(math.Round(value * 100))
}

func validateStatSourceRules(sources CharacterStatSources) []string {
	var warnings []string
	if sources.Equipment[AttributeHealth] != 0 {
		warnings = append(warnings, "equipment health is ignored by design")
	}
	if sources.PassiveGem[AttributeHealth] != 0 {
		warnings = append(warnings, "passive gem health is ignored by design")
	}
	return warnings
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
