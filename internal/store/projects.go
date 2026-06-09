package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/parsa-hke/runtrail/internal/domain"
)

// ErrNotFound is returned when a requested row is missing.
var ErrNotFound = errors.New("not found")

// ListProjects returns every project, ordered by name.
func (s *Store) ListProjects(ctx context.Context) ([]domain.Project, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(path,''), COALESCE(description,''),
		       COALESCE(default_tags,'[]'), COALESCE(baselines,'[]')
		FROM projects ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Project
	for rows.Next() {
		var p domain.Project
		var defaultTagsJSON, baselinesJSON string
		if err := rows.Scan(&p.ID, &p.Name, &p.Path, &p.Description,
			&defaultTagsJSON, &baselinesJSON); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(defaultTagsJSON), &p.DefaultTags)
		_ = json.Unmarshal([]byte(baselinesJSON), &p.Baselines)
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetProject fetches a single project by id.
func (s *Store) GetProject(ctx context.Context, id string) (domain.Project, error) {
	var p domain.Project
	var defaultTagsJSON, baselinesJSON string
	row := s.db.QueryRowContext(ctx, `
		SELECT id, name, COALESCE(path,''), COALESCE(description,''),
		       COALESCE(default_tags,'[]'), COALESCE(baselines,'[]')
		FROM projects WHERE id = ?`, id)
	if err := row.Scan(&p.ID, &p.Name, &p.Path, &p.Description,
		&defaultTagsJSON, &baselinesJSON); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Project{}, fmt.Errorf("%w: project %s", ErrNotFound, id)
		}
		return domain.Project{}, err
	}
	_ = json.Unmarshal([]byte(defaultTagsJSON), &p.DefaultTags)
	_ = json.Unmarshal([]byte(baselinesJSON), &p.Baselines)
	return p, nil
}

// SavedView represents a named run-list view with a query/filter snapshot.
type SavedView struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	Query     string `json:"query,omitempty"`
}

