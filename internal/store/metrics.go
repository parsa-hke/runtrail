package store

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/runtrail/runtrail/internal/config"
)

// MetricRow is one wide-format row, one map per (step, wall_ms) tuple.
type MetricRow struct {
	Step   int64              `json:"step"`
	WallMS int64              `json:"wall_ms"`
	Values map[string]float64 `json:"values"`
}

// ReadMetrics returns the wide-format metric rows for a run. If `names` is
// non-empty, the values map is filtered to those keys. Falls back from
// Parquet → JSONL.
func (s *Store) ReadMetrics(ctx context.Context, runID string, names []string) ([]MetricRow, error) {
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, err
	}
	dir := config.RunDir(s.home, projID, runID)
	jsonlPath := filepath.Join(dir, "metrics.jsonl")
	if _, err := os.Stat(jsonlPath); err == nil {
		return readMetricsJSONL(jsonlPath, names)
	}
	parquet := filepath.Join(dir, "metrics.parquet")
	if _, err := os.Stat(parquet); err == nil {
		return readMetricsParquet(parquet, names)
	}
	return []MetricRow{}, nil
}

// ReadResources returns the resource samples for a run as wide rows.
func (s *Store) ReadResources(ctx context.Context, runID string) ([]map[string]any, error) {
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(config.RunDir(s.home, projID, runID), "resources.jsonl")
	return readJSONLRaw(path)
}

// ReadEvents reads events.jsonl entries with wall_ms > since.
func (s *Store) ReadEvents(ctx context.Context, runID string, since int64) ([]map[string]any, error) {
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(config.RunDir(s.home, projID, runID), "events.jsonl")
	rows, err := readJSONLRaw(path)
	if err != nil {
		return nil, err
	}
	if since <= 0 {
		return rows, nil
	}
	out := rows[:0]
	for _, r := range rows {
		if wm, ok := r["wall_ms"].(float64); ok && int64(wm) > since {
			out = append(out, r)
		}
	}
	return out, nil
}

// ReadLogTail returns up to `tail` lines from the end of stdout/stderr.
func (s *Store) ReadLogTail(ctx context.Context, runID, stream string, tail int) ([]string, error) {
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, err
	}
	if stream != "stdout" && stream != "stderr" {
		return nil, errors.New("stream must be stdout or stderr")
	}
	path := filepath.Join(config.RunDir(s.home, projID, runID), stream+".log")
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		return nil, err
	}
	defer f.Close()
	lines := []string{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if tail > 0 && len(lines) > tail {
		lines = lines[len(lines)-tail:]
	}
	return lines, nil
}

// OpenArtifact returns a ReadCloser for the named artifact's blob + its size.
func (s *Store) OpenArtifact(ctx context.Context, runID, name string) (io.ReadCloser, int64, string, error) {
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, 0, "", err
	}
	var sha string
	var size int64
	row := s.db.QueryRowContext(ctx,
		`SELECT sha256, size_bytes FROM artifacts WHERE run_id = ? AND name = ?`, runID, name)
	if err := row.Scan(&sha, &size); err != nil {
		return nil, 0, "", err
	}
	path := config.ArtifactPath(s.home, projID, sha)
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, sha, err
	}
	return f, size, sha, nil
}

// SourceTree returns relative file paths in the run's snapshot directory.
func (s *Store) SourceTree(ctx context.Context, runID string) ([]string, error) {
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, err
	}
	root := filepath.Join(config.RunDir(s.home, projID, runID), "source")
	var out []string
	if _, err := os.Stat(root); errors.Is(err, os.ErrNotExist) {
		return out, nil
	} else if err != nil {
		return nil, err
	}
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		out = append(out, rel)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}

// SourceFile returns the contents of a snapshot source file.
func (s *Store) SourceFile(ctx context.Context, runID, relPath string) ([]byte, error) {
	if strings.Contains(relPath, "..") {
		return nil, errors.New("invalid path")
	}
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, err
	}
	full := filepath.Join(config.RunDir(s.home, projID, runID), "source", filepath.FromSlash(relPath))
	return os.ReadFile(full)
}

// ReadMeta returns the parsed meta.json for a run (raw map).
func (s *Store) ReadMeta(ctx context.Context, runID string) (map[string]any, error) {
	projID, err := s.runProjectID(ctx, runID)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(config.RunDir(s.home, projID, runID), "meta.json"))
	if err != nil {
		return nil, err
	}
	var m map[string]any
	return m, json.Unmarshal(b, &m)
}

// runProjectID returns the project_id for a run, ErrNotFound if missing.
func (s *Store) runProjectID(ctx context.Context, runID string) (string, error) {
	var pid string
	err := s.db.QueryRowContext(ctx, `SELECT project_id FROM runs WHERE id = ?`, runID).Scan(&pid)
	if err != nil {
		return "", err
	}
	return pid, nil
}

func readMetricsJSONL(path string, names []string) ([]MetricRow, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []MetricRow{}, nil
		}
		return nil, err
	}
	defer f.Close()

	nameSet := map[string]struct{}{}
	for _, n := range names {
		nameSet[n] = struct{}{}
	}

	var rows []MetricRow
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue
		}
		row := MetricRow{Values: map[string]float64{}}
		for k, v := range raw {
			switch k {
			case "step":
				row.Step = toInt64(v)
			case "wall_ms":
				row.WallMS = toInt64(v)
			default:
				if len(nameSet) > 0 {
					if _, ok := nameSet[k]; !ok {
						continue
					}
				}
				if f, ok := toFloat(v); ok {
					row.Values[k] = f
				}
			}
		}
		rows = append(rows, row)
	}
	return rows, sc.Err()
}

func readJSONLRaw(path string) ([]map[string]any, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	defer f.Close()
	out := []map[string]any{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			continue
		}
		out = append(out, m)
	}
	return out, sc.Err()
}

func toInt64(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	}
	return 0
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}
