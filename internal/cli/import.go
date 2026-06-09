package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/runtrail/runtrail/internal/config"
	"github.com/runtrail/runtrail/internal/store"
	"github.com/spf13/cobra"
)

func importCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "import <path>",
		Short: "Import an exported run directory",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]
			manBytes, err := os.ReadFile(filepath.Join(path, "MANIFEST.json"))
			if err != nil {
				return fmt.Errorf("read MANIFEST.json: %w", err)
			}
			var man Manifest
			if err := json.Unmarshal(manBytes, &man); err != nil {
				return fmt.Errorf("parse manifest: %w", err)
			}
			if man.ManifestVersion != manifestVersion {
				return fmt.Errorf("unsupported manifest version %d (expected %d)",
					man.ManifestVersion, manifestVersion)
			}

			s, err := openStore()
			if err != nil {
				return err
			}
			defer s.Close()
			ctx := context.Background()

			// Ensure the project exists locally.
			if err := s.UpsertProject(ctx, man.Project); err != nil {
				return fmt.Errorf("upsert project: %w", err)
			}

			// Resolve run id collisions by re-hashing while preserving the run dir.
			runID := man.Run.ID
			for {
				exists, err := s.RunExists(ctx, runID)
				if err != nil {
					return err
				}
				if !exists {
					break
				}
				runID = "run-" + randomHex(8)
			}
			man.Run.ID = runID

			// Copy the embedded run dir into the local store.
			runSrc := filepath.Join(path, "run")
			runDst := config.RunDir(s.Home(), man.Run.ProjectID, runID)
			if err := os.MkdirAll(filepath.Dir(runDst), 0o755); err != nil {
				return err
			}
			if err := copyDir(runSrc, runDst); err != nil {
				return fmt.Errorf("copy run dir: %w", err)
			}

			// Restore artifact blobs into the content-addressed store.
			artSrc := filepath.Join(path, "artifacts")
			if _, err := os.Stat(artSrc); err == nil {
				for _, a := range man.Artifacts {
					src := filepath.Join(artSrc, a.SHA256)
					if _, err := os.Stat(src); err != nil {
						fmt.Fprintf(os.Stderr, "warning: skipping missing artifact %s: %v\n", a.SHA256, err)
						continue
					}
					dst := config.ArtifactPath(s.Home(), man.Run.ProjectID, a.SHA256)
					if _, err := os.Stat(dst); err == nil {
						continue // blob already present (dedup)
					}
					if err := copyFile(src, dst); err != nil {
						return fmt.Errorf("copy artifact %s: %w", a.SHA256, err)
					}
				}
			}

			if err := s.InsertImportedRun(ctx, store.RunWriteOptions{
				Run:       man.Run,
				Artifacts: man.Artifacts,
				Packages:  man.Packages,
			}); err != nil {
				return err
			}

			if globals.jsonOut {
				return writeJSON(os.Stdout, map[string]any{
					"run_id":     runID,
					"project_id": man.Run.ProjectID,
				})
			}
			fmt.Printf("imported %s into project %s\n", runID, man.Run.ProjectID)
			return nil
		},
	}
}

func randomHex(n int) string {
	b := make([]byte, n/2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
