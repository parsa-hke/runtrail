package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/runtrail/runtrail/internal/domain"
	"github.com/runtrail/runtrail/internal/store"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Local loopback only, but browser uses CORS
	},
}

type Hub struct {
	store *store.Store
	mu    sync.RWMutex

	// Global runs WS subscribers
	globalClients map[*client]bool

	// Per-run WS subscribers: runID -> clients
	runClients map[string]map[*client]bool

	// Active fsnotify watchers per run
	runWatchers map[string]*runWatcher
}

type client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

func NewHub(s *store.Store) *Hub {
	return &Hub{
		store:         s,
		globalClients: make(map[*client]bool),
		runClients:    make(map[string]map[*client]bool),
		runWatchers:   make(map[string]*runWatcher),
	}
}

// Start runs the periodic DB poller to broadcast run list updates
func (h *Hub) Start(ctx context.Context) {
	go h.pollDBLoop(ctx)
}

func (h *Hub) pollDBLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	type runState struct {
		status string
		name   string
		notes  string
		pinned bool
		tags   string // concatenated
	}

	previous := make(map[string]runState)

	// Helper to fetch current state
	fetchState := func() (map[string]runState, map[string]domain.Run) {
		current := make(map[string]runState)
		runsMap := make(map[string]domain.Run)
		runs, err := h.store.ListRuns(ctx, domain.RunFilter{Limit: 2000})
		if err != nil {
			return nil, nil
		}
		for _, r := range runs {
			sortTags := strings.Join(r.Tags, ",")
			current[r.ID] = runState{
				status: string(r.Status),
				name:   r.Name,
				notes:  r.Notes,
				pinned: r.Pinned,
				tags:   sortTags,
			}
			runsMap[r.ID] = r
		}
		return current, runsMap
	}

	// Initial population
	if curr, _ := fetchState(); curr != nil {
		previous = curr
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			curr, runsMap := fetchState()
			if curr == nil {
				continue
			}

			// Find deleted runs
			for id := range previous {
				if _, ok := curr[id]; !ok {
					h.broadcastGlobal(map[string]any{
						"type": "run.deleted",
						"id":   id,
					})
				}
			}

			// Find created or updated runs
			for id, c := range curr {
				prev, exists := previous[id]
				if !exists {
					// Broadcast full run
					h.broadcastGlobal(map[string]any{
						"type": "run.created",
						"run":  runsMap[id],
					})
				} else if prev.status != c.status || prev.name != c.name || prev.notes != c.notes || prev.pinned != c.pinned || prev.tags != c.tags {
					// Broadcast patch
					patch := map[string]any{}
					if prev.status != c.status {
						patch["status"] = c.status
					}
					if prev.name != c.name {
						patch["name"] = c.name
					}
					if prev.notes != c.notes {
						patch["notes"] = c.notes
					}
					if prev.pinned != c.pinned {
						patch["pinned"] = c.pinned
					}
					if prev.tags != c.tags {
						patch["tags"] = runsMap[id].Tags
					}
					h.broadcastGlobal(map[string]any{
						"type":  "run.updated",
						"id":    id,
						"patch": patch,
					})

					// Also broadcast status change to per-run subscribers
					if prev.status != c.status {
						h.broadcastToRun(id, map[string]any{
							"type":   "status",
							"status": c.status,
						})
					}
				}
			}

			previous = curr
		}
	}
}

func (h *Hub) broadcastGlobal(msg any) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.globalClients {
		select {
		case c.send <- b:
		default:
			close(c.send)
			delete(h.globalClients, c)
		}
	}
}

func (h *Hub) broadcastToRun(runID string, msg any) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.runClients[runID]; ok {
		for c := range clients {
			select {
			case c.send <- b:
			default:
				close(c.send)
				delete(clients, c)
			}
		}
	}
}

func (h *Hub) registerGlobal(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.globalClients[c] = true
}

func (h *Hub) unregisterGlobal(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.globalClients, c)
}

func (h *Hub) registerRun(runID string, c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.runClients[runID]; !ok {
		h.runClients[runID] = make(map[*client]bool)
	}
	h.runClients[runID][c] = true

	// Start file watcher if this is the first client subscribing to this run
	if len(h.runClients[runID]) == 1 {
		watcher, err := newRunWatcher(h.store, runID, h)
		if err == nil {
			h.runWatchers[runID] = watcher
			watcher.start()
		}
	}
}

func (h *Hub) unregisterRun(runID string, c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.runClients[runID]; ok {
		delete(clients, c)
		if len(clients) == 0 {
			delete(h.runClients, runID)
			// Stop file watcher
			if watcher, ok := h.runWatchers[runID]; ok {
				watcher.stop()
				delete(h.runWatchers, runID)
			}
		}
	}
}

func (h *Hub) ServeGlobalWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}
	c := &client{hub: h, conn: conn, send: make(chan []byte, 256)}
	h.registerGlobal(c)

	go c.writePump()
	go c.readPumpGlobal()
}

func (h *Hub) ServeRunWS(w http.ResponseWriter, r *http.Request, runID string) {
	resolvedID, err := h.store.ResolveRunID(r.Context(), runID)
	if err != nil {
		log.Printf("WS resolve run id error: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}
	c := &client{hub: h, conn: conn, send: make(chan []byte, 256)}
	h.registerRun(resolvedID, c)

	go c.writePump()
	go c.readPumpRun(resolvedID)
}

func (c *client) readPumpGlobal() {
	defer func() {
		c.hub.unregisterGlobal(c)
		_ = c.conn.Close()
	}()
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (c *client) readPumpRun(runID string) {
	defer func() {
		c.hub.unregisterRun(runID, c)
		_ = c.conn.Close()
	}()
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		var req struct {
			Subscribe []string `json:"subscribe"`
		}
		if err := json.Unmarshal(message, &req); err == nil {
			// Subscriptions can be filtered here if necessary
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			err := c.conn.WriteMessage(websocket.TextMessage, message)
			if err != nil {
				return
			}
		case <-ticker.C:
			// Ping message to keep connection alive
			err := c.conn.WriteMessage(websocket.PingMessage, nil)
			if err != nil {
				return
			}
		}
	}
}
