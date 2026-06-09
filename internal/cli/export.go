package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/parsa-hke/runtrail/internal/config"
	"github.com/parsa-hke/runtrail/internal/domain"
	"github.com/spf13/cobra"
)

// Manifest is the metadata file every export directory carries.
// Bumping ManifestVersion is a breaking change to the export format.
type Manifest struct {
	ManifestVersion int               `json:"manifest_version"`
	ExportedAt      time.Time         `json:"exported_at"`
	Run             domain.Run        `json:"run"`
	Project         domain.Project    `json:"project"`
	Artifacts       []domain.Artifact `json:"artifacts"`
	Packages        []domain.Package  `json:"packages"`
}

const manifestVersion = 1

func exportCmd() *cobra.Command {
	var output string

	cmd := &cobra.Command{
		Use:   "export <run>",
		Short: "Export a run as a portable directory",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := openStore()
			if err != nil {
				return err
			}
			defer s.Close()

			ctx := context.Background()
			run, err := s.GetRun(ctx, args[0])
			if err != nil {
				return err
			}
			project, err := s.GetProject(ctx, run.ProjectID)
			if err != nil {
				return err
			}
			arts, err := s.Artifacts(ctx, run.ID)
			if err != nil {
				return err
			}
			pkgs, err := s.Packages(ctx, run.ID)
			if err != nil {
				return err
			}

			dest := output
			if dest == "" {
				dest = run.ID + "-export"
			}
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return err
			}

			// 1. Copy the entire run directory (meta, jsonl, parquet, source, logs).
			runSrc := config.RunDir(s.Home(), run.ProjectID, run.ID)
			runDst := filepath.Join(dest, "run")
			if err := copyDir(runSrc, runDst); err != nil {
				return fmt.Errorf("copy run dir: %w", err)
			}

			// 2. Resolve artifacts from the content-addressed blob store. We copy
			//    them under artifacts/<sha> and keep their declared name in the
			//    manifest for re-attachment on import.
			if len(arts) > 0 {
				artDst := filepath.Join(dest, "artifacts")
				if err := os.MkdirAll(artDst, 0o755); err != nil {
					return err
				}
				for _, a := range arts {
					blob := config.ArtifactPath(s.Home(), run.ProjectID, a.SHA256)
					if _, err := os.Stat(blob); err != nil {
						fmt.Fprintf(os.Stderr, "warning: missing artifact blob %s: %v\n", a.SHA256, err)
						continue
					}
					if err := copyFile(blob, filepath.Join(artDst, a.SHA256)); err != nil {
						return fmt.Errorf("copy artifact %s: %w", a.Name, err)
					}
				}
			}

			// 3. Write the manifest.
			man := Manifest{
				ManifestVersion: manifestVersion,
				ExportedAt:      time.Now().UTC(),
				Run:             run,
				Project:         project,
				Artifacts:       arts,
				Packages:        pkgs,
			}
			manBytes, err := json.MarshalIndent(man, "", "  ")
			if err != nil {
				return err
			}
			if err := os.WriteFile(filepath.Join(dest, "MANIFEST.json"), manBytes, 0o644); err != nil {
				return err
			}

			// 4. Friendly readme.
			readme := fmt.Sprintf(`# runtrail export — %s

Run "%s" from project "%s".

Restore with:

    runtrail import %s
`, run.ID, run.Name, run.ProjectID, dest)
			_ = os.WriteFile(filepath.Join(dest, "README.md"), []byte(readme), 0o644)

			if globals.jsonOut {
				return writeJSON(os.Stdout, map[string]any{
					"run_id": run.ID,
					"output": dest,
				})
			}
			fmt.Printf("exported %s to %s\n", run.ID, dest)
			return nil
		},
	}
	cmd.Flags().StringVarP(&output, "output", "o", "", "output directory (default: <run-id>-export)")
	return cmd
}
