package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/parsa-hke/runtrail/internal/domain"
	"github.com/parsa-hke/runtrail/internal/server"
	"github.com/parsa-hke/runtrail/internal/store"
)

func setupTestStore(t *testing.T) (*store.Store, string) {
	tmpDir, err := os.MkdirTemp("", "runtrail-server-test-*")
	if err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(tmpDir)
	if err != nil {
		os.RemoveAll(tmpDir)
		t.Fatal(err)
	}
	return s, tmpDir
}

func TestReadOnlyEndpointsAndMutationsGating(t *testing.T) {
	s, tmpDir := setupTestStore(t)
	defer os.RemoveAll(tmpDir)
	defer s.Close()

	ctx := context.Background()
	proj := domain.Project{
		ID:   "my-proj",
		Name: "My Project",
	}
	if err := s.UpsertProject(ctx, proj); err != nil {
		t.Fatal(err)
	}

	runDir := filepath.Join(tmpDir, "projects", proj.ID, "runs", "run-11111111")
	if err := os.MkdirAll(runDir, 0755); err != nil {
		t.Fatal(err)
	}

	r := domain.Run{
		ID:        "run-11111111",
		ProjectID: proj.ID,
		Name:      "test-run",
		Status:    domain.StatusRunning,
		StartedAt: time.Now(),
	}
	if err := s.InsertImportedRun(ctx, store.RunWriteOptions{Run: r}); err != nil {
		t.Fatal(err)
	}

	// 1. Test Read-Only Mode (Mutations Disabled)
	hReadOnly := server.New(s, server.Options{Mutations: false})

	// PATCH run should return 403 Forbidden
	patchData := []byte(`{"name": "patched-name"}`)
	req, _ := http.NewRequest("PATCH", "/api/v1/runs/run-11111111", bytes.NewBuffer(patchData))
	rec := httptest.NewRecorder()
	hReadOnly.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for run patch in read-only mode, got %d", rec.Code)
	}

	// DELETE run should return 403 Forbidden
	req, _ = http.NewRequest("DELETE", "/api/v1/runs/run-11111111", nil)
	rec = httptest.NewRecorder()
	hReadOnly.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for run delete in read-only mode, got %d", rec.Code)
	}

	// POST view should return 403 Forbidden
	viewData := []byte(`{"id": "v1", "project_id": "my-proj", "name": "View 1", "query": "status=done"}`)
	req, _ = http.NewRequest("POST", "/api/v1/views", bytes.NewBuffer(viewData))
	rec = httptest.NewRecorder()
	hReadOnly.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for save view in read-only mode, got %d", rec.Code)
	}

	// 2. Test Mutations Enabled Mode
	hMutations := server.New(s, server.Options{Mutations: true})

	// Save View
	req, _ = http.NewRequest("POST", "/api/v1/views", bytes.NewBuffer(viewData))
	rec = httptest.NewRecorder()
	hMutations.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for save view, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	// Get Views
	req, _ = http.NewRequest("GET", "/api/v1/views?project=my-proj", nil)
	rec = httptest.NewRecorder()
	hMutations.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for get views, got %d", rec.Code)
	}
	var views []store.SavedView
	if err := json.Unmarshal(rec.Body.Bytes(), &views); err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].Name != "View 1" {
		t.Errorf("unexpected views response: %+v", views)
	}

	// Patch Run
	req, _ = http.NewRequest("PATCH", "/api/v1/runs/run-11111111", bytes.NewBuffer(patchData))
	rec = httptest.NewRecorder()
	hMutations.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for run patch, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	updatedRun, err := s.GetRun(ctx, "run-11111111")
	if err != nil {
		t.Fatal(err)
	}
	if updatedRun.Name != "patched-name" {
		t.Errorf("expected run name to be 'patched-name', got %q", updatedRun.Name)
	}

	// Delete View
	req, _ = http.NewRequest("DELETE", "/api/v1/views/v1?project=my-proj", nil)
	rec = httptest.NewRecorder()
	hMutations.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for delete view, got %d", rec.Code)
	}

	// Delete Run
	req, _ = http.NewRequest("DELETE", "/api/v1/runs/run-11111111", nil)
	rec = httptest.NewRecorder()
	hMutations.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK for delete run, got %d", rec.Code)
	}
}

