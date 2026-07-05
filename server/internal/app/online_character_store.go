package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	defaultRedisCharacterTTL = 24 * time.Hour
	defaultFlushInterval     = 5 * time.Second
)

type onlineCharacterStore interface {
	Ping(ctx context.Context) error
	LoadCharacter(ctx context.Context, accountID, characterID string) (Character, bool, error)
	StoreCharacter(ctx context.Context, accountID string, character Character) error
	UpdateCharacter(ctx context.Context, accountID, characterID string, mutate func(*Character) error) (Character, error)
	MarkDirty(ctx context.Context, accountID, characterID string) error
	RemoveCharacter(ctx context.Context, accountID, characterID string) error
	FlushDirty(ctx context.Context, sink accountStore) error
	Close() error
}

type memoryOnlineCharacterStore struct {
	mu         sync.Mutex
	characters map[string]Character
	dirty      map[string]struct{}
}

func newMemoryOnlineCharacterStore() *memoryOnlineCharacterStore {
	return &memoryOnlineCharacterStore{
		characters: make(map[string]Character),
		dirty:      make(map[string]struct{}),
	}
}

func (s *memoryOnlineCharacterStore) LoadCharacter(_ context.Context, accountID, characterID string) (Character, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := onlineCharacterKey(accountID, characterID)
	character, ok := s.characters[key]
	return character, ok, nil
}

func (s *memoryOnlineCharacterStore) Ping(_ context.Context) error {
	return nil
}

func (s *memoryOnlineCharacterStore) StoreCharacter(_ context.Context, accountID string, character Character) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := onlineCharacterKey(accountID, character.ID)
	character.Stats = NormalizeCharacterStats(character.Stats)
	s.characters[key] = character
	return nil
}

func (s *memoryOnlineCharacterStore) UpdateCharacter(_ context.Context, accountID, characterID string, mutate func(*Character) error) (Character, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := onlineCharacterKey(accountID, characterID)
	character, ok := s.characters[key]
	if !ok {
		return Character{}, ErrCharacterNotFound
	}
	if err := mutate(&character); err != nil {
		return Character{}, err
	}
	character.Stats = NormalizeCharacterStats(character.Stats)
	character.Version++
	character.UpdatedAt = time.Now().UTC()
	s.characters[key] = character
	s.dirty[key] = struct{}{}
	return character, nil
}

func (s *memoryOnlineCharacterStore) MarkDirty(_ context.Context, accountID, characterID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.dirty[onlineCharacterKey(accountID, characterID)] = struct{}{}
	return nil
}

func (s *memoryOnlineCharacterStore) RemoveCharacter(_ context.Context, accountID, characterID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := onlineCharacterKey(accountID, characterID)
	delete(s.characters, key)
	delete(s.dirty, key)
	return nil
}

func (s *memoryOnlineCharacterStore) FlushDirty(ctx context.Context, sink accountStore) error {
	s.mu.Lock()
	pending := make([]struct {
		accountID string
		character Character
		key       string
	}, 0, len(s.dirty))
	for key := range s.dirty {
		accountID, characterID, err := splitOnlineCharacterKey(key)
		if err != nil {
			continue
		}
		character, ok := s.characters[key]
		if !ok {
			delete(s.dirty, key)
			continue
		}
		pending = append(pending, struct {
			accountID string
			character Character
			key       string
		}{
			accountID: accountID,
			character: character,
			key:       onlineCharacterKey(accountID, characterID),
		})
	}
	s.mu.Unlock()

	for _, item := range pending {
		if err := sink.SaveCharacter(ctx, item.accountID, item.character); err != nil {
			return err
		}

		s.mu.Lock()
		delete(s.dirty, item.key)
		s.mu.Unlock()
	}

	return nil
}

func (s *memoryOnlineCharacterStore) Close() error {
	return nil
}

