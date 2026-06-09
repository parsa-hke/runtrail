package cli

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/runtrail/runtrail/internal/server"
	"github.com/runtrail/runtrail/internal/webui"
	"github.com/spf13/cobra"
)

func uiCmd() *cobra.Command {
	var (
		port      int
		host      string
		mutations bool
		openFlag  bool
	)

	cmd := &cobra.Command{
		Use:   "ui",
		Short: "Launch the local web UI",
		Long: `Start a local HTTP server and open the runtrail UI in a browser.

The server is read-only by default. Pass --mutations to allow editing
notes, tags, and deleting runs from the UI.

Examples:
  runtrail ui
  runtrail ui --port 8080
  runtrail ui --mutations`,
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := openStore()
			if err != nil {
				return err
			}
			defer s.Close()

			addr := net.JoinHostPort(host, strconv.Itoa(port))
			ln, err := net.Listen("tcp", addr)
			if err != nil {
				return fmt.Errorf("listen: %w", err)
			}
			actual := ln.Addr().(*net.TCPAddr)
			url := fmt.Sprintf("http://%s:%d", host, actual.Port)

			handler := server.New(s, server.Options{
				Mutations: mutations,
				StaticFS:  webui.FS(),
			})
			srv := &http.Server{
				Handler:           handler,
				ReadHeaderTimeout: 10 * time.Second,
			}

			mode := "read-only"
			if mutations {
				mode = "MUTATIONS ON"
			}
			fmt.Printf("runtrail: serving on %s  (%s)\n", url, mode)

			if openFlag {
				go func() {
					time.Sleep(150 * time.Millisecond)
					_ = openBrowser(url)
				}()
			}

			// Graceful shutdown on Ctrl-C / SIGTERM.
			ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer cancel()

			errCh := make(chan error, 1)
			go func() {
				err := srv.Serve(ln)
				if err != nil && !errors.Is(err, http.ErrServerClosed) {
					errCh <- err
				}
				close(errCh)
			}()

			select {
			case <-ctx.Done():
				fmt.Println("\nshutting down…")
				shutdownCtx, scancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer scancel()
				return srv.Shutdown(shutdownCtx)
			case err := <-errCh:
				return err
			}
		},
	}

	cmd.Flags().IntVar(&port, "port", 0, "port to listen on (0 = pick a free port)")
	cmd.Flags().StringVar(&host, "host", "127.0.0.1", "address to bind to")
	cmd.Flags().BoolVar(&mutations, "mutations", false, "enable write operations from the UI")
	cmd.Flags().BoolVar(&openFlag, "open", true, "open the UI in the default browser")
	return cmd
}

func openBrowser(url string) error {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	default:
		cmd = "xdg-open"
		args = []string{url}
	}
	return exec.Command(cmd, args...).Start()
}
