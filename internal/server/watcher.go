package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/parsa-hke/runtrail/internal/config"
	"github.com/parsa-hke/runtrail/internal/store"
)

type runWatcher struct {
	store *store.Store
	runID string
	hub   *Hub
	dir   string

	watcher   *fsnotify.Watcher
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	mu        sync.Mutex
	offsets   map[string]int64
	fileTypes map[string]string // e.g. "metrics.jsonl" -> "metric"
}

func newRunWatcher(s *store.Store, runID string, hub *Hub) (*runWatcher, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var projectID string
	err := s.DB().QueryRowContext(ctx, `SELECT project_id FROM runs WHERE id = ?`, runID).Scan(&projectID)
	if err != nil {
		return nil, err
	}

	dir := config.RunDir(s.Home(), projectID, runID)

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	runCtx, runCancel := context.WithCancel(context.Background())

	rw := &runWatcher{
		store:     s,
		runID:     runID,
		hub:       hub,
		dir:       dir,
		watcher:   w,
		ctx:       runCtx,
		cancel:    runCancel,
		offsets:   make(map[string]int64),
		fileTypes: map[string]string{
			"metrics.jsonl":   "metric",
			"resources.jsonl": "resource",
			"events.jsonl":    "event",
			"stdout.log":      "log",
			"stderr.log":      "log",
		},
	}

	return rw, nil
}

func (rw *runWatcher) start() {
	// Initialize offsets to current file sizes
	for file := range rw.fileTypes {
		path := filepath.Join(rw.dir, file)
		if info, err := os.Stat(path); err == nil {
			rw.offsets[file] = info.Size()
		} else {
			rw.offsets[file] = 0
		}
	}

	if err := rw.watcher.Add(rw.dir); err != nil {
		// Directory might not exist yet, that is fine
	}

	rw.wg.Add(2)
	go rw.watchLoop()
	go rw.pollFallbackLoop()
}

func (rw *runWatcher) stop() {
	rw.cancel()
	_ = rw.watcher.Close()
	rw.wg.Wait()
}

func (rw *runWatcher) watchLoop() {
	defer rw.wg.Done()
	for {
		select {
		case <-rw.ctx.Done():
			return
		case event, ok := <-rw.watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
				rw.checkFile(filepath.Base(event.Name))
			}
		case err, ok := <-rw.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("fsnotify error: %v", err)
		}
	}
}

func (rw *runWatcher) pollFallbackLoop() {
	defer rw.wg.Done()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-rw.ctx.Done():
			return
		case <-ticker.C:
			// Ensure directory is added if it was created later
			_ = rw.watcher.Add(rw.dir)

			for file := range rw.fileTypes {
				rw.checkFile(file)
			}
		}
	}
}

func (rw *runWatcher) checkFile(filename string) {
	rw.mu.Lock()
	defer rw.mu.Unlock()

	typ, ok := rw.fileTypes[filename]
	if !ok {
		return
	}

	path := filepath.Join(rw.dir, filename)
	info, err := os.Stat(path)
	if err != nil {
		return
	}

	lastOffset := rw.offsets[filename]
	newSize := info.Size()

	if newSize < lastOffset {
		// File was truncated/reset
		rw.offsets[filename] = 0
		lastOffset = 0
	}

	if newSize > lastOffset {
		f, err := os.Open(path)
		if err != nil {
			return
		}
		defer f.Close()

		_, err = f.Seek(lastOffset, io.SeekStart)
		if err != nil {
			return
		}

		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1024*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}

			var msg map[string]any
			if typ == "log" {
				stream := "stdout"
				if filename == "stderr.log" {
					stream = "stderr"
				}
				msg = map[string]any{
					"type":   "log",
					"stream": stream,
					"text":   line,
				}
			} else {
				// JSONL files: metrics, resources, events
				var parsed map[string]any
				if err := json.Unmarshal([]byte(line), &parsed); err != nil {
					continue
				}

				if typ == "metric" {
					step := int64(0)
					if v, ok := parsed["step"].(float64); ok {
						step = int64(v)
					}
					wallMS := int64(0)
					if v, ok := parsed["wall_ms"].(float64); ok {
						wallMS = int64(v)
					}
					// Collect everything else as values
					values := make(map[string]float64)
					for k, v := range parsed {
						if k == "step" || k == "wall_ms" {
							continue
						}
						if fval, ok := v.(float64); ok {
							values[k] = fval
						}
					}
					msg = map[string]any{
						"type":    "metric",
						"step":    step,
						"wall_ms": wallMS,
						"values":  values,
					}
				} else if typ == "resource" {
					msg = parsed
					msg["type"] = "resource"
				} else if typ == "event" {
					msg = parsed
					msg["type"] = "event"
				}
			}

			if msg != nil {
				rw.hub.broadcastToRun(rw.runID, msg)
			}
		}

		rw.offsets[filename] = newSize
	}
}
