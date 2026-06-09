// Package config resolves the runtrail home directory and project context.
package config

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Home returns the runtrail data directory. Precedence: explicit override >
// $RUNTRAIL_HOME > ~/.runtrail.
func Home(override string) (string, error) {
	if override != "" {
		return expand(override)
	}
	if v := os.Getenv("RUNTRAIL_HOME"); v != "" {
		return expand(v)
	}
	h, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(h, ".runtrail"), nil
}

// DBPath returns the path to runtrail.db inside home.
func DBPath(home string) string { return filepath.Join(home, "runtrail.db") }

// ProjectDir returns ~/.runtrail/projects/<id>.
func ProjectDir(home, projectID string) string {
	return filepath.Join(home, "projects", projectID)
}

// RunDir returns ~/.runtrail/projects/<proj>/runs/<run>.
func RunDir(home, projectID, runID string) string {
	return filepath.Join(ProjectDir(home, projectID), "runs", runID)
}

// ArtifactPath returns the content-addressed blob path for sha.
func ArtifactPath(home, projectID, sha string) string {
	if len(sha) < 4 {
		return ""
	}
	return filepath.Join(ProjectDir(home, projectID), "artifacts", sha[:2], sha[2:4], sha)
}

var slugRE = regexp.MustCompile(`[^a-z0-9-]+`)

// Slugify produces a project slug matching the rules in SPEC §4.1.
func Slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = slugRE.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 64 {
		s = s[:64]
	}
	return s
}

// ErrNoProject indicates no project could be auto-detected.
var ErrNoProject = errors.New("no project specified and none auto-detected")

func expand(p string) (string, error) {
	if strings.HasPrefix(p, "~") {
		h, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		p = filepath.Join(h, strings.TrimPrefix(p, "~"))
	}
	return filepath.Abs(p)
}
