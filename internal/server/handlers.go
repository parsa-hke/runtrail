package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/parsa-hke/runtrail/internal/diff"
	"github.com/parsa-hke/runtrail/internal/domain"
	"github.com/parsa-hke/runtrail/internal/store"
)

func (a *api) listProjects(w http.ResponseWriter, r *http.Request) {
	projs, err := a.store.ListProjects(r.Context())
	if translateErr(w, err) {
		return
	}
	if projs == nil {
		projs = []domain.Project{}
	}
	writeJSON(w, http.StatusOK, projs)
}

func (a *api) getProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := a.store.GetProject(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *api) listRunsByProject(w http.ResponseWriter, r *http.Request) {
	a.listRunsCommon(w, r, chi.URLParam(r, "id"))
}

func (a *api) listRuns(w http.ResponseWriter, r *http.Request) {
	a.listRunsCommon(w, r, r.URL.Query().Get("project"))
}

func (a *api) listRunsCommon(w http.ResponseWriter, r *http.Request, projectID string) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = 200
	}
	runs, err := a.store.ListRuns(r.Context(), domain.RunFilter{
		ProjectID: projectID,
		Status:    q.Get("status"),
		Tag:       q.Get("tag"),
		Limit:     limit,
	})
	if translateErr(w, err) {
		return
	}
	if runs == nil {
		runs = []domain.Run{}
	}
	writeJSON(w, http.StatusOK, runs)
}

func (a *api) getRun(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	run, err := a.store.GetRun(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	arts, err := a.store.Artifacts(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"run":       run,
		"artifacts": arts,
	})
}

func (a *api) getMetrics(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var names []string
	if s := r.URL.Query().Get("names"); s != "" {
		for _, n := range strings.Split(s, ",") {
			if n = strings.TrimSpace(n); n != "" {
				names = append(names, n)
			}
		}
	}
	rows, err := a.store.ReadMetrics(r.Context(), id, names)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *api) getResources(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	rows, err := a.store.ReadResources(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *api) getEvents(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	rows, err := a.store.ReadEvents(r.Context(), id, since)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *api) getLogs(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	stream := r.URL.Query().Get("stream")
	if stream == "" {
		stream = "stdout"
	}
	tail, _ := strconv.Atoi(r.URL.Query().Get("tail"))
	if tail <= 0 {
		tail = 500
	}
	lines, err := a.store.ReadLogTail(r.Context(), id, stream, tail)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"stream": stream,
		"lines":  lines,
	})
}

func (a *api) listArtifacts(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	arts, err := a.store.Artifacts(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, arts)
}

func (a *api) downloadArtifact(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	name := chi.URLParam(r, "name")
	rc, size, sha, err := a.store.OpenArtifact(r.Context(), id, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("ETag", `"`+sha+`"`)
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	_, _ = copyTo(w, rc)
}

func (a *api) sourceTree(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	tree, err := a.store.SourceTree(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	if tree == nil {
		tree = []string{}
	}
	writeJSON(w, http.StatusOK, tree)
}

func (a *api) sourceFile(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "path query param required")
		return
	}
	b, err := a.store.SourceFile(r.Context(), id, path)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    path,
		"content": string(b),
	})
}

func (a *api) listPackages(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	pkgs, err := a.store.Packages(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, pkgs)
}

func (a *api) listViews(w http.ResponseWriter, r *http.Request) {
	// Saved views are project-scoped; query param ?project=<id> filters them.
	// Phase 5 adds mutation support; for now return the stored views read-only.
	projectID := r.URL.Query().Get("project")
	views, err := a.store.ListSavedViews(r.Context(), projectID)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, views)
}

func (a *api) diff(w http.ResponseWriter, r *http.Request) {
	rawIDs := strings.Split(r.URL.Query().Get("ids"), ",")
	if len(rawIDs) < 2 || rawIDs[0] == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "ids query param requires >=2 run ids")
		return
	}
	runs := make([]domain.Run, 0, len(rawIDs))
	for _, raw := range rawIDs {
		id, err := a.store.ResolveRunID(r.Context(), strings.TrimSpace(raw))
		if err != nil {
			translateErr(w, err)
			return
		}
		run, err := a.store.GetRun(r.Context(), id)
		if translateErr(w, err) {
			return
		}
		runs = append(runs, run)
	}
	report := diff.Compute(runs)
	writeJSON(w, http.StatusOK, report)
}

func (a *api) patchProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Name        *string  `json:"name"`
		Description *string  `json:"description"`
		DefaultTags []string `json:"default_tags"`
		Baselines   []string `json:"baselines"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	err := a.store.UpdateProject(r.Context(), id, req.Name, req.Description, req.DefaultTags, req.Baselines)
	if translateErr(w, err) {
		return
	}
	p, err := a.store.GetProject(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *api) patchRun(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var patch domain.RunPatch
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	err := a.store.UpdateRun(r.Context(), id, patch)
	if translateErr(w, err) {
		return
	}
	run, err := a.store.GetRun(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (a *api) deleteRun(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	_, err := a.store.DeleteRun(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *api) stopRun(w http.ResponseWriter, r *http.Request) {
	id, ok := a.resolveRun(r.Context(), w, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	run, err := a.store.GetRun(r.Context(), id)
	if translateErr(w, err) {
		return
	}
	if run.Status != domain.StatusRunning {
		writeError(w, http.StatusBadRequest, "bad_request", "run is not running")
		return
	}

	if run.PID > 0 {
		_ = terminateProcess(run.PID)
	}

	err = a.store.KillRun(r.Context(), id)
	if translateErr(w, err) {
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *api) saveView(w http.ResponseWriter, r *http.Request) {
	var view store.SavedView
	if err := json.NewDecoder(r.Body).Decode(&view); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if view.ProjectID == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "project_id required")
		return
	}
	if view.ID == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "id required")
		return
	}
	if view.Name == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "name required")
		return
	}
	err := a.store.SaveSavedView(r.Context(), view)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (a *api) deleteView(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	projectID := r.URL.Query().Get("project")
	err := a.store.DeleteSavedView(r.Context(), projectID, id)
	if translateErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
