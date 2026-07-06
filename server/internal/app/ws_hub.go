package app

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"sort"
	"sync"
	"time"

	"nbld/server/internal/protocol"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type wsConn struct {
	netConn net.Conn
	reader  *bufio.Reader
	mu      sync.Mutex
}

type wsFrame struct {
	opcode  byte
	payload []byte
}

type wsClient struct {
	conn     *wsConn
	playerID string
	worldID  string
	mapID    string
	position protocol.Position
	send     chan protocol.WSServerMessage
	// quit is closed by the hub when the connection is torn down. The write
	// loop selects on it so the send channel is never closed while the
	// snapshot ticker might still be doing a non-blocking send into it.
	quit chan struct{}
	// aoi tracks players currently visible to this connection. It is only
	// read/written by the single snapshot-ticker goroutine, so it needs no
	// lock of its own.
	aoi map[string]*aoiEntry
}

// aoiEntry records, per visible peer, the tick we last sent an update and the
// distance tier used, so the LOD scheduler can throttle by tier.
type aoiEntry struct {
	lastSentTick int64
	overflow     bool // beyond the visible-player cap: no appearance/equipment sent
}

type wsHub struct {
	mu      sync.RWMutex
	clients map[*wsClient]struct{}
}

func newWSHub() *wsHub {
	return &wsHub{
		clients: make(map[*wsClient]struct{}),
	}
}

func (h *wsHub) add(client *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[client] = struct{}{}
}

func (h *wsHub) remove(client *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, client)
}

func (h *wsHub) updateLocation(client *wsClient, worldID, mapID string, position protocol.Position) {
	h.mu.Lock()
	defer h.mu.Unlock()
	client.worldID = worldID
	client.mapID = mapID
	client.position = position
}

func (h *wsHub) broadcast(worldID string, message protocol.WSServerMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client.worldID != worldID {
			continue
		}

		select {
		case client.send <- message:
		default:
		}
	}
}

func (h *wsHub) broadcastNearby(worldID, mapID string, position protocol.Position, message protocol.WSServerMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client.worldID != worldID || client.mapID != mapID {
			continue
		}
		if !positionsInAOI(client.position, position) {
			continue
		}

		select {
		case client.send <- message:
		default:
		}
	}
}

func (h *wsHub) broadcastNearbyAny(worldID, mapID string, positions []protocol.Position, message protocol.WSServerMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client.worldID != worldID || client.mapID != mapID {
			continue
		}
		if !clientInAnyAOI(client.position, positions) {
			continue
		}

		select {
		case client.send <- message:
		default:
		}
	}
}

func clientInAnyAOI(clientPosition protocol.Position, positions []protocol.Position) bool {
	for _, position := range positions {
		if positionsInAOI(clientPosition, position) {
			return true
		}
	}
	return false
}

func positionsInAOI(left, right protocol.Position) bool {
	leftChunkX, leftChunkY := worldToChunk(left.X, left.Y)
	rightChunkX, rightChunkY := worldToChunk(right.X, right.Y)
	return absInt(leftChunkX-rightChunkX) <= 1 && absInt(leftChunkY-rightChunkY) <= 1
}

const (
	// snapshotTickInterval is the base cadence; every connection receives at
	// most one coalesced snapshot per tick.
	snapshotTickInterval = 100 * time.Millisecond

	// Network LOD: how many ticks between updates for a peer, by distance.
	// Near peers refresh every tick (~10Hz), mid every 2 ticks (~5Hz), far
	// every 5 ticks (~2Hz). All peers must already be inside the 3x3 chunk AOI.
	lodNearTiles    = 40.0
	lodMidTiles     = 100.0
	lodNearInterval = 1
	lodMidInterval  = 2
	lodFarInterval  = 5

	// visiblePlayerCap bounds how many peers get full/tiered updates per
	// connection. Peers beyond the cap (sorted by distance) are sent as
	// far-tier, base-model-only slim states (no appearance/equipment), so the
	// client renders a default avatar / collision box.
	visiblePlayerCap = 100
)

func tileDistance(left, right protocol.Position) float64 {
	dx := left.X - right.X
	dy := left.Y - right.Y
	return math.Sqrt(dx*dx + dy*dy)
}

