package cli

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

func rmCmd() *cobra.Command {
	var force bool

	cmd := &cobra.Command{
		Use:   "rm <run>",
		Short: "Delete a run and its files",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := openStore()
			if err != nil {
				return err
			}
			defer s.Close()

			ctx := context.Background()
			runID, err := s.ResolveRunID(ctx, args[0])
			if err != nil {
				return err
			}
			if !force {
				fmt.Fprintf(os.Stderr, "Delete run %s? [y/N] ", runID)
				rd := bufio.NewReader(os.Stdin)
				line, _ := rd.ReadString('\n')
				if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(line)), "y") {
					fmt.Println("aborted")
					return nil
				}
			}
			if _, err := s.DeleteRun(ctx, runID); err != nil {
				return err
			}
			fmt.Printf("deleted %s\n", runID)
			return nil
		},
	}
	cmd.Flags().BoolVar(&force, "force", false, "skip confirmation prompt")
	return cmd
}
