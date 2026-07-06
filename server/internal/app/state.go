package app

import (
	"sort"
	"sync"
	"time"

	"nbld/server/internal/protocol"
)

type sessionState struct {
	PlayerID          string
	AccountID         string
	CharacterID       string
	CharacterName     string
	Appearance        CharacterAppearance
	Equipment         CharacterEquipment
	Token             string
	WorldID           string
	MapID             string
	Position          protocol.Position
	Facing            string
	Resources         runtimeResources
	Sprinting         bool
	ResourceAt        time.Time
	SprintEndedAt     time.Time
	SprintIntentUntil time.Time
	// LastHarvestAt 服务端节流：上次采集完成时间，防止无视挖掘时长刷请求。
	LastHarvestAt time.Time
}

type stateStore struct {
	mu       sync.RWMutex
	sessions map[string]sessionState
}

func newStateStore() *stateStore {
	return &stateStore{
		sessions: make(map[string]sessionState),
	}
}

func (s *stateStore) putSession(session sessionState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session.ensureRuntimeResources(time.Now().UTC())
	s.sessions[session.Token] = session
}

func (s *stateStore) getSession(token string) (sessionState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[token]
	if ok {
		session.advanceRuntimeResources(time.Now().UTC(), session.Sprinting)
		s.sessions[token] = session
	}
	return session, ok
}

// syncCharacterLoadout 在装备/属性变更后刷新在线会话：
// 更新装备外观与资源上限，当前值按新上限截断（比例保留已在角色数据层完成）。
func (s *stateStore) syncCharacterLoadout(token string, equipment CharacterEquipment, combat CharacterCombatStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[token]
	if !ok {
		return
	}
	now := time.Now().UTC()
	session.advanceRuntimeResources(now, session.Sprinting)
	session.Equipment = equipment
	session.Resources.HealthMax = maxRuntimeInt(1, combat.Resources.HealthMax)
	session.Resources.ManaMax = maxRuntimeInt(1, combat.Resources.ManaMax)
	session.Resources.StaminaMax = maxRuntimeInt(1, combat.Resources.StaminaMax)
	session.Resources.HealthCurrent = clampRuntimeInt(combat.Resources.HealthCurrent, 0, session.Resources.HealthMax)
	session.Resources.ManaCurrent = clampRuntimeInt(combat.Resources.ManaCurrent, 0, session.Resources.ManaMax)
	session.Resources.StaminaCurrent = clampRuntimeFloat(session.Resources.StaminaCurrent, 0, float64(session.Resources.StaminaMax))
	s.sessions[token] = session
}

func (s *stateStore) deleteSession(token string) (sessionState, bool) {	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[token]
	if !ok {
		return sessionState{}, false
	}

	delete(s.sessions, token)
	return session, true
}

// markHarvest 尝试记录一次采集：若距上次采集不足 minInterval 则拒绝（防刷）。
func (s *stateStore) markHarvest(token string, minInterval time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[token]
	if !ok {
		return false
	}
	now := time.Now().UTC()
	if !session.LastHarvestAt.IsZero() && now.Sub(session.LastHarvestAt) < minInterval {
		return false
	}
	session.LastHarvestAt = now
	s.sessions[token] = session
	return true
}

func (s *stateStore) updateMovement(token string, position protocol.Position, sprinting bool, facing string) (sessionState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[token]
	if !ok {
		return session, false
	}

	now := time.Now().UTC()
	session.advanceRuntimeResources(now, session.Sprinting)
	if facing != "" {
		session.Facing = facing
	}
	wasSprinting := session.Sprinting
	if sprinting && session.Resources.StaminaCurrent > 0 {
		session.Sprinting = true
		session.SprintIntentUntil = now.Add(750 * time.Millisecond)
	} else {
		if wasSprinting {
			session.SprintEndedAt = now
		}
		session.Sprinting = false
		session.SprintIntentUntil = time.Time{}
	}
	session.Position = position
	s.sessions[token] = session
	return session, true
}

func (s *stateStore) updateWorldLocation(token, worldID, mapID string, position protocol.Position) (sessionState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[token]
	if !ok {
		return session, false
	}

	session.WorldID = worldID
	session.MapID = mapID
	session.Position = position
	session.advanceRuntimeResources(time.Now().UTC(), session.Sprinting)
	s.sessions[token] = session
	return session, true
}

func (s *stateStore) listNearbyWorldPlayers(worldID, mapID string, position protocol.Position) []protocol.WorldPlayer {
	s.mu.Lock()
	defer s.mu.Unlock()

	players := make([]protocol.WorldPlayer, 0, len(s.sessions))
	now := time.Now().UTC()
	for token, session := range s.sessions {
		session.advanceRuntimeResources(now, session.Sprinting)
		s.sessions[token] = session
		if session.WorldID != worldID {
			continue
		}
		if session.MapID != mapID || !positionsInAOI(session.Position, position) {
			continue
		}

		players = append(players, protocol.WorldPlayer{
			PlayerID:      session.PlayerID,
			CharacterID:   session.CharacterID,
			CharacterName: session.CharacterName,
			MapID:         session.MapID,
			Position:      session.Position,
			Facing:        session.Facing,
			Resources:     session.Resources.toProtocol(),
			Sprinting:     session.Sprinting,
			Appearance:    toProtocolAppearance(session.Appearance),
			Equipment:     toProtocolEquipment(session.Equipment),
		})
	}

	return players
}

