// Package cli wires up all cobra subcommands.
package cli

import (
	"fmt"
	"os"

	"github.com/parsa-hke/runtrail/internal/version"
	"github.com/spf13/cobra"
)

// globalFlags are shared across all subcommands.
type globalFlags struct {
	home    string
	project string
	verbose bool
	jsonOut bool
}

var globals globalFlags

// Root returns the root cobra command.
func Root() *cobra.Command {
	root := &cobra.Command{
		Use:   "runtrail",
		Short: "Local-first experiment tracker for ML researchers",
		Long: `runtrail — local-first experiment tracker for solo ML researchers.

Everything is stored in ~/.runtrail/ as SQLite + Parquet files.
No account, no cloud, no network calls required.

Quick start:
  pip install runtrail          # install the Python SDK
  runtrail ui                   # launch the local web UI

Documentation: https://github.com/parsa-hke/runtrail`,
		Version:          version.Version,
		SilenceUsage:     true,
		SilenceErrors:    true,
		TraverseChildren: true,
	}

	// Persistent flags available on every subcommand.
	root.PersistentFlags().StringVar(&globals.home, "home", "", "runtrail data directory (default: $RUNTRAIL_HOME or ~/.runtrail)")
	root.PersistentFlags().StringVarP(&globals.project, "project", "p", "", "project name (default: auto-detected from CWD)")
	root.PersistentFlags().BoolVarP(&globals.verbose, "verbose", "v", false, "enable verbose/trace logging")
	root.PersistentFlags().BoolVar(&globals.jsonOut, "json", false, "output as JSON")

	// Register subcommands (stubs for now — implemented in later phases).
	root.AddCommand(
		lsCmd(),
		showCmd(),
		diffCmd(),
		rmCmd(),
		exportCmd(),
		importCmd(),
		uiCmd(),
	)

	return root
}

// Execute runs the root command and exits on error.
func Execute() {
	if err := Root().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "runtrail:", err)
		os.Exit(1)
	}
}
