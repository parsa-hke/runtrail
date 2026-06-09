package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/runtrail/runtrail/internal/domain"
)

func TestMutations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "runtrail-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	s, err := Open(tmpDir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	ctx := context.Background()

	// 1. Test Project Insertion & Mutation
	p := domain.Project{
		ID:          "test-proj",
		Name:        "Test Project",
		Description: "A test project",
		DefaultTags: []string{"test"},
		Baselines:   []string{},
	}
	if err := s.UpsertProject(ctx, p); err != nil {
		t.Fatalf("upsert project: %v", err)
	}

	// Update Project
	newName := "Updated Proj Name"
	newDesc := "New desc"
	if err := s.UpdateProject(ctx, p.ID, &newName, &newDesc, []string{"new-tag"}, []string{"run-123"}); err != nil {
		t.Fatalf("update project: %v", err)
	}

	pUpdated, err := s.GetProject(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pUpdated.Name != newName || pUpdated.Description != newDesc {
		t.Errorf("project name/desc not updated: got %s, %s", pUpdated.Name, pUpdated.Description)
	}
	if len(pUpdated.DefaultTags) != 1 || pUpdated.DefaultTags[0] != "new-tag" {
		t.Errorf("default tags not updated: %v", pUpdated.DefaultTags)
	}

	// 2. Test Run Insertion & Mutation
	runId := "run-abcdef12"
	// Create run directory so meta.json can be written
	runDir := filepath.Join(tmpDir, "projects", p.ID, "runs", runId)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		t.Fatal(err)
	}

	r := domain.Run{
		ID:        runId,
		ProjectID: p.ID,
		Name:      "original-run-name",
		Status:    domain.StatusRunning,
		StartedAt: time.Now(),
		Tags:      []string{"tag1"},
		Notes:     "original notes",
	}

	if err := s.InsertImportedRun(ctx, RunWriteOptions{Run: r}); err != nil {
		t.Fatalf("insert run: %v", err)
	}

	// Patch Run
	patchedName := "patched-run-name"
	patchedNotes := "patched notes"
	pinned := true
	patch := domain.RunPatch{
		Name:   &patchedName,
		Notes:  &patchedNotes,
		Pinned: &pinned,
		Tags:   []string{"tag2", "tag3"},
	}

	if err := s.UpdateRun(ctx, runId, patch); err != nil {
		t.Fatalf("update run: %v", err)
	}

	rUpdated, err := s.GetRun(ctx, runId)
	if err != nil {
		t.Fatal(err)
	}

	if rUpdated.Name != patchedName || rUpdated.Notes != patchedNotes || !rUpdated.Pinned {
		t.Errorf("run name/notes/pinned not updated: %+v", rUpdated)
	}
	if len(rUpdated.Tags) != 2 || rUpdated.Tags[0] != "tag2" || rUpdated.Tags[1] != "tag3" {
		t.Errorf("run tags not updated: %v", rUpdated.Tags)
	}

	// Check meta.json
	metaMap, err := s.ReadMeta(ctx, runId)
	if err != nil {
		t.Fatal(err)
	}
	if metaMap["name"] != patchedName || metaMap["notes"] != patchedNotes || metaMap["pinned"] != true {
		t.Errorf("meta.json not updated: %v", metaMap)
	}

	// 3. Test Saved Views
	view := SavedView{
		ID:        "view-1",
		ProjectID: p.ID,
		Name:      "View 1",
		Query:     "status=running",
	}

	if err := s.SaveSavedView(ctx, view); err != nil {
		t.Fatalf("save view: %v", err)
	}

	views, err := s.ListSavedViews(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].Name != "View 1" {
		t.Errorf("views not saved correctly: %v", views)
	}

	// Delete Saved View
	if err := s.DeleteSavedView(ctx, p.ID, view.ID); err != nil {
		t.Fatalf("delete view: %v", err)
	}

	views, err = s.ListSavedViews(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 0 {
		t.Errorf("view not deleted: %v", views)
	}

	// 4. Test KillRun
	if err := s.KillRun(ctx, runId); err != nil {
		t.Fatalf("kill run: %v", err)
	}

	rKilled, err := s.GetRun(ctx, runId)
	if err != nil {
		t.Fatal(err)
	}
	if rKilled.Status != domain.StatusKilled {
		t.Errorf("run status not killed: %s", rKilled.Status)
	}
}
