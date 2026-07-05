package app

import (
	"math"
	"time"

	"nbld/server/internal/protocol"
)

const (
	sprintStaminaCostPerSecond  = 10
	staminaRegenWhileRunning    = 2
	staminaRegenRecentlyStopped = 4
	staminaRegenRested          = 8
	staminaRecentStopWindow     = 3 * time.Second
)

type runtimeResources struct {
	HealthMax      int
	HealthCurrent  int
	ManaMax        int
	ManaCurrent    int
	StaminaMax     int
	StaminaCurrent float64
}

func defaultRuntimeResources() runtimeResources {
	stats := defaultCharacterStats()
	return runtimeResourcesFromCombat(stats.Combat)
}

func runtimeResourcesFromCombat(combat CharacterCombatStats) runtimeResources {
	staminaMax := maxRuntimeInt(1, combat.Resources.StaminaMax)
	return runtimeResources{
		HealthMax:      maxRuntimeInt(1, combat.Resources.HealthMax),
		HealthCurrent:  clampRuntimeInt(combat.Resources.HealthCurrent, 0, maxRuntimeInt(1, combat.Resources.HealthMax)),
		ManaMax:        maxRuntimeInt(1, combat.Resources.ManaMax),
		ManaCurrent:    clampRuntimeInt(combat.Resources.ManaCurrent, 0, maxRuntimeInt(1, combat.Resources.ManaMax)),
		StaminaMax:     staminaMax,
		StaminaCurrent: clampRuntimeFloat(float64(combat.Resources.StaminaCurrent), 0, float64(staminaMax)),
	}
}

func (r runtimeResources) toProtocol() protocol.RuntimeResources {
	return protocol.RuntimeResources{
		HealthMax:      r.HealthMax,
		HealthCurrent:  clampRuntimeInt(r.HealthCurrent, 0, maxRuntimeInt(1, r.HealthMax)),
		ManaMax:        r.ManaMax,
		ManaCurrent:    clampRuntimeInt(r.ManaCurrent, 0, maxRuntimeInt(1, r.ManaMax)),
		StaminaMax:     r.StaminaMax,
		StaminaCurrent: int(math.Round(clampRuntimeFloat(r.StaminaCurrent, 0, float64(maxRuntimeInt(1, r.StaminaMax))))),
	}
}

func clampRuntimeInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func clampRuntimeFloat(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func maxRuntimeInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
