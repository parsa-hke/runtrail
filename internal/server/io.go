package server

import "io"

// copyTo wraps io.Copy so callers don't need to import "io" in the same file.
func copyTo(dst io.Writer, src io.Reader) (int64, error) { return io.Copy(dst, src) }