// lodInterval returns the tick interval for a peer at the given tile distance.
func lodInterval(distance float64, overflow bool) int64 {
	if overflow {
		return lodFarInterval
	}
	switch {
	case distance <= lodNearTiles:
		return lodNearInterval
	case distance <= lodMidTiles:
		return lodMidInterval
	default:
		return lodFarInterval
	}
}

// viewerSnapshot is a lock-free copy of one connection's addressing info,
// taken under the hub lock so the tick loop can build snapshots without
// holding it.
type viewerSnapshot struct {
	client   *wsClient
	worldID  string
	mapID    string
	position protocol.Position
}

// snapshotViewers copies the current client set for a tick pass.
func (h *wsHub) snapshotViewers() []viewerSnapshot {
	h.mu.RLock()
	defer h.mu.RUnlock()
	viewers := make([]viewerSnapshot, 0, len(h.clients))
	for client := range h.clients {
		viewers = append(viewers, viewerSnapshot{
			client:   client,
			worldID:  client.worldID,
			mapID:    client.mapID,
			position: client.position,
		})
	}
	return viewers
}

// buildSnapshotFor computes the coalesced snapshot message for one viewer given
// the tick number and the pre-bucketed world state. It mutates viewer.aoi to
// reflect the new visibility set. Returns (message, true) when there is
// something to send.
func buildSnapshotFor(viewer viewerSnapshot, tick int64, buckets map[string][]worldPlayerSnapshot) (protocol.WSServerMessage, bool) {
	client := viewer.client
	if client.aoi == nil {
		client.aoi = make(map[string]*aoiEntry)
	}

	bucket := buckets[snapshotBucketKey(viewer.worldID, viewer.mapID)]

	// Candidate peers: same map, inside AOI, excluding self. Sort by distance
	// so the visible cap keeps the closest peers.
	type candidate struct {
		snap     worldPlayerSnapshot
		distance float64
	}
	candidates := make([]candidate, 0, len(bucket))
	for _, peer := range bucket {
		if peer.slim.PlayerID == client.playerID {
			continue
		}
		if !positionsInAOI(viewer.position, peer.slim.Position) {
			continue
		}
		candidates = append(candidates, candidate{snap: peer, distance: tileDistance(viewer.position, peer.slim.Position)})
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].distance < candidates[j].distance
	})

	var entered []protocol.WorldPlayer
	var moved []protocol.SlimPlayerState
	seen := make(map[string]struct{}, len(candidates))

	for index, cand := range candidates {
		playerID := cand.snap.slim.PlayerID
		seen[playerID] = struct{}{}
		overflow := index >= visiblePlayerCap

		entry, known := client.aoi[playerID]
		if !known {
			// First time visible. Overflow peers skip the heavy "entered"
			// payload and fall back to a base-model slim state.
			entry = &aoiEntry{lastSentTick: tick, overflow: overflow}
			client.aoi[playerID] = entry
			if overflow {
				moved = append(moved, baseModelSlim(cand.snap.slim))
			} else {
				entered = append(entered, cand.snap.full)
			}
			continue
		}

		// If a peer crosses the cap boundary, resend the appropriate form.
		if entry.overflow && !overflow {
			entry.overflow = false
			entry.lastSentTick = tick
			entered = append(entered, cand.snap.full)
			continue
		}
		entry.overflow = overflow

		interval := lodInterval(cand.distance, overflow)
		if tick-entry.lastSentTick < interval {
			continue
		}
		entry.lastSentTick = tick
		moved = append(moved, tierSlim(cand.snap.slim, cand.distance, overflow))
	}

	// Departures: anyone in aoi no longer visible.
	var left []string
	for playerID := range client.aoi {
		if _, ok := seen[playerID]; !ok {
			left = append(left, playerID)
			delete(client.aoi, playerID)
		}
	}

	// Self state: keep the local stamina/sprint bar fresh while moving.
	var self *protocol.SnapshotSelf
	for _, peer := range bucket {
		if peer.slim.PlayerID == client.playerID {
			self = &protocol.SnapshotSelf{
				MapID:          peer.slim.MapID,
				Position:       peer.slim.Position,
				Sprinting:      peer.slim.Sprinting,
				StaminaCurrent: peer.slim.StaminaCurrent,
			}
			break
		}
	}

	if len(entered) == 0 && len(moved) == 0 && len(left) == 0 && self == nil {
		return protocol.WSServerMessage{}, false
	}

	return protocol.WSServerMessage{
		Type:    "world_snapshot",
		Tick:    tick,
		Self:    self,
		Entered: entered,
		Moved:   moved,
		Left:    left,
	}, true
}

