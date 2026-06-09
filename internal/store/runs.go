package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/parsa-hke/runtrail/internal/config"
	"github.com/parsa-hke/runtrail/internal/domain"
)

// ListRuns returns runs matching f, newest first.
func (s *Store) ListRuns(ctx context.Context, f domain.RunFilter) ([]domain.Run, error) {
	var (
		where []string
		args  []any
	)
	if f.ProjectID != "" {
		where = append(where, "r.project_id = ?")
		args = append(args, f.ProjectID)
	}
	if f.Status != "" {
		where = append(where, "r.status = ?")
		args = append(args, f.Status)
	}
	if f.Tag != "" {
		where = append(where, "EXISTS (SELECT 1 FROM tags t WHERE t.run_id = r.id AND t.tag = ?)")
		args = append(args, f.Tag)
	}
	q := `SELECT r.id, r.project_id, r.name, r.status, r.started_at, r.ended_at,
	             COALESCE(r.duration_s,0), COALESCE(r.user,''), COALESCE(r.host,''),
	             COALESCE(r.pid,0), COALESCE(r.branch,''), COALESCE(r.commit_hash,''),
	             COALESCE(r.dirty,0), COALESCE(r.cmd,''), COALESCE(r.exit_code,0),
	             COALESCE(r.error,''), COALESCE(r.notes,''), COALESCE(r.pinned,0),
	             COALESCE(r.hparams_json,''), COALESCE(r.final_json,''),
	             COALESCE(r.hardware_json,''), COALESCE(r.env_json,''),
	             COALESCE(r.dataset,''), COALESCE(r.dataset_hash,'')
	      FROM runs r`
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += " ORDER BY r.started_at DESC"
	if f.Limit > 0 {
		q += fmt.Sprintf(" LIMIT %d", f.Limit)
	}

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Run
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Hydrate tags for the page.
	for i := range out {
		tags, err := s.runTags(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Tags = tags
	}
	return out, nil
}

// GetRun returns a single run by exact ID or unique prefix match.
func (s *Store) GetRun(ctx context.Context, idOrPrefix string) (domain.Run, error) {
	resolved, err := s.ResolveRunID(ctx, idOrPrefix)
	if err != nil {
		return domain.Run{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		SELECT id, project_id, name, status, started_at, ended_at,
		       COALESCE(duration_s,0), COALESCE(user,''), COALESCE(host,''),
		       COALESCE(pid,0), COALESCE(branch,''), COALESCE(commit_hash,''),
		       COALESCE(dirty,0), COALESCE(cmd,''), COALESCE(exit_code,0),
		       COALESCE(error,''), COALESCE(notes,''), COALESCE(pinned,0),
		       COALESCE(hparams_json,''), COALESCE(final_json,''),
		       COALESCE(hardware_json,''), COALESCE(env_json,''),
		       COALESCE(dataset,''), COALESCE(dataset_hash,'')
		FROM runs WHERE id = ?`, resolved)
	r, err := scanRun(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Run{}, fmt.Errorf("%w: run %s", ErrNotFound, idOrPrefix)
		}
		return domain.Run{}, err
	}
	tags, err := s.runTags(ctx, r.ID)
	if err != nil {
		return domain.Run{}, err
	}
	r.Tags = tags
	return r, nil
}

// ResolveRunID accepts a full run id or a unique prefix (with or without
// the `run-` prefix) and returns the canonical id.
func (s *Store) ResolveRunID(ctx context.Context, idOrPrefix string) (string, error) {
	candidate := idOrPrefix
	if !strings.HasPrefix(candidate, "run-") {
		candidate = "run-" + candidate
	}
	// Exact match fast-path.
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM runs WHERE id = ?`, candidate).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	// Prefix scan.
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM runs WHERE id LIKE ? LIMIT 2`, candidate+"%")
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var matches []string
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return "", err
		}
		matches = append(matches, m)
	}
	switch len(matches) {
	case 0:
		return "", fmt.Errorf("%w: run %s", ErrNotFound, idOrPrefix)
	case 1:
		return matches[0], nil
	default:
		return "", fmt.Errorf("ambiguous run id %q matches multiple runs", idOrPrefix)
	}
}

// DeleteRun removes a run, its files, its tags, and any artifacts that no
// other run references. Returns the project_id the run belonged to.
func (s *Store) DeleteRun(ctx context.Context, runID string) (string, error) {
	// Look up project + artifacts before we delete the row.
	var projectID string
	if err := s.db.QueryRowContext(ctx, `SELECT project_id FROM runs WHERE id = ?`, runID).
		Scan(&projectID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fmt.Errorf("%w: run %s", ErrNotFound, runID)
		}
		return "", err
	}
	shaRows, err := s.db.QueryContext(ctx, `SELECT sha256 FROM artifacts WHERE run_id = ?`, runID)
	if err != nil {
		return "", err
	}
	var shas []string
	for shaRows.Next() {
		var sha string
		if err := shaRows.Scan(&sha); err != nil {
			shaRows.Close()
			return "", err
		}
		shas = append(shas, sha)
	}
	shaRows.Close()

	// Delete the row; ON DELETE CASCADE handles tags/artifacts/packages/events/final_metrics.
	if _, err := s.db.ExecContext(ctx, `DELETE FROM runs WHERE id = ?`, runID); err != nil {
		return "", err
	}

	// Remove the run directory tree from disk.
	if err := os.RemoveAll(config.RunDir(s.home, projectID, runID)); err != nil {
		return "", fmt.Errorf("remove run dir: %w", err)
	}

	// Drop artifact blobs that no remaining run references.
	for _, sha := range shas {
		var n int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM artifacts WHERE sha256 = ?`, sha).
			Scan(&n); err != nil {
			return projectID, err
		}
		if n == 0 {
			_ = os.Remove(config.ArtifactPath(s.home, projectID, sha))
		}
	}
	return projectID, nil
}

