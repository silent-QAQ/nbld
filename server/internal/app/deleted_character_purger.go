package app

import (
	"context"
	"log"
	"time"
)

type deletedCharacterPurger struct {
	store    accountStore
	interval time.Duration
	stop     chan struct{}
	done     chan struct{}
}

func newDeletedCharacterPurger(store accountStore, interval time.Duration) *deletedCharacterPurger {
	if interval <= 0 {
		interval = time.Hour
	}
	return &deletedCharacterPurger{
		store:    store,
		interval: interval,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

func (p *deletedCharacterPurger) Start() {
	go func() {
		defer close(p.done)

		ticker := time.NewTicker(p.interval)
		defer ticker.Stop()

		for {
			select {
			case <-p.stop:
				p.purgeNow()
				return
			case <-ticker.C:
				p.purgeNow()
			}
		}
	}()
}

func (p *deletedCharacterPurger) Stop() {
	close(p.stop)
	<-p.done
}

func (p *deletedCharacterPurger) purgeNow() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := p.store.PurgeExpiredDeletedCharactersAll(ctx); err != nil {
		log.Printf("purge deleted characters failed: %v", err)
	}
}