// tierSlim trims slim fields by distance tier: mid tier drops stamina, far tier
// drops facing/sprinting/stamina (position only).
func tierSlim(slim protocol.SlimPlayerState, distance float64, overflow bool) protocol.SlimPlayerState {
	if overflow || distance > lodMidTiles {
		return protocol.SlimPlayerState{PlayerID: slim.PlayerID, MapID: slim.MapID, Position: slim.Position}
	}
	if distance > lodNearTiles {
		return protocol.SlimPlayerState{PlayerID: slim.PlayerID, MapID: slim.MapID, Position: slim.Position, Facing: slim.Facing, Sprinting: slim.Sprinting}
	}
	return slim
}

// baseModelSlim is the minimal payload for over-cap peers: position only.
func baseModelSlim(slim protocol.SlimPlayerState) protocol.SlimPlayerState {
	return protocol.SlimPlayerState{PlayerID: slim.PlayerID, MapID: slim.MapID, Position: slim.Position}
}

func upgradeWebSocket(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("hijacking unsupported")
	}

	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing websocket key")
	}

	accept := computeWebSocketAccept(key)
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}

	if _, err := rw.WriteString(
		"HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\n" +
			"Connection: Upgrade\r\n" +
			"Sec-WebSocket-Accept: " + accept + "\r\n\r\n",
	); err != nil {
		_ = conn.Close()
		return nil, err
	}

	if err := rw.Flush(); err != nil {
		_ = conn.Close()
		return nil, err
	}

	return &wsConn{
		netConn: conn,
		reader:  rw.Reader,
	}, nil
}

func computeWebSocketAccept(key string) string {
	hash := sha1.Sum([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(hash[:])
}

func (c *wsConn) close() error {
	return c.netConn.Close()
}

func (c *wsConn) readFrame() (wsFrame, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(c.reader, header); err != nil {
		return wsFrame{}, err
	}

	opcode := header[0] & 0x0F
	masked := (header[1] & 0x80) != 0
	payloadLen := int(header[1] & 0x7F)
	if payloadLen == 126 {
		extended := make([]byte, 2)
		if _, err := io.ReadFull(c.reader, extended); err != nil {
			return wsFrame{}, err
		}
		payloadLen = int(binary.BigEndian.Uint16(extended))
	} else if payloadLen == 127 {
		extended := make([]byte, 8)
		if _, err := io.ReadFull(c.reader, extended); err != nil {
			return wsFrame{}, err
		}
		payloadLen64 := binary.BigEndian.Uint64(extended)
		if payloadLen64 > 1<<20 {
			return wsFrame{}, errors.New("websocket payload too large")
		}
		payloadLen = int(payloadLen64)
	}

	maskKey := make([]byte, 4)
	if masked {
		if _, err := io.ReadFull(c.reader, maskKey); err != nil {
			return wsFrame{}, err
		}
	}

	payload := make([]byte, payloadLen)
	if _, err := io.ReadFull(c.reader, payload); err != nil {
		return wsFrame{}, err
	}

	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}

	return wsFrame{
		opcode:  opcode,
		payload: payload,
	}, nil
}

func (c *wsConn) writeFrame(opcode byte, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	header := []byte{0x80 | opcode}
	payloadLen := len(payload)
	switch {
	case payloadLen < 126:
		header = append(header, byte(payloadLen))
	case payloadLen <= 65535:
		header = append(header, 126, 0, 0)
		binary.BigEndian.PutUint16(header[len(header)-2:], uint16(payloadLen))
	default:
		header = append(header, 127, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(header[len(header)-8:], uint64(payloadLen))
	}

	if _, err := c.netConn.Write(header); err != nil {
		return err
	}
	if _, err := c.netConn.Write(payload); err != nil {
		return err
	}
	return nil
}

func (c *wsConn) writeTextMessage(payload []byte) error {
	return c.writeFrame(0x1, payload)
}

func (c *wsConn) writePong(payload []byte) error {
	return c.writeFrame(0xA, payload)
}

func (c *wsConn) writeClose(payload []byte) error {
	return c.writeFrame(0x8, payload)
}
