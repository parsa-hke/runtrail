package cli

import (
	"context"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/parsa-hke/runtrail/internal/diff"
	"github.com/parsa-hke/runtrail/internal/domain"
	"github.com/spf13/cobra"
)

func diffCmd() *cobra.Command {
	var (
		onlyDiff bool
		baseline bool
	)

	cmd := &cobra.Command{
		Use:   "diff <run-a> <run-b> [<run-c> ...]",
		Short: "Diff two or more runs",
		Long: `Compare runs side-by-side: hyperparameters, metrics, environment, hardware, and data.

Examples:
  runtrail diff run-a1f3 run-b8e2
  runtrail diff run-a1f3 run-b8e2 --only-diff
  runtrail diff run-a run-b run-c      # N-way comparison
  runtrail diff run-b8e2 --baseline    # compare against the project baseline`,
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := openStore()
			if err != nil {
				return err
			}
			defer s.Close()

			ctx := context.Background()

			// Resolve IDs — support prefix matching.
			rawIDs := args
			if baseline {
				// Prepend the project baseline as "A".
				proj, perr := s.GetProject(ctx, globals.project)
				if perr != nil {
					return fmt.Errorf("resolving baseline: %w", perr)
				}
				if len(proj.Baselines) == 0 {
					return fmt.Errorf("project %q has no baseline set; pin one in the UI or use runtrail show", proj.ID)
				}
				rawIDs = append([]string{proj.Baselines[0]}, rawIDs...)
			}

			if len(rawIDs) < 2 {
				return fmt.Errorf("diff requires at least 2 run IDs (got %d)", len(rawIDs))
			}

			runs := make([]domain.Run, 0, len(rawIDs))
			for _, raw := range rawIDs {
				id, rerr := s.ResolveRunID(ctx, raw)
				if rerr != nil {
					return rerr
				}
				r, rerr := s.GetRun(ctx, id)
				if rerr != nil {
					return rerr
				}
				runs = append(runs, r)
			}

			report := diff.Compute(runs)

			if globals.jsonOut {
				return writeJSON(os.Stdout, report)
			}

			return printDiff(report, onlyDiff)
		},
	}

	cmd.Flags().BoolVar(&onlyDiff, "only-diff", false, "hide identical fields")
	cmd.Flags().BoolVar(&baseline, "baseline", false, "use the project baseline as run A")
	return cmd
}

