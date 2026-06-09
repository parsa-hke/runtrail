package cli

import (
	"context"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/parsa-hke/runtrail/internal/domain"
	"github.com/spf13/cobra"
)

func lsCmd() *cobra.Command {
	var (
		status string
		tag    string
		limit  int
	)

	cmd := &cobra.Command{
		Use:   "ls",
		Short: "List recent runs",
		Long: `List runs in the current project, newest first.

Examples:
  runtrail ls
  runtrail ls --status done
  runtrail ls --tag baseline --limit 20`,
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := openStore()
			if err != nil {
				return err
			}
			defer s.Close()

			runs, err := s.ListRuns(context.Background(), domain.RunFilter{
				ProjectID: globals.project,
				Status:    status,
				Tag:       tag,
				Limit:     limit,
			})
			if err != nil {
				return err
			}

			if globals.jsonOut {
				return writeJSON(os.Stdout, runs)
			}
			if len(runs) == 0 {
				fmt.Println("no runs")
				return nil
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(tw, "ID\tSTATUS\tNAME\tPROJECT\tDURATION\tSTARTED")
			for _, r := range runs {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\n",
					r.ID, r.Status, truncate(r.Name, 32), r.ProjectID,
					humanDuration(r.DurationS), humanAgo(r.StartedAt))
			}
			return tw.Flush()
		},
	}

	cmd.Flags().StringVar(&status, "status", "", "filter by status: running|done|failed|killed")
	cmd.Flags().StringVar(&tag, "tag", "", "filter by tag")
	cmd.Flags().IntVar(&limit, "limit", 50, "maximum number of runs to show")
	return cmd
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n < 1 {
		return ""
	}
	return s[:n-1] + "…"
}
