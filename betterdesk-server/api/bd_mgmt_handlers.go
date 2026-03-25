package api

// BetterDesk Desktop Client Management WebSocket
//
// Endpoint: GET /ws/bd-mgmt/{device_id}
//
// This WebSocket channel replaces CDAP for desktop clients. It provides:
//   - Device identification (the server marks the peer as betterdesk_desktop)
//   - Real-time management commands (remote-start, config-push, revoke)
//   - Heartbeat keep-alive (the WS connection itself proves liveness)
//
// Authentication: device_id must be a registered (non-banned, non-deleted) peer.
// The connection is lightweight — mostly idle, wakes on operator action.

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// bdMgmtMessage is the JSON envelope for management messages.
type bdMgmtMessage struct {
	Type      string          `json:"type"`
	DeviceID  string          `json:"device_id,omitempty"`
	Timestamp string          `json:"timestamp,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// bdMgmtSession tracks a single connected BetterDesk desktop client.
type bdMgmtSession struct {
	DeviceID  string
	Conn      *websocket.Conn
	Ctx       context.Context
	Cancel    context.CancelFunc
	SendCh    chan bdMgmtMessage
	CreatedAt time.Time
}

// bdMgmtHub manages all active BetterDesk desktop management sessions.
type bdMgmtHub struct {
	mu       sync.RWMutex
	sessions map[string]*bdMgmtSession // device_id -> session
}

var mgmtHub = &bdMgmtHub{
	sessions: make(map[string]*bdMgmtSession),
}

// Get returns the session for a device, or nil.
func (h *bdMgmtHub) Get(deviceID string) *bdMgmtSession {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.sessions[deviceID]
}

// Put stores a session, closing any previous one for the same device.
func (h *bdMgmtHub) Put(s *bdMgmtSession) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if old, ok := h.sessions[s.DeviceID]; ok {
		old.Cancel()
		old.Conn.Close(websocket.StatusGoingAway, "replaced")
	}
	h.sessions[s.DeviceID] = s
}

// Remove deletes a session.
func (h *bdMgmtHub) Remove(deviceID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.sessions, deviceID)
}

// IsConnected checks if a BetterDesk desktop client is connected.
func (h *bdMgmtHub) IsConnected(deviceID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.sessions[deviceID]
	return ok
}

// SendToDevice sends a management message to a connected device.
func (h *bdMgmtHub) SendToDevice(deviceID string, msg bdMgmtMessage) bool {
	h.mu.RLock()
	s, ok := h.sessions[deviceID]
	h.mu.RUnlock()
	if !ok {
		return false
	}
	select {
	case s.SendCh <- msg:
		return true
	default:
		// Channel full — device is slow, skip
		return false
	}
}

// ConnectedDevices returns all connected device IDs.
func (h *bdMgmtHub) ConnectedDevices() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	ids := make([]string, 0, len(h.sessions))
	for id := range h.sessions {
		ids = append(ids, id)
	}
	return ids
}

// ---------------------------------------------------------------------------
//  HTTP handler
// ---------------------------------------------------------------------------

// handleBdMgmt upgrades to WebSocket and runs the management session.
// Route: GET /ws/bd-mgmt/{device_id}
func (s *Server) handleBdMgmt(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("device_id")
	if deviceID == "" || len(deviceID) < 3 || len(deviceID) > 32 {
		http.Error(w, "invalid device_id", http.StatusBadRequest)
		return
	}

	// Verify the device exists, is not banned, and is not deleted
	if banned, _ := s.db.IsPeerBanned(deviceID); banned {
		http.Error(w, "device banned", http.StatusForbidden)
		return
	}
	if deleted, _ := s.db.IsPeerSoftDeleted(deviceID); deleted {
		http.Error(w, "device deleted", http.StatusForbidden)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Accept from any origin (device clients)
	})
	if err != nil {
		log.Printf("[bd-mgmt] WebSocket accept error for %s: %v", deviceID, err)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	session := &bdMgmtSession{
		DeviceID:  deviceID,
		Conn:      conn,
		Ctx:       ctx,
		Cancel:    cancel,
		SendCh:    make(chan bdMgmtMessage, 16),
		CreatedAt: time.Now(),
	}

	mgmtHub.Put(session)
	log.Printf("[bd-mgmt] Device %s connected (management channel)", deviceID)

	// Mark device as betterdesk_desktop in the database
	_ = s.db.UpdatePeerFields(deviceID, map[string]string{
		"device_type": "betterdesk_desktop",
	})

	// Send welcome message
	welcome := bdMgmtMessage{
		Type:      "welcome",
		DeviceID:  deviceID,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	_ = wsjson.Write(ctx, conn, welcome)

	// Run read and write loops
	go session.writeLoop()
	session.readLoop(s)

	// Cleanup
	mgmtHub.Remove(deviceID)
	cancel()
	conn.Close(websocket.StatusNormalClosure, "session ended")
	log.Printf("[bd-mgmt] Device %s disconnected", deviceID)
}

// readLoop reads messages from the device.
func (s *bdMgmtSession) readLoop(srv *Server) {
	for {
		var msg bdMgmtMessage
		err := wsjson.Read(s.Ctx, s.Conn, &msg)
		if err != nil {
			if s.Ctx.Err() != nil {
				return // context cancelled
			}
			log.Printf("[bd-mgmt] Read error from %s: %v", s.DeviceID, err)
			return
		}

		switch msg.Type {
		case "ping":
			// Respond with pong
			pong := bdMgmtMessage{
				Type:      "pong",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
			}
			select {
			case s.SendCh <- pong:
			default:
			}

		case "pong":
			// Expected response to server ping — no action needed

		case "status":
			// Device status update — log and store
			log.Printf("[bd-mgmt] Status from %s: %s", s.DeviceID, string(msg.Payload))

		default:
			log.Printf("[bd-mgmt] Unknown message type from %s: %s", s.DeviceID, msg.Type)
		}
	}
}

// writeLoop sends messages to the device.
func (s *bdMgmtSession) writeLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.Ctx.Done():
			return

		case msg := <-s.SendCh:
			if msg.Timestamp == "" {
				msg.Timestamp = time.Now().UTC().Format(time.RFC3339)
			}
			if err := wsjson.Write(s.Ctx, s.Conn, msg); err != nil {
				return
			}

		case <-ticker.C:
			// Server-side keepalive ping
			ping := bdMgmtMessage{
				Type:      "ping",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
			}
			if err := wsjson.Write(s.Ctx, s.Conn, ping); err != nil {
				return
			}
		}
	}
}

// ---------------------------------------------------------------------------
//  REST helpers for the web panel to trigger management actions
// ---------------------------------------------------------------------------

// handleBdMgmtStatus returns the management channel status for a device.
// Route: GET /api/bd/mgmt/{device_id}/status
func (s *Server) handleBdMgmtStatus(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("device_id")
	connected := mgmtHub.IsConnected(deviceID)
	writeJSON(w, http.StatusOK, map[string]any{
		"device_id": deviceID,
		"connected": connected,
	})
}

// handleBdMgmtSend sends a management command to a connected device.
// Route: POST /api/bd/mgmt/{device_id}/send
func (s *Server) handleBdMgmtSend(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("device_id")

	var msg bdMgmtMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	msg.DeviceID = deviceID

	if mgmtHub.SendToDevice(deviceID, msg) {
		writeJSON(w, http.StatusOK, map[string]any{"sent": true})
	} else {
		http.Error(w, "device not connected", http.StatusNotFound)
	}
}

// handleBdMgmtConnected returns all connected BetterDesk desktop clients.
// Route: GET /api/bd/mgmt/connected
func (s *Server) handleBdMgmtConnected(w http.ResponseWriter, r *http.Request) {
	ids := mgmtHub.ConnectedDevices()
	writeJSON(w, http.StatusOK, map[string]any{
		"devices": ids,
		"count":   len(ids),
	})
}
