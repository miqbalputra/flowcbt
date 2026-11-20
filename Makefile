.PHONY: help dev-backend dev-frontend migrate test build-backend build-frontend seed-demo

help:
	@echo "make dev-backend   — jalankan Go API (port 8080)"
	@echo "make dev-frontend  — jalankan Vite dev server (port 5173)"
	@echo "make migrate       — terapkan migrasi DB"
	@echo "make test          — unit test backend"
	@echo "make build-backend — build binary api+worker"

dev-backend:
	cd backend && go run ./cmd/api

dev-frontend:
	cd frontend && npm run dev

migrate:
	cd backend && go run ./cmd/api -migrate-only 2>/dev/null || true

test:
	cd backend && go test ./...

build-backend:
	cd backend && go build -o bin/flowcbt-api ./cmd/api && go build -o bin/flowcbt-worker ./cmd/worker

build-frontend:
	cd frontend && npm run build