// TestNFR2Enforcement measures the response time of listing 1,000 runs.
// Budget: < 200ms.
func TestNFR2Enforcement(t *testing.T) {
	s, tmpDir := setupTestStore(t)
	defer os.RemoveAll(tmpDir)
	defer s.Close()

	ctx := context.Background()
	proj := domain.Project{
		ID:   "nfr2-proj",
		Name: "NFR2 Project",
	}
	if err := s.UpsertProject(ctx, proj); err != nil {
		t.Fatal(err)
	}

	// Seed 1,000 runs
	tx, err := s.DB().BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	for i := 0; i < 1000; i++ {
		runID := fmt.Sprintf("run-%08x", i)
		_, err = tx.ExecContext(ctx, `
			INSERT INTO runs (id, project_id, name, status, started_at, duration_s, exit_code, pinned)
			VALUES (?, ?, ?, 'done', ?, 120.0, 0, 0)`,
			runID, proj.ID, fmt.Sprintf("run-name-%d", i), now-int64(i))
		if err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	h := server.New(s, server.Options{})

	// Warm-up request
	req, _ := http.NewRequest("GET", "/api/v1/projects/nfr2-proj/runs?limit=1000", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// Measure timing
	start := time.Now()
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	elapsed := time.Since(start)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}

	t.Logf("NFR-2 Latency for 1,000 runs list: %s (budget: < 200ms)", elapsed)
	if elapsed > 200*time.Millisecond {
		t.Errorf("NFR-2 budget exceeded: 1,000 runs list took %s (max allowed: 200ms)", elapsed)
	}
}

// TestNFR3Enforcement measures the timing for the diff endpoint on two runs.
// Budget: < 500ms.
func TestNFR3Enforcement(t *testing.T) {
	s, tmpDir := setupTestStore(t)
	defer os.RemoveAll(tmpDir)
	defer s.Close()

	ctx := context.Background()
	proj := domain.Project{
		ID:   "nfr3-proj",
		Name: "NFR3 Project",
	}
	if err := s.UpsertProject(ctx, proj); err != nil {
		t.Fatal(err)
	}

	hparams := map[string]any{
		"lr":        0.001,
		"epochs":    200,
		"optimizer": "adam",
		"batch":     64,
	}
	hparamsBytes, _ := json.Marshal(hparams)

	// Final metrics with 20 values
	finalMetrics := map[string]float64{}
	for i := 0; i < 20; i++ {
		finalMetrics[fmt.Sprintf("metric_%d", i)] = rand.Float64()
	}
	finalBytes, _ := json.Marshal(finalMetrics)

	// Seed 2 runs
	for _, id := range []string{"run-aaaa1111", "run-bbbb2222"} {
		_, err := s.DB().ExecContext(ctx, `
			INSERT INTO runs (id, project_id, name, status, started_at, duration_s, exit_code, pinned, hparams_json, final_json)
			VALUES (?, ?, ?, 'done', ?, 120.0, 0, 0, ?, ?)`,
			id, proj.ID, "run-"+id, time.Now().Unix(), string(hparamsBytes), string(finalBytes))
		if err != nil {
			t.Fatal(err)
		}
	}

	h := server.New(s, server.Options{})

	// Warm-up request
	req, _ := http.NewRequest("GET", "/api/v1/diff?ids=run-aaaa1111,run-bbbb2222", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// Measure timing
	start := time.Now()
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	elapsed := time.Since(start)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	t.Logf("NFR-3 Latency for 2-run diff: %s (budget: < 500ms)", elapsed)
	if elapsed > 500*time.Millisecond {
		t.Errorf("NFR-3 budget exceeded: diff endpoint took %s (max allowed: 500ms)", elapsed)
	}
}
