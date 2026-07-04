package app

import (
	"sync"

	"nbld/server/internal/protocol"
)

type eventHub struct {
	mu          sync.RWMutex
	nextID      int
	subscribers map[int]chan protocol.WorldEvent
}

func newEventHub() *eventHub {
	return &eventHub{
		subscribers: make(map[int]chan protocol.WorldEvent),
	}
}

func (h *eventHub) subscribe() (int, <-chan protocol.WorldEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.nextID++
	ch := make(chan protocol.WorldEvent, 16)
	h.subscribers[h.nextID] = ch
	return h.nextID, ch
}

func (h *eventHub) unsubscribe(id int) {
	h.mu.Lock()
	defer h.mu.Unlock()

	ch, ok := h.subscribers[id]
	if !ok {
		return
	}

	delete(h.subscribers, id)
	close(ch)
}

func (h *eventHub) broadcast(event protocol.WorldEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, ch := range h.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}
