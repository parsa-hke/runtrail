// Package domain defines the pure types shared across CLI, store, and server.
package domain

import "time"

// Status is the lifecycle state of a run.
type Status string

const (
	StatusRunning Status = "running"
	StatusDone    Status = "done"
	StatusFailed  Status = "failed"
	StatusKilled  Status = "killed"
)

// Run is the denormalized view of a single training run.
type Run struct {
	ID          string             `json:"id"`
	ProjectID   string             `json:"project_id"`
	Name        string             `json:"name"`
	Status      Status             `json:"status"`
	StartedAt   time.Time          `json:"started_at"`
	EndedAt     *time.Time         `json:"ended_at,omitempty"`
	DurationS   float64            `json:"duration_s"`
	User        string             `json:"user,omitempty"`
	Host        string             `json:"host,omitempty"`
	PID         int                `json:"pid,omitempty"`
	Branch      string             `json:"branch,omitempty"`
	Commit      string             `json:"commit,omitempty"`
	Dirty       bool               `json:"dirty"`
	Cmd         string             `json:"cmd,omitempty"`
	ExitCode    int                `json:"exit_code"`
	Error       string             `json:"error,omitempty"`
	Notes       string             `json:"notes,omitempty"`
	Pinned      bool               `json:"pinned"`
	Tags        []string           `json:"tags"`
	HParams     map[string]any     `json:"hparams"`
	Final       map[string]float64 `json:"final"`
	Hardware    map[string]any     `json:"hardware,omitempty"`
	Env         map[string]any     `json:"env,omitempty"`
	Dataset     string             `json:"dataset,omitempty"`
	DatasetHash string             `json:"dataset_hash,omitempty"`
}

// Project is a logical collection of runs.
type Project struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Path        string   `json:"path,omitempty"`
	Description string   `json:"description,omitempty"`
	DefaultTags []string `json:"default_tags"`
	Baselines   []string `json:"baselines"`
}

// Artifact describes a file attached to a run.
type Artifact struct {
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	SizeBytes int64     `json:"size_bytes"`
	SHA256    string    `json:"sha256"`
	CreatedAt time.Time `json:"created_at"`
}

// Package is one entry from pip freeze, per run.
type Package struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// RunFilter is the parameter set for ListRuns.
type RunFilter struct {
	ProjectID string
	Status    string
	Tag       string
	Limit     int
}

// RunPatch is the set of fields that can be mutated on a run.
type RunPatch struct {
	Name   *string   `json:"name,omitempty"`
	Notes  *string   `json:"notes,omitempty"`
	Tags   []string  `json:"tags,omitempty"`
	Pinned *bool     `json:"pinned,omitempty"`
}

