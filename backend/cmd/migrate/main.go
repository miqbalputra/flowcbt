package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"flowcbt/backend/internal/platform"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5"
)

// migrate menjalankan migrasi golang-migrate (000001..000010) dan memastikan
// role aplikasi (flowcbt_app / flowcbt_system) bisa login (dibuat NOLOGIN oleh 000009).
func main() {
	dir := flag.String("dir", "db/migrations", "direktori migrasi")
	direction := flag.String("cmd", "up", "up | down | force VERSION")
	flag.Parse()

	cfg := platform.LoadConfig()
	log := platform.NewLogger(cfg.Env)

	m, err := migrate.New("file://"+*dir, cfg.DatabaseURL)
	if err != nil {
		log.Error("migrate init", "err", err)
		os.Exit(1)
	}
	switch *direction {
	case "up":
		err = m.Up()
	case "down":
		err = m.Down()
	default:
		var v int
		fmt.Sscanf(*direction, "force %d", &v)
		err = m.Force(v)
	}
	if err != nil && err != migrate.ErrNoChange {
		log.Error("migrate", "err", err)
		os.Exit(1)
	}
	ver, dirty, _ := m.Version()
	log.Info("migrate done", "version", ver, "dirty", dirty)

	// pastikan role bisa login (opsional di produksi; di dev praktis)
	conn, err := pgx.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Error("connect for roles", "err", err)
		os.Exit(1)
	}
	defer conn.Close(context.Background())
	// C-15: jangan pernah menuliskan statement yang mengandung password ke log.
	// Role/nama DB tetap di-sanitize (password bisa mengandung tanda kutip).
	stmts := []struct{ label, sql string }{
		{"set app role password", fmt.Sprintf("ALTER ROLE flowcbt_app LOGIN PASSWORD '%s'", escapeLiteral(cfg.AppDBPassword))},
		{"set system role password", fmt.Sprintf("ALTER ROLE flowcbt_system LOGIN PASSWORD '%s'", escapeLiteral(cfg.SystemDBPass))},
		{"grant connect", fmt.Sprintf("GRANT CONNECT ON DATABASE %s TO flowcbt_app, flowcbt_system", pgx.Identifier{dbName(cfg.DatabaseURL)}.Sanitize())},
	}
	for _, s := range stmts {
		if _, err := conn.Exec(context.Background(), s.sql); err != nil {
			log.Warn("role setup", "step", s.label, "err", err)
		}
	}
	log.Info("roles ready")
}

func escapeLiteral(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

func dbName(url string) string {
	for i := len(url) - 1; i >= 0; i-- {
		if url[i] == '/' {
			rest := url[i+1:]
			for j := 0; j < len(rest); j++ {
				if rest[j] == '?' {
					return rest[:j]
				}
			}
			return rest
		}
	}
	return "flowcbt"
}

var _ = slog.Default