// ListSavedViews returns all saved views, optionally filtered by project.
func (s *Store) ListSavedViews(ctx context.Context, projectID string) ([]SavedView, error) {
	var rows *sql.Rows
	var err error
	if projectID != "" {
		rows, err = s.db.QueryContext(ctx,
			`SELECT id, COALESCE(saved_views,'[]') FROM projects WHERE id = ?`, projectID)
	} else {
		rows, err = s.db.QueryContext(ctx,
			`SELECT id, COALESCE(saved_views,'[]') FROM projects ORDER BY name`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SavedView
	for rows.Next() {
		var projID, rawViews string
		if err := rows.Scan(&projID, &rawViews); err != nil {
			return nil, err
		}
		// saved_views is stored as a JSON array of {id, name, query} objects.
		var views []map[string]string
		if err := json.Unmarshal([]byte(rawViews), &views); err != nil || len(views) == 0 {
			continue
		}
		for _, v := range views {
			out = append(out, SavedView{
				ID:        v["id"],
				ProjectID: projID,
				Name:      v["name"],
				Query:     v["query"],
			})
		}
	}
	if out == nil {
		out = []SavedView{}
	}
	return out, rows.Err()
}

// UpsertProject creates or updates a project row (used by import).
func (s *Store) UpsertProject(ctx context.Context, p domain.Project) error {
	tags, _ := json.Marshal(p.DefaultTags)
	baselines, _ := json.Marshal(p.Baselines)
	if len(p.DefaultTags) == 0 {
		tags = []byte("[]")
	}
	if len(p.Baselines) == 0 {
		baselines = []byte("[]")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO projects (id, name, path, description, default_tags, baselines,
		                      saved_views, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, '[]', strftime('%s','now'), strftime('%s','now'))
		ON CONFLICT(id) DO UPDATE SET
		    name        = excluded.name,
		    path        = COALESCE(excluded.path, projects.path),
		    description = COALESCE(NULLIF(excluded.description,''), projects.description),
		    updated_at  = excluded.updated_at`,
		p.ID, p.Name, p.Path, p.Description, string(tags), string(baselines))
	return err
}

// UpdateProject modifies a project's metadata.
func (s *Store) UpdateProject(ctx context.Context, id string, name *string, desc *string, defaultTags []string, baselines []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Check if project exists
	var existsID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM projects WHERE id = ?`, id).Scan(&existsID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: project %s", ErrNotFound, id)
		}
		return err
	}

	var sets []string
	var args []any
	if name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *name)
	}
	if desc != nil {
		sets = append(sets, "description = ?")
		args = append(args, *desc)
	}
	if defaultTags != nil {
		tagsBytes, _ := json.Marshal(defaultTags)
		sets = append(sets, "default_tags = ?")
		args = append(args, string(tagsBytes))
	}
	if baselines != nil {
		baselinesBytes, _ := json.Marshal(baselines)
		sets = append(sets, "baselines = ?")
		args = append(args, string(baselinesBytes))
	}

	if len(sets) > 0 {
		sets = append(sets, "updated_at = strftime('%s','now')")
		args = append(args, id)
		query := fmt.Sprintf("UPDATE projects SET %s WHERE id = ?", strings.Join(sets, ", "))
		_, err = tx.ExecContext(ctx, query, args...)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// SaveSavedView adds or updates a saved view under project.
func (s *Store) SaveSavedView(ctx context.Context, view SavedView) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var rawViews string
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(saved_views,'[]') FROM projects WHERE id = ?`, view.ProjectID).Scan(&rawViews)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: project %s", ErrNotFound, view.ProjectID)
		}
		return err
	}

	var views []map[string]string
	_ = json.Unmarshal([]byte(rawViews), &views)

	found := false
	for i, v := range views {
		if v["id"] == view.ID {
			views[i]["name"] = view.Name
			views[i]["query"] = view.Query
			found = true
			break
		}
	}
	if !found {
		views = append(views, map[string]string{
			"id":    view.ID,
			"name":  view.Name,
			"query": view.Query,
		})
	}

	newBytes, err := json.Marshal(views)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `UPDATE projects SET saved_views = ?, updated_at = strftime('%s','now') WHERE id = ?`, string(newBytes), view.ProjectID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// DeleteSavedView removes a saved view by searching all projects if projectID is not provided,
// or removing from the specific project if projectID is provided.
func (s *Store) DeleteSavedView(ctx context.Context, projectID, viewID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	type projViews struct {
		id    string
		views []map[string]string
	}
	var targets []projViews

	if projectID != "" {
		var rawViews string
		err = tx.QueryRowContext(ctx, `SELECT COALESCE(saved_views,'[]') FROM projects WHERE id = ?`, projectID).Scan(&rawViews)
		if err == nil {
			var views []map[string]string
			_ = json.Unmarshal([]byte(rawViews), &views)
			targets = append(targets, projViews{id: projectID, views: views})
		}
	} else {
		rows, err := tx.QueryContext(ctx, `SELECT id, COALESCE(saved_views,'[]') FROM projects`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var pid, rawViews string
			if err := rows.Scan(&pid, &rawViews); err != nil {
				return err
			}
			var views []map[string]string
			_ = json.Unmarshal([]byte(rawViews), &views)
			targets = append(targets, projViews{id: pid, views: views})
		}
	}

	found := false
	for _, t := range targets {
		var nextViews []map[string]string
		changed := false
		for _, v := range t.views {
			if v["id"] == viewID {
				changed = true
				found = true
				continue
			}
			nextViews = append(nextViews, v)
		}
		if changed {
			newBytes, err := json.Marshal(nextViews)
			if err != nil {
				return err
			}
			_, err = tx.ExecContext(ctx, `UPDATE projects SET saved_views = ?, updated_at = strftime('%s','now') WHERE id = ?`, string(newBytes), t.id)
			if err != nil {
				return err
			}
		}
	}

	if !found {
		return fmt.Errorf("%w: saved view %s", ErrNotFound, viewID)
	}

	return tx.Commit()
}

