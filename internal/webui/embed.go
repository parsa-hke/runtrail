// Package webui embeds the built frontend assets (web/dist) into the binary.
//
// The dist directory is created by `pnpm --filter web build` (or the
// equivalent npm/yarn command). A placeholder index.html is checked in so
// `go build` works before the frontend has ever been built.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var raw embed.FS

// FS returns the dist subtree as an fs.FS rooted at /.
func FS() fs.FS {
	sub, err := fs.Sub(raw, "dist")
	if err != nil {
		// embed.FS guarantees the path exists at build time; panicking here
		// indicates a programmer error (the //go:embed directive changed).
		panic(err)
	}
	return sub
}
