package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"nbld/server/internal/protocol"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

func main() {
	token, err := fetchToken()
	if err != nil {
		log.Fatal(err)
	}

	if err := runWSCheck(token); err != nil {
		log.Fatal(err)
	}
}

func fetchToken() (string, error) {
	baseURL := httpBaseURL()
	resp, err := http.Post(
		baseURL+"/api/v1/session/guest",
		"application/json",
		strings.NewReader(`{"deviceId":"ws-check"}`),
	)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var login protocol.GuestLoginResponse
	if err := json.NewDecoder(resp.Body).Decode(&login); err != nil {
		return "", err
	}

	return login.Token, nil
}

func runWSCheck(token string) error {
	wsAddr, wsPath, err := wsTarget()
	if err != nil {
		return err
	}

	conn, reader, err := dialWS(wsAddr, wsPath)
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := writeWSJSON(conn, protocol.WSClientMessage{
		Type:  "auth",
		Token: token,
	}); err != nil {
		return err
	}

	var authOK protocol.WSServerMessage
	if err := readWSJSON(reader, &authOK); err != nil {
		return err
	}
	fmt.Printf("ws auth: %s %s\n", authOK.Type, authOK.PlayerID)

	if err := writeWSJSON(conn, protocol.WSClientMessage{
		Type: "move",
		Position: protocol.Position{
			X: 21,
			Y: 9,
		},
	}); err != nil {
		return err
	}

	var moved protocol.WSServerMessage
	if err := readWSJSON(reader, &moved); err != nil {
		return err
	}
	fmt.Printf("ws move: %s %.1f %.1f\n", moved.Type, moved.Position.X, moved.Position.Y)
	return nil
}

func httpBaseURL() string {
	baseURL := strings.TrimSpace(strings.TrimRight(getenv("NBLD_WS_CHECK_HTTP_BASE_URL", "http://127.0.0.1:6363"), "/"))
	if baseURL == "" {
		return "http://127.0.0.1:6363"
	}
	return baseURL
}

func wsTarget() (string, string, error) {
	wsURL := strings.TrimSpace(getenv("NBLD_WS_CHECK_WS_URL", ""))
	if wsURL == "" {
		baseURL, err := url.Parse(httpBaseURL())
		if err != nil {
			return "", "", err
		}

		scheme := "ws"
		if baseURL.Scheme == "https" {
			scheme = "wss"
		}

		wsURL = scheme + "://" + baseURL.Host + "/ws/world"
	}

	parsed, err := url.Parse(wsURL)
	if err != nil {
		return "", "", err
	}
	if parsed.Host == "" {
		return "", "", fmt.Errorf("invalid websocket url: %s", wsURL)
	}

	path := parsed.EscapedPath()
	if path == "" {
		path = "/"
	}
	if parsed.RawQuery != "" {
		path += "?" + parsed.RawQuery
	}

	return parsed.Host, path, nil
}

func getenv(key, fallback string) string {
	if envValue := strings.TrimSpace(os.Getenv(key)); envValue != "" {
		return envValue
	}
	return fallback
}

func dialWS(addr, path string) (net.Conn, *bufio.Reader, error) {
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return nil, nil, err
	}

	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)

	request := fmt.Sprintf(
		"GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\n\r\n",
		path,
		addr,
		key,
	)
	if _, err := conn.Write([]byte(request)); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}

	reader := bufio.NewReader(conn)
	statusLine, err := reader.ReadString('\n')
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	if !strings.Contains(statusLine, "101") {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("unexpected websocket status: %s", strings.TrimSpace(statusLine))
	}

	acceptExpected := computeAccept(key)
	foundAccept := false
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			_ = conn.Close()
			return nil, nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(line), "sec-websocket-accept:") {
			value := strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
			foundAccept = value == acceptExpected
		}
	}

	if !foundAccept {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("invalid websocket accept header")
	}

	return conn, reader, nil
}

func computeAccept(key string) string {
	sum := sha1.Sum([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func writeWSJSON(conn net.Conn, v any) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}

	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}

	header := []byte{0x81}
	payloadLen := len(payload)
	switch {
	case payloadLen < 126:
		header = append(header, 0x80|byte(payloadLen))
	case payloadLen <= 65535:
		header = append(header, 0x80|126, 0, 0)
		binary.BigEndian.PutUint16(header[len(header)-2:], uint16(payloadLen))
	default:
		header = append(header, 0x80|127, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(header[len(header)-8:], uint64(payloadLen))
	}

	maskedPayload := make([]byte, len(payload))
	copy(maskedPayload, payload)
	for i := range maskedPayload {
		maskedPayload[i] ^= mask[i%4]
	}

	if _, err := conn.Write(header); err != nil {
		return err
	}
	if _, err := conn.Write(mask); err != nil {
		return err
	}
	if _, err := conn.Write(maskedPayload); err != nil {
		return err
	}
	return nil
}

func readWSJSON(reader *bufio.Reader, dst any) error {
	payload, err := readTextFrame(reader)
	if err != nil {
		return err
	}
	return json.Unmarshal(payload, dst)
}

func readTextFrame(reader *bufio.Reader) ([]byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		return nil, err
	}

	opcode := header[0] & 0x0F
	if opcode == 0x8 {
		return nil, io.EOF
	}
	if opcode != 0x1 {
		return nil, fmt.Errorf("unsupported websocket opcode: %d", opcode)
	}

	payloadLen := int(header[1] & 0x7F)
	if payloadLen == 126 {
		extended := make([]byte, 2)
		if _, err := io.ReadFull(reader, extended); err != nil {
			return nil, err
		}
		payloadLen = int(binary.BigEndian.Uint16(extended))
	} else if payloadLen == 127 {
		extended := make([]byte, 8)
		if _, err := io.ReadFull(reader, extended); err != nil {
			return nil, err
		}
		payloadLen = int(binary.BigEndian.Uint64(extended))
	}

	payload := make([]byte, payloadLen)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, err
	}
	return payload, nil
}
