package platform

import (
	"log/slog"
	"os"
)

// NewLogger: JSON di produksi (ramah aggregator/Loki), text di dev (ramah manusia).
// C-05: level Debug hanya untuk dev.
func NewLogger(env string) *slog.Logger {
	if env == "production" {
		return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
}
