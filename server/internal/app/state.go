package app

import (
	"sort"
	"sync"

	"nbld/server/internal/protocol"
)

type sessionState struct {
	PlayerID      string
	AccountID     string
	CharacterID   string
	CharacterName string
	Appearance    CharacterAppearance
	Equipment     CharacterEquipment
	Token         string
	WorldID       string
	MapID         string
	Position      protocol.Position
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
	s.sessions[session.Token] = session
}

func (s *stateStore) getSession(token string) (sessionState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[token]
	return session, ok
}

func (s *stateStore) deleteSession(token string) (sessionState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[token]
	if !ok {
		return sessionState{}, false
	}

	delete(s.sessions, token)
	return session, true
}

func (s *stateStore) updatePosition(token string, position protocol.Position) (sessionState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[token]
	if !ok {
		return session, false
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
	s.sessions[token] = session
	return session, true
}

func (s *stateStore) listWorldPlayers(worldID string) []protocol.WorldPlayer {
	s.mu.RLock()
	defer s.mu.RUnlock()

	players := make([]protocol.WorldPlayer, 0, len(s.sessions))
	for _, session := range s.sessions {
		if session.WorldID != worldID {
			continue
		}

		players = append(players, protocol.WorldPlayer{
			PlayerID:      session.PlayerID,
			CharacterID:   session.CharacterID,
			CharacterName: session.CharacterName,
			MapID:         session.MapID,
			Position:      session.Position,
			Appearance:    toProtocolAppearance(session.Appearance),
			Equipment:     toProtocolEquipment(session.Equipment),
		})
	}

	return players
}

func (s *stateStore) listSessions() []sessionState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]sessionState, 0, len(s.sessions))
	for _, session := range s.sessions {
		out = append(out, session)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Token < out[j].Token
	})
	return out
}

func (s *stateStore) getSessionByPlayerID(playerID string) (sessionState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, session := range s.sessions {
		if session.PlayerID == playerID {
			return session, true
		}
	}

	return sessionState{}, false
}