// worldPlayerSnapshot holds one player's data prepared once per tick, so the
// snapshot builder can reuse it for every viewer without re-reading state.
type worldPlayerSnapshot struct {
	full protocol.WorldPlayer // complete data for AOI "entered" events
	slim protocol.SlimPlayerState
}

// snapshotWorld captures every live session once, bucketed by world+map, so the
// per-tick snapshot builder can scan only same-map peers. It advances runtime
// resources so stamina in the slim payload is current.
func (s *stateStore) snapshotWorld() map[string][]worldPlayerSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	buckets := make(map[string][]worldPlayerSnapshot, len(s.sessions))
	now := time.Now().UTC()
	for token, session := range s.sessions {
		session.advanceRuntimeResources(now, session.Sprinting)
		s.sessions[token] = session
		if session.WorldID == "" || session.PlayerID == "" {
			continue
		}
		stamina := session.Resources.roundedStamina()
		full := protocol.WorldPlayer{
			PlayerID:      session.PlayerID,
			CharacterID:   session.CharacterID,
			CharacterName: session.CharacterName,
			MapID:         session.MapID,
			Position:      session.Position,
			Facing:        session.Facing,
			Resources:     session.Resources.toProtocol(),
			Sprinting:     session.Sprinting,
			Appearance:    toProtocolAppearance(session.Appearance),
			Equipment:     toProtocolEquipment(session.Equipment),
		}
		slim := protocol.SlimPlayerState{
			PlayerID:       session.PlayerID,
			MapID:          session.MapID,
			Position:       session.Position,
			Facing:         session.Facing,
			Sprinting:      session.Sprinting,
			StaminaCurrent: stamina,
		}
		key := session.WorldID + "\x00" + session.MapID
		buckets[key] = append(buckets[key], worldPlayerSnapshot{full: full, slim: slim})
	}
	return buckets
}

func snapshotBucketKey(worldID, mapID string) string {
	return worldID + "\x00" + mapID
}

func (s *stateStore) listSessions() []sessionState {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]sessionState, 0, len(s.sessions))
	now := time.Now().UTC()
	for token, session := range s.sessions {
		session.advanceRuntimeResources(now, session.Sprinting)
		s.sessions[token] = session
		out = append(out, session)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Token < out[j].Token
	})
	return out
}

func (s *stateStore) getSessionByPlayerID(playerID string) (sessionState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	for token, session := range s.sessions {
		session.advanceRuntimeResources(now, session.Sprinting)
		s.sessions[token] = session
		if session.PlayerID == playerID {
			return session, true
		}
	}

	return sessionState{}, false
}

func (s *sessionState) ensureRuntimeResources(now time.Time) {
	if s.Resources.StaminaMax <= 0 {
		s.Resources = defaultRuntimeResources()
	}
	if s.ResourceAt.IsZero() {
		s.ResourceAt = now
	}
	if s.SprintEndedAt.IsZero() {
		s.SprintEndedAt = now.Add(-staminaRecentStopWindow)
	}
	s.Resources.StaminaMax = maxRuntimeInt(1, s.Resources.StaminaMax)
	s.Resources.StaminaCurrent = clampRuntimeFloat(s.Resources.StaminaCurrent, 0, float64(s.Resources.StaminaMax))
}

func (s *sessionState) advanceRuntimeResources(now time.Time, wantsSprint bool) {
	s.ensureRuntimeResources(now)
	if now.Before(s.ResourceAt) {
		s.ResourceAt = now
		return
	}

	if wantsSprint && !s.SprintIntentUntil.IsZero() && now.After(s.SprintIntentUntil) {
		expiresAt := s.SprintIntentUntil
		if expiresAt.After(s.ResourceAt) {
			s.advanceRuntimeResources(expiresAt, true)
		}
		if s.Sprinting {
			s.SprintEndedAt = expiresAt
		}
		s.Sprinting = false
		s.SprintIntentUntil = time.Time{}
		s.advanceRuntimeResources(now, false)
		return
	}

	elapsed := now.Sub(s.ResourceAt).Seconds()
	if elapsed <= 0 {
		s.Sprinting = wantsSprint && s.Resources.StaminaCurrent > 0
		return
	}

	wasSprinting := s.Sprinting
	canSprint := wantsSprint && s.Resources.StaminaCurrent > 0
	if canSprint {
		s.Resources.StaminaCurrent += (staminaRegenWhileRunning - sprintStaminaCostPerSecond) * elapsed
		s.Resources.StaminaCurrent = clampRuntimeFloat(s.Resources.StaminaCurrent, 0, float64(s.Resources.StaminaMax))
		s.Sprinting = s.Resources.StaminaCurrent > 0
		if !s.Sprinting {
			s.SprintEndedAt = now
		}
	} else {
		if wasSprinting {
			s.SprintEndedAt = now
		}
		s.Sprinting = false
		regen := float64(staminaRegenRested)
		if now.Sub(s.SprintEndedAt) <= staminaRecentStopWindow {
			regen = float64(staminaRegenRecentlyStopped)
		}
		s.Resources.StaminaCurrent += regen * elapsed
		s.Resources.StaminaCurrent = clampRuntimeFloat(s.Resources.StaminaCurrent, 0, float64(s.Resources.StaminaMax))
	}

	s.ResourceAt = now
}
