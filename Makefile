.PHONY: dev-pg migrate api worker test be-test test-race test-cover web-install web-build smoke

# Jalankan PostgreSQL 16 lokal via embedded-postgres (sandbox tanpa Docker)
dev-pg:
	node scripts/dev-pg.mjs

migrate:
	cd backend && go run ./cmd/migrate -dir db/migrations -cmd up

api:
	cd backend && go run ./cmd/api

worker:
	cd backend && go run ./cmd/worker

# C-10: jangan pipe ke `tail` — exit code yang terbaca adalah `tail`, bukan `go test`.
# Kegagalan test harus membuat target ini gagal (dan karenanya CI/smoke gate ikut gagal).
be-test:
	cd backend && go test ./... -count=1

# Uji konkurensi untuk paket yang rawan race (attempt/billing/auth).
test-race:
	cd backend && go test -race ./internal/attempt/... ./internal/billing/... ./internal/auth/... -count=1

# Cakupan dengan ambang minimum; coverage.out bisa diunggah sebagai artifact CI.
test-cover:
	cd backend && go test ./internal/... -count=1 -coverprofile=coverage.out -covermode=atomic

# Alias yang dijanjikan .PHONY — sekarang benar-benar ada.
test: be-test test-race test-cover

web-install:
	cd web && pnpm install

web-build:
	cd web && pnpm -r build

smoke:
	bash scripts/smoke.sh