// printDiff renders a DiffReport to stdout.
func printDiff(report diff.DiffReport, onlyDiff bool) error {
	runs := report.Runs
	n := len(runs)

	// Labels: A, B, C, …
	labels := make([]string, n)
	for i := range runs {
		labels[i] = string(rune('A' + i))
	}

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)

	// Header.
	fmt.Fprintln(tw, "")
	header := "RUN\t"
	for i, r := range runs {
		header += fmt.Sprintf("[%s] %s\t", labels[i], r.ID)
	}
	fmt.Fprintln(tw, header)
	header2 := "NAME\t"
	for _, r := range runs {
		header2 += truncate(r.Name, 28) + "\t"
	}
	fmt.Fprintln(tw, header2)
	status := "STATUS\t"
	for _, r := range runs {
		status += string(r.Status) + "\t"
	}
	fmt.Fprintln(tw, status)
	dur := "DURATION\t"
	for _, r := range runs {
		dur += humanDuration(r.DurationS) + "\t"
	}
	fmt.Fprintln(tw, dur)
	_ = tw.Flush()

	// Insight (2-run only).
	if n == 2 && report.Insight.DeltaMetric != "" {
		fmt.Println()
		ins := report.Insight
		fmt.Println("─── Insight ─────────────────────────────────────────")
		if ins.Winner != "" && ins.Winner != "tie" {
			fmt.Printf("  Winner      [%s]\n", ins.Winner)
		} else if ins.Winner == "tie" {
			fmt.Println("  Winner      (tie)")
		}
		if ins.DeltaMetric != "" {
			sign := "+"
			if ins.DeltaValue < 0 {
				sign = ""
			}
			fmt.Printf("  %s    %s%s (%.1f%%)\n", ins.DeltaMetric, sign, fmtFloat(ins.DeltaValue), ins.DeltaPct)
		}
		if len(ins.Likely) > 0 {
			fmt.Printf("  Likely      %s\n", ins.Likely[0])
			for _, l := range ins.Likely[1:] {
				fmt.Printf("              %s\n", l)
			}
			fmt.Printf("  Confidence  %.0f%%  (heuristic — verify by isolating one change at a time)\n", ins.Confidence*100)
		}
	}

	// Hyperparameters.
	fmt.Println()
	fmt.Println("─── Hyperparameters ─────────────────────────────────")
	changedKeys := sortedStringKeys(report.HParams.Changed)
	sameKeys := sortedStringKeys(report.HParams.Same)
	onlyInKeys := sortedStringKeys(report.HParams.OnlyIn)

	if len(changedKeys)+len(onlyInKeys) == 0 && !onlyDiff {
		fmt.Println("  (identical)")
	}
	if len(changedKeys) > 0 || len(onlyInKeys) > 0 {
		tw2 := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		header := "  PARAM\t"
		for _, l := range labels {
			header += "[" + l + "]\t"
		}
		fmt.Fprintln(tw2, header)
		for _, k := range changedKeys {
			vals := report.HParams.Changed[k]
			line := "  " + k + "\t"
			for _, v := range vals {
				if v == nil {
					line += "—\t"
				} else {
					line += fmt.Sprintf("%v\t", v)
				}
			}
			fmt.Fprintln(tw2, "* "+strings.TrimPrefix(line, "  "))
		}
		for _, k := range onlyInKeys {
			vals := report.HParams.Changed[k]
			line := "  " + k + "\t"
			for _, v := range vals {
				if v == nil {
					line += "—\t"
				} else {
					line += fmt.Sprintf("%v\t", v)
				}
			}
			fmt.Fprintln(tw2, "+ "+strings.TrimPrefix(line, "  "))
		}
		_ = tw2.Flush()
	}
	if !onlyDiff && len(sameKeys) > 0 {
		tw3 := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		for _, k := range sameKeys {
			line := "  " + k + "\t"
			for range labels {
				line += fmt.Sprintf("%v\t", report.HParams.Same[k])
			}
			fmt.Fprintln(tw3, line)
		}
		_ = tw3.Flush()
	}

	// Final metrics.
	fmt.Println()
	fmt.Println("─── Final metrics ───────────────────────────────────")
	if len(report.Metrics.Rows) == 0 {
		fmt.Println("  (none)")
	} else {
		tw4 := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		mhdr := "  METRIC\t"
		for _, l := range labels {
			mhdr += "[" + l + "]\t"
		}
		if n == 2 {
			mhdr += "DELTA\t"
		}
		fmt.Fprintln(tw4, mhdr)
		for _, row := range report.Metrics.Rows {
			if onlyDiff && row.BestIdx < 0 {
				continue
			}
			line := "  " + row.Name + "\t"
			for i, v := range row.Values {
				cell := fmtFloat(v)
				if i == row.BestIdx {
					cell = "▲ " + cell
				}
				line += cell + "\t"
			}
			if n == 2 && !math.IsNaN(row.Delta) {
				sign := "+"
				if row.Delta < 0 {
					sign = ""
				}
				line += sign + fmtFloat(row.Delta) + "\t"
			}
			fmt.Fprintln(tw4, line)
		}
		_ = tw4.Flush()
	}

	// Env diff.
	envChanged := sortedStringKeys(report.Env.Changed)
	envSame := sortedStringKeys(report.Env.Same)
	if len(envChanged) > 0 || (!onlyDiff && len(envSame) > 0) {
		fmt.Println()
		fmt.Println("─── Environment ─────────────────────────────────────")
		tw5 := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		ehdr := "  KEY\t"
		for _, l := range labels {
			ehdr += "[" + l + "]\t"
		}
		fmt.Fprintln(tw5, ehdr)
		for _, k := range envChanged {
			line := "* " + k + "\t"
			for _, v := range report.Env.Changed[k] {
				line += v + "\t"
			}
			fmt.Fprintln(tw5, line)
		}
		if !onlyDiff {
			for _, k := range envSame {
				line := "  " + k + "\t"
				for range labels {
					line += report.Env.Same[k] + "\t"
				}
				fmt.Fprintln(tw5, line)
			}
		}
		_ = tw5.Flush()
	}

	// Hardware diff.
	hwChanged := sortedStringKeys(report.Hardware.Changed)
	hwSame := sortedStringKeys(report.Hardware.Same)
	if len(hwChanged) > 0 || (!onlyDiff && len(hwSame) > 0) {
		fmt.Println()
		fmt.Println("─── Hardware ────────────────────────────────────────")
		tw6 := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		hwhdr := "  KEY\t"
		for _, l := range labels {
			hwhdr += "[" + l + "]\t"
		}
		fmt.Fprintln(tw6, hwhdr)
		for _, k := range hwChanged {
			line := "* " + k + "\t"
			for _, v := range report.Hardware.Changed[k] {
				line += v + "\t"
			}
			fmt.Fprintln(tw6, line)
		}
		if !onlyDiff {
			for _, k := range hwSame {
				line := "  " + k + "\t"
				for range labels {
					line += report.Hardware.Same[k] + "\t"
				}
				fmt.Fprintln(tw6, line)
			}
		}
		_ = tw6.Flush()
	}

	// Data diff.
	if !report.Data.Same || !report.Data.SameHash {
		fmt.Println()
		fmt.Println("─── Dataset ─────────────────────────────────────────")
		tw7 := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		dhdr := "  \t"
		for _, l := range labels {
			dhdr += "[" + l + "]\t"
		}
		fmt.Fprintln(tw7, dhdr)
		line := "  dataset\t"
		for _, v := range report.Data.Values {
			if v == "" {
				v = "—"
			}
			line += v + "\t"
		}
		fmt.Fprintln(tw7, line)
		hline := "  hash\t"
		for _, v := range report.Data.Hashes {
			if v == "" {
				v = "—"
			} else if len(v) > 12 {
				v = v[:12]
			}
			hline += v + "\t"
		}
		fmt.Fprintln(tw7, hline)
		_ = tw7.Flush()
	}

	fmt.Println()
	fmt.Println("  * = differs between runs   + = only in some runs")
	fmt.Println()
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func fmtFloat(f float64) string {
	if math.IsNaN(f) {
		return "—"
	}
	if math.IsInf(f, 1) {
		return "+∞"
	}
	if math.IsInf(f, -1) {
		return "-∞"
	}
	// Use %g for compact representation.
	s := fmt.Sprintf("%.4g", f)
	return s
}

func sortedStringKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