type redisOnlineCharacterStore struct {
	client        *redis.Client
	ttl           time.Duration
	flushInterval time.Duration
}

func newRedisOnlineCharacterStore(redisURL string) (*redisOnlineCharacterStore, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}

	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}

	return &redisOnlineCharacterStore{
		client:        client,
		ttl:           defaultRedisCharacterTTL,
		flushInterval: defaultFlushInterval,
	}, nil
}

func (s *redisOnlineCharacterStore) LoadCharacter(ctx context.Context, accountID, characterID string) (Character, bool, error) {
	payload, err := s.client.Get(ctx, redisCharacterPayloadKey(accountID, characterID)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return Character{}, false, nil
		}
		return Character{}, false, err
	}

	var character Character
	if err := json.Unmarshal(payload, &character); err != nil {
		return Character{}, false, err
	}
	character.Stats = NormalizeCharacterStats(character.Stats)
	character.Equipment.syncVisibleArmor()
	return character, true, nil
}

func (s *redisOnlineCharacterStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *redisOnlineCharacterStore) StoreCharacter(ctx context.Context, accountID string, character Character) error {
	character.Stats = NormalizeCharacterStats(character.Stats)
	payload, err := json.Marshal(character)
	if err != nil {
		return err
	}

	pipe := s.client.TxPipeline()
	pipe.Set(ctx, redisCharacterPayloadKey(accountID, character.ID), payload, s.ttl)
	pipe.SAdd(ctx, redisAccountCharactersKey(accountID), character.ID)
	pipe.Expire(ctx, redisAccountCharactersKey(accountID), s.ttl)
	_, err = pipe.Exec(ctx)
	return err
}

func (s *redisOnlineCharacterStore) UpdateCharacter(ctx context.Context, accountID, characterID string, mutate func(*Character) error) (Character, error) {
	key := redisCharacterPayloadKey(accountID, characterID)

	for attempts := 0; attempts < 5; attempts++ {
		err := s.client.Watch(ctx, func(tx *redis.Tx) error {
			payload, err := tx.Get(ctx, key).Bytes()
			if err != nil {
				if errors.Is(err, redis.Nil) {
					return ErrCharacterNotFound
				}
				return err
			}

			var character Character
			if err := json.Unmarshal(payload, &character); err != nil {
				return err
			}
			if err := mutate(&character); err != nil {
				return err
			}
			character.Stats = NormalizeCharacterStats(character.Stats)
			character.Version++
			character.UpdatedAt = time.Now().UTC()
			character.Equipment.syncVisibleArmor()

			updatedPayload, err := json.Marshal(character)
			if err != nil {
				return err
			}

			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, key, updatedPayload, s.ttl)
				pipe.SAdd(ctx, redisAccountCharactersKey(accountID), characterID)
				pipe.Expire(ctx, redisAccountCharactersKey(accountID), s.ttl)
				pipe.SAdd(ctx, redisDirtyCharactersKey(), onlineCharacterKey(accountID, characterID))
				pipe.Expire(ctx, redisDirtyCharactersKey(), s.ttl)
				return nil
			})
			if err != nil {
				return err
			}

			return redis.NewStringResult(string(updatedPayload), nil).Err()
		}, key)
		if err == nil {
			character, _, loadErr := s.LoadCharacter(ctx, accountID, characterID)
			return character, loadErr
		}
		if err == redis.TxFailedErr {
			continue
		}
		return Character{}, err
	}

	return Character{}, errors.New("failed to update character due to concurrent modifications")
}

func (s *redisOnlineCharacterStore) MarkDirty(ctx context.Context, accountID, characterID string) error {
	pipe := s.client.TxPipeline()
	pipe.SAdd(ctx, redisDirtyCharactersKey(), onlineCharacterKey(accountID, characterID))
	pipe.Expire(ctx, redisDirtyCharactersKey(), s.ttl)
	_, err := pipe.Exec(ctx)
	return err
}

