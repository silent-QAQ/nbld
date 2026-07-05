package app

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"

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
