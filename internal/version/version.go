// Package version holds the build-time version string.
package version

// Version is the current runtrail release. Set at build time via:
//
//	go build -ldflags="-X github.com/runtrail/runtrail/internal/version.Version=0.1.0"
var Version = "dev"
