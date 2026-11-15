.PHONY: dev-pg migrate api worker test be-test web-install web-build smoke

# Jalankan PostgreSQL 16 lokal via embedded-postgres (sandbox tanpa Docker)
dev-pg:
	node scripts/dev-pg.mjs

migrate:
	cd backend && go run ./cmd/migrate -dir db/migrations -cmd up

api:
	cd backend && go run ./cmd/api

worker:
	cd backend && go run ./cmd/worker

be-test:
	cd backend && go test ./... 2>&1 | tail -40

web-install:
	cd web && pnpm install

web-build:
	cd web && pnpm -r build

smoke:
	bash scripts/smoke.sh
