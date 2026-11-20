package app

import (
	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/config"
	"flowcbt/backend/internal/db"

	"github.com/go-playground/validator/v10"
)

// App adalah dependency container yang dipakai semua modul fitur.
type App struct {
	Cfg *config.Config
	DB  *db.DB
	V   *validator.Validate
	RL  *auth.RateLimiter
}

func New(cfg *config.Config, database *db.DB) *App {
	v := validator.New()
	return &App{Cfg: cfg, DB: database, V: v, RL: auth.NewRateLimiter()}
}
