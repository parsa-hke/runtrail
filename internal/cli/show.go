package cli

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/spf13/cobra"
)

func showCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show <run>",
		Short: "Show details of a run",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := openStore()
			if err != nil {
				return err
			}
			defer s.Close()

			ctx := context.Background()
			r, err := s.GetRun(ctx, args[0])
			if err != nil {
				return err
			}
			arts, err := s.Artifacts(ctx, r.ID)
			if err != nil {
				return err
			}

			if globals.jsonOut {
				return writeJSON(os.Stdout, map[string]any{
					"run":       r,
					"artifacts": arts,
				})
			}

			fmt.Printf("Run        %s\n", r.ID)
			fmt.Printf("Name       %s\n", r.Name)
			fmt.Printf("Project    %s\n", r.ProjectID)
			fmt.Printf("Status     %s\n", r.Status)
			fmt.Printf("Started    %s\n", r.StartedAt.Format("2006-01-02 15:04:05"))
			if r.EndedAt != nil {
				fmt.Printf("Ended      %s\n", r.EndedAt.Format("2006-01-02 15:04:05"))
			}
			fmt.Printf("Duration   %s\n", humanDuration(r.DurationS))
			if r.User != "" {
				fmt.Printf("User       %s@%s\n", r.User, r.Host)
			}
			if r.PID != 0 {
				fmt.Printf("PID        %d\n", r.PID)
			}
			if r.Cmd != "" {
				fmt.Printf("Command    %s\n", r.Cmd)
			}
			if r.Commit != "" {
				dirty := ""
				if r.Dirty {
					dirty = " (dirty)"
				}
				fmt.Printf("Git        %s @ %s%s\n", r.Branch, r.Commit, dirty)
			}
			if r.Error != "" {
				fmt.Printf("Error      %s\n", r.Error)
			}
			if r.Notes != "" {
				fmt.Printf("Notes      %s\n", r.Notes)
			}
			if len(r.Tags) > 0 {
				fmt.Printf("Tags       %s\n", strings.Join(r.Tags, ", "))
			}
			if len(r.HParams) > 0 {
				fmt.Println("\nHyperparameters:")
				printKVMap(r.HParams)
			}
			if len(r.Final) > 0 {
				fmt.Println("\nFinal metrics:")
				keys := make([]string, 0, len(r.Final))
				for k := range r.Final {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					fmt.Printf("  %-20s %v\n", k, r.Final[k])
				}
			}
			if len(arts) > 0 {
				fmt.Printf("\nArtifacts (%d):\n", len(arts))
				for _, a := range arts {
					fmt.Printf("  %-32s %-10s %d bytes  sha256:%s\n",
						a.Name, a.Type, a.SizeBytes, a.SHA256[:12])
				}
			}
			return nil
		},
	}
}

func printKVMap(m map[string]any) {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("  %-20s %v\n", k, m[k])
	}
}
