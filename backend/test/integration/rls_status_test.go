package integration

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

// X-04: regresi migrasi 000011 — semua tabel ber-tenant_id wajib punya RLS + policy.
// Menjaga agar tabel baru di migrasi berikutnya tidak lupa dilindungi.
func TestRLSCoverageAllTenantTables(t *testing.T) {
	db := testDB(t)
	var total, protected int
	err := db.WithSystemTx(context.Background(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `
			SELECT count(*),
			       count(*) FILTER (WHERE c.relrowsecurity AND EXISTS (
			         SELECT 1 FROM pg_policies p
			         WHERE p.schemaname='public' AND p.tablename=c.relname AND p.policyname='tenant_isolation'))
			FROM pg_attribute a
			JOIN pg_class c ON c.oid=a.attrelid
			JOIN pg_namespace n ON n.oid=c.relnamespace
			WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
			  AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped`).Scan(&total, &protected)
	})
	if err != nil {
		t.Fatalf("hitung cakupan RLS: %v", err)
	}
	if total == 0 {
		t.Fatal("tidak ada tabel ber-tenant_id — migrasi tidak terpasang?")
	}
	if protected != total {
		t.Fatalf("RLS hanya %d dari %d tabel ber-tenant_id", protected, total)
	}
}

// X-04: tenant read_only masih bisa membaca, tetapi semua mutasi ditolak DB.
func TestReadOnlyTenantCannotWrite(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	tid := newTenant(t, db, uniq("TRO"))

	if err := db.WithTenantTx(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO classes (tenant_id, name, academic_year) VALUES ($1,'X A','2026/2027')`, tid)
		return err
	}); err != nil {
		t.Fatalf("setup insert while active: %v", err)
	}

	sysExec(t, db, `UPDATE tenants SET status='read_only' WHERE id=$1`, tid)
	t.Cleanup(func() { sysExec(t, db, `UPDATE tenants SET status='active' WHERE id=$1`, tid) })

	var n int
	if err := db.WithTenantTx(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM classes`).Scan(&n)
	}); err != nil || n == 0 {
		t.Fatalf("read_only tenant harus tetap bisa membaca: n=%d err=%v", n, err)
	}

	if err := db.WithTenantTx(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO classes (tenant_id, name, academic_year) VALUES ($1,'Y B','2026/2027')`, tid)
		return err
	}); err == nil {
		t.Fatal("INSERT pada tenant read_only harus ditolak")
	}

	if err := db.WithTenantTx(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM classes WHERE name='X A'`)
		return err
	}); err == nil {
		t.Fatal("DELETE pada tenant read_only harus ditolak")
	}
}