func (s *redisOnlineCharacterStore) RemoveCharacter(ctx context.Context, accountID, characterID string) error {
	pipe := s.client.TxPipeline()
	pipe.Del(ctx, redisCharacterPayloadKey(accountID, characterID))
	pipe.SRem(ctx, redisAccountCharactersKey(accountID), characterID)
	pipe.SRem(ctx, redisDirtyCharactersKey(), onlineCharacterKey(accountID, characterID))
	_, err := pipe.Exec(ctx)
	return err
}

func (s *redisOnlineCharacterStore) FlushDirty(ctx context.Context, sink accountStore) error {
	keys, err := s.client.SMembers(ctx, redisDirtyCharactersKey()).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil
		}
		return err
	}

	for _, key := range keys {
		accountID, characterID, err := splitOnlineCharacterKey(key)
		if err != nil {
			continue
		}

		character, ok, err := s.LoadCharacter(ctx, accountID, characterID)
		if err != nil {
			return err
		}
		if !ok {
			if err := s.client.SRem(ctx, redisDirtyCharactersKey(), key).Err(); err != nil {
				return err
			}
			continue
		}

		if err := sink.SaveCharacter(ctx, accountID, character); err != nil {
			return err
		}

		if err := s.client.SRem(ctx, redisDirtyCharactersKey(), key).Err(); err != nil {
			return err
		}
	}

	return nil
}

func (s *redisOnlineCharacterStore) Close() error {
	return s.client.Close()
}

type onlineCharacterSync struct {
	store    onlineCharacterStore
	sink     accountStore
	interval time.Duration
	stop     chan struct{}
	done     chan struct{}
}

func newOnlineCharacterSync(store onlineCharacterStore, sink accountStore, interval time.Duration) *onlineCharacterSync {
	if interval <= 0 {
		interval = defaultFlushInterval
	}
	return &onlineCharacterSync{
		store:    store,
		sink:     sink,
		interval: interval,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

func (s *onlineCharacterSync) Start() {
	go func() {
		defer close(s.done)

		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()

		for {
			select {
			case <-s.stop:
				s.flushNow()
				return
			case <-ticker.C:
				s.flushNow()
			}
		}
	}()
}

func (s *onlineCharacterSync) Stop() {
	close(s.stop)
	<-s.done
}

func (s *onlineCharacterSync) flushNow() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.store.FlushDirty(ctx, s.sink); err != nil {
		log.Printf("flush online characters failed: %v", err)
	}
}

type combinedCloser struct {
	closers []io.Closer
}

func (c *combinedCloser) Close() error {
	var firstErr error
	for _, closer := range c.closers {
		if closer == nil {
			continue
		}
		if err := closer.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func buildOnlineCharacterStore() (onlineCharacterStore, io.Closer, bool) {
	redisURL := os.Getenv("NBLD_REDIS_URL")
	if redisURL == "" {
		store := newMemoryOnlineCharacterStore()
		return store, store, false
	}

	store, err := newRedisOnlineCharacterStore(redisURL)
	if err != nil {
		log.Printf("redis unavailable, fallback to memory online store: %v", err)
		memory := newMemoryOnlineCharacterStore()
		return memory, memory, false
	}

	return store, store, true
}

func onlineCharacterKey(accountID, characterID string) string {
	return accountID + ":" + characterID
}

func splitOnlineCharacterKey(key string) (string, string, error) {
	for i := 0; i < len(key); i++ {
		if key[i] == ':' {
			return key[:i], key[i+1:], nil
		}
	}
	return "", "", errors.New("invalid online character key")
}

func redisCharacterPayloadKey(accountID, characterID string) string {
	return "nbld:character:" + accountID + ":" + characterID
}

func redisAccountCharactersKey(accountID string) string {
	return "nbld:account:characters:" + accountID
}

func redisDirtyCharactersKey() string {
	return "nbld:characters:dirty"
}
