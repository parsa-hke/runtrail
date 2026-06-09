package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/parsa-hke/runtrail/internal/domain"
)

// RunWriteOptions carries the row data needed to recreate a run during import.
type RunWriteOptions struct {
	Run       domain.Run
	Artifacts []domain.Artifact
	Packages  []domain.Package
}

// InsertImportedRun writes the run row plus its denormalized children. It
// expects the run directory and any artifact blobs to already be in place on
// disk. Returns an error if the run id is already present.
func (s *Store) InsertImportedRun(ctx context.Context, opts RunWriteOptions) error {
	r := opts.Run

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	hparamsJSON := jsonOrNull(r.HParams)
	finalJSON := jsonOrNull(r.Final)
	hardwareJSON := jsonOrNull(r.Hardware)
	envJSON := jsonOrNull(r.Env)

	var endedAt sql.NullInt64
	if r.EndedAt != nil {
		endedAt = sql.NullInt64{Int64: r.EndedAt.Unix(), Valid: true}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO runs (id, project_id, name, status, started_at, ended_at,
		                  duration_s, user, host, pid, branch, commit_hash, dirty,
		                  cmd, exit_code, error, notes, pinned,
		                  hparams_json, final_json, hardware_json, env_json,
		                  dataset, dataset_hash)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.ProjectID, r.Name, string(r.Status), r.StartedAt.Unix(), endedAt,
		r.DurationS, r.User, r.Host, r.PID, r.Branch, r.Commit, boolInt(r.Dirty),
		r.Cmd, r.ExitCode, nilIfEmpty(r.Error), nilIfEmpty(r.Notes), boolInt(r.Pinned),
		hparamsJSON, finalJSON, hardwareJSON, envJSON,
		nilIfEmpty(r.Dataset), nilIfEmpty(r.DatasetHash),
	)
	if err != nil {
		return fmt.Errorf("insert run: %w", err)
	}

	for _, t := range r.Tags {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO tags (run_id, tag) VALUES (?, ?)`, r.ID, t); err != nil {
			return err
		}
	}
	for _, a := range opts.Artifacts {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO artifacts (run_id, name, type, size_bytes, sha256, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
			r.ID, a.Name, a.Type, a.SizeBytes, a.SHA256, createdAtUnix(a.CreatedAt),
		); err != nil {
			return err
		}
	}
	for _, p := range opts.Packages {
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO packages (run_id, name, version) VALUES (?, ?, ?)`,
			r.ID, p.Name, p.Version); err != nil {
			return err
		}
	}
	for name, v := range r.Final {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR REPLACE INTO final_metrics (run_id, name, value, best, last, step_count)
			VALUES (?, ?, ?, ?, ?, ?)`,
			r.ID, name, v, v, v, 0); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RunExists reports whether the given run id is already present.
func (s *Store) RunExists(ctx context.Context, id string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs WHERE id = ?`, id).Scan(&n)
	return n > 0, err
}

func jsonOrNull(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case map[string]any:
		if len(x) == 0 {
			return nil
		}
	case map[string]float64:
		if len(x) == 0 {
			return nil
		}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return string(b)
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func createdAtUnix(t time.Time) int64 {
	if t.IsZero() {
		return time.Now().Unix()
	}
	return t.Unix()
}
