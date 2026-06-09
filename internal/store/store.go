// Package store provides read/write access to the runtrail SQLite database
// and on-disk file layout. It is the Go-side counterpart to sdk/runtrail/_store.py.
package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"time"

	"github.com/runtrail/runtrail/internal/config"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// SchemaVersion is the schema revision this binary expects.
const SchemaVersion = 1

// Store wraps the SQLite DB and the runtrail home directory.
type Store struct {
	db   *sql.DB
	home string
}

// Open opens (creating if needed) the runtrail DB rooted at home.
func Open(home string) (*Store, error) {
	if err := os.MkdirAll(home, 0o755); err != nil {
		return nil, fmt.Errorf("create home: %w", err)
	}
	dsn := "file:" + config.DBPath(home) + "?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite serializes writers; one conn keeps WAL simple.

	s := &Store{db: db, home: home}
	if err := s.applySchema(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close releases the DB handle.
func (s *Store) Close() error { return s.db.Close() }

// Home returns the runtrail home directory this store is rooted at.
func (s *Store) Home() string { return s.home }

// DB exposes the underlying *sql.DB (callers must respect transaction discipline).
func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) applySchema() error {
	if _, err := s.db.Exec(schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	var v sql.NullInt64
	row := s.db.QueryRow(`SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`)
	if err := row.Scan(&v); err != nil && err != sql.ErrNoRows {
		return err
	}
	if !v.Valid {
		_, err := s.db.Exec(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`,
			SchemaVersion, time.Now().Unix())
		if err != nil {
			return err
		}
	}
	return nil
}
