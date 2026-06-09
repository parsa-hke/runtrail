// Package server implements the runtrail HTTP API and embedded SPA.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/runtrail/runtrail/internal/store"
	"github.com/runtrail/runtrail/internal/version"
)

// Options configures the runtrail HTTP server.
type Options struct {
	Mutations bool
	StaticFS  fs.FS // optional embedded SPA assets; nil = no SPA mount
}

// New returns a fully wired http.Handler. The caller is responsible for
// binding it to a listener.
func New(s *store.Store, opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))
	r.Use(corsMiddleware)

	hub := NewHub(s)
	hub.Start(context.Background())

	api := &api{store: s, mutations: opts.Mutations, hub: hub}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/ws/runs", hub.ServeGlobalWS)
		r.Get("/ws/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
			hub.ServeRunWS(w, r, chi.URLParam(r, "id"))
		})

		r.Get("/health", api.health)
		r.Get("/projects", api.listProjects)
		r.Get("/projects/{id}", api.getProject)
		r.Get("/projects/{id}/runs", api.listRunsByProject)

		r.Get("/runs", api.listRuns) // global list across projects
		r.Get("/runs/{id}", api.getRun)
		r.Get("/runs/{id}/metrics", api.getMetrics)
		r.Get("/runs/{id}/resources", api.getResources)
		r.Get("/runs/{id}/events", api.getEvents)
		r.Get("/runs/{id}/logs", api.getLogs)
		r.Get("/runs/{id}/artifacts", api.listArtifacts)
		r.Get("/runs/{id}/artifacts/{name}", api.downloadArtifact)
		r.Get("/runs/{id}/source/tree", api.sourceTree)
		r.Get("/runs/{id}/source/file", api.sourceFile)
		r.Get("/runs/{id}/packages", api.listPackages)

		r.Get("/diff", api.diff)
		r.Get("/views", api.listViews)

		// Mutation endpoints — all gated by the middleware.
		r.With(api.requireMutations).Patch("/projects/{id}", api.patchProject)
		r.With(api.requireMutations).Patch("/runs/{id}", api.patchRun)
		r.With(api.requireMutations).Delete("/runs/{id}", api.deleteRun)
		r.With(api.requireMutations).Post("/runs/{id}/stop", api.stopRun)
		r.With(api.requireMutations).Post("/views", api.saveView)
		r.With(api.requireMutations).Delete("/views/{id}", api.deleteView)
	})

	if opts.StaticFS != nil {
		mountSPA(r, opts.StaticFS)
	}
	return r
}

// ---------------------------------------------------------------------------
// api struct + helpers
// ---------------------------------------------------------------------------

type api struct {
	store     *store.Store
	mutations bool
	hub       *Hub
}

func (a *api) requireMutations(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.mutations {
			writeError(w, http.StatusForbidden, "forbidden", "mutations disabled; start with --mutations")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *api) notImplemented(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "endpoint not implemented yet")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}

// translateErr maps store errors to HTTP responses; returns true if handled.
func translateErr(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", err.Error())
		return true
	}
	if strings.Contains(err.Error(), "ambiguous") {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return true
	}
	writeError(w, http.StatusInternalServerError, "internal", err.Error())
	return true
}

// resolveRun helper — converts a path param (full id or prefix) to a full id.
func (a *api) resolveRun(ctx context.Context, w http.ResponseWriter, idOrPrefix string) (string, bool) {
	id, err := a.store.ResolveRunID(ctx, idOrPrefix)
	if err != nil {
		translateErr(w, err)
		return "", false
	}
	return id, true
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (a *api) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"version":   version.Version,
		"time":      time.Now().UTC(),
		"mutations": a.mutations,
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Loopback-only server, but allow same-origin SPA fetches.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// SPA mount
// ---------------------------------------------------------------------------

func mountSPA(r chi.Router, root fs.FS) {
	fileServer := http.FileServer(http.FS(root))
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		// Try the file; if it's not an asset we know about, fall back to index.html.
		path := strings.TrimPrefix(req.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(root, path); err == nil {
			fileServer.ServeHTTP(w, req)
			return
		}
		// SPA fallback.
		index, err := fs.ReadFile(root, "index.html")
		if err != nil {
			http.Error(w, "ui assets missing", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
}

// Unused import elimination.
var _ = fmt.Sprintf