// Packages returns the pip-freeze rows captured for a run.
func (s *Store) Packages(ctx context.Context, runID string) ([]domain.Package, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT name, COALESCE(version,'') FROM packages WHERE run_id = ? ORDER BY name`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Package{}
	for rows.Next() {
		var p domain.Package
		if err := rows.Scan(&p.Name, &p.Version); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Artifacts returns the artifacts attached to a run.
func (s *Store) Artifacts(ctx context.Context, runID string) ([]domain.Artifact, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT name, COALESCE(type,'binary'), size_bytes, sha256, created_at
		FROM artifacts WHERE run_id = ? ORDER BY name`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Artifact{}
	for rows.Next() {
		var a domain.Artifact
		var createdAt int64
		if err := rows.Scan(&a.Name, &a.Type, &a.SizeBytes, &a.SHA256, &createdAt); err != nil {
			return nil, err
		}
		a.CreatedAt = time.Unix(createdAt, 0)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) runTags(ctx context.Context, runID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT tag FROM tags WHERE run_id = ? ORDER BY tag`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// rowScanner is the subset of sql.Row / sql.Rows we need for scanRun.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanRun(row rowScanner) (domain.Run, error) {
	var (
		r          domain.Run
		startedAt  int64
		endedAt    sql.NullInt64
		hparams    string
		final      string
		hardware   string
		env        string
		dirty      int
		pinned     int
	)
	if err := row.Scan(
		&r.ID, &r.ProjectID, &r.Name, &r.Status, &startedAt, &endedAt,
		&r.DurationS, &r.User, &r.Host, &r.PID, &r.Branch, &r.Commit,
		&dirty, &r.Cmd, &r.ExitCode, &r.Error, &r.Notes, &pinned,
		&hparams, &final, &hardware, &env, &r.Dataset, &r.DatasetHash,
	); err != nil {
		return domain.Run{}, err
	}
	r.StartedAt = time.Unix(startedAt, 0)
	if endedAt.Valid {
		t := time.Unix(endedAt.Int64, 0)
		r.EndedAt = &t
	}
	r.Dirty = dirty != 0
	r.Pinned = pinned != 0
	r.Tags = []string{} // always non-nil; hydrated by caller
	r.HParams = decodeJSONMap(hparams)
	r.Final = decodeJSONFloatMap(final)
	r.Hardware = decodeJSONMap(hardware)
	r.Env = decodeJSONMap(env)
	if r.HParams == nil {
		r.HParams = map[string]any{}
	}
	if r.Final == nil {
		r.Final = map[string]float64{}
	}
	return r, nil
}

func decodeJSONMap(s string) map[string]any {
	if s == "" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil
	}
	return m
}

func decodeJSONFloatMap(s string) map[string]float64 {
	if s == "" {
		return nil
	}
	var m map[string]float64
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil
	}
	return m
}

// UpdateRun modifies a run's editable metadata in DB and writes a new meta.json.
func (s *Store) UpdateRun(ctx context.Context, id string, patch domain.RunPatch) error {
	resolvedID, err := s.ResolveRunID(ctx, id)
	if err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Get current run info for meta.json rewrite
	var projectID, currentName, currentNotes string
	var currentPinned int
	err = tx.QueryRowContext(ctx, `SELECT project_id, name, COALESCE(notes,''), pinned FROM runs WHERE id = ?`, resolvedID).
		Scan(&projectID, &currentName, &currentNotes, &currentPinned)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: run %s", ErrNotFound, resolvedID)
		}
		return err
	}

	// Build update statement
	var sets []string
	var args []any
	if patch.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *patch.Name)
		currentName = *patch.Name
	}
	if patch.Notes != nil {
		sets = append(sets, "notes = ?")
		args = append(args, *patch.Notes)
		currentNotes = *patch.Notes
	}
	if patch.Pinned != nil {
		val := 0
		if *patch.Pinned {
			val = 1
		}
		sets = append(sets, "pinned = ?")
		args = append(args, val)
		currentPinned = val
	}

	if len(sets) > 0 {
		args = append(args, resolvedID)
		query := fmt.Sprintf("UPDATE runs SET %s WHERE id = ?", strings.Join(sets, ", "))
		_, err = tx.ExecContext(ctx, query, args...)
		if err != nil {
			return err
		}
	}

	// Update tags if provided
	if patch.Tags != nil {
		_, err = tx.ExecContext(ctx, `DELETE FROM tags WHERE run_id = ?`, resolvedID)
		if err != nil {
			return err
		}
		for _, tag := range patch.Tags {
			tag = strings.TrimSpace(tag)
			if tag == "" {
				continue
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO tags (run_id, tag) VALUES (?, ?)`, resolvedID, tag)
			if err != nil {
				return err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Rewrite meta.json on disk
	dir := config.RunDir(s.home, projectID, resolvedID)
	metaPath := filepath.Join(dir, "meta.json")

	// Read existing meta.json
	b, err := os.ReadFile(metaPath)
	var meta map[string]any
	if err == nil {
		_ = json.Unmarshal(b, &meta)
	}
	if meta == nil {
		meta = make(map[string]any)
	}

	// Update fields in meta map
	meta["id"] = resolvedID
	meta["name"] = currentName
	meta["notes"] = currentNotes
	meta["pinned"] = currentPinned != 0
	if patch.Tags != nil {
		meta["tags"] = patch.Tags
	}

	newBytes, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}

	// Atomic write
	tmpPath := metaPath + ".tmp"
	if err := os.WriteFile(tmpPath, newBytes, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, metaPath)
}

// KillRun transitions a run to the killed status in the database and updates meta.json.
func (s *Store) KillRun(ctx context.Context, runID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var projectID string
	var startedAt int64
	err = tx.QueryRowContext(ctx, `SELECT project_id, started_at FROM runs WHERE id = ?`, runID).Scan(&projectID, &startedAt)
	if err != nil {
		return err
	}

	endedAt := time.Now().Unix()
	duration := float64(endedAt - startedAt)

	_, err = tx.ExecContext(ctx, `
		UPDATE runs SET status = 'killed', ended_at = ?, duration_s = ? WHERE id = ?`,
		endedAt, duration, runID)
	if err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Rewrite meta.json
	dir := config.RunDir(s.home, projectID, runID)
	metaPath := filepath.Join(dir, "meta.json")
	b, err := os.ReadFile(metaPath)
	var meta map[string]any
	if err == nil {
		_ = json.Unmarshal(b, &meta)
	}
	if meta == nil {
		meta = make(map[string]any)
	}

	meta["status"] = "killed"
	meta["ended_at"] = endedAt
	meta["duration_s"] = duration

	newBytes, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}

	tmpPath := metaPath + ".tmp"
	if err := os.WriteFile(tmpPath, newBytes, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, metaPath)
}
