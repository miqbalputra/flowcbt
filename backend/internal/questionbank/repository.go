// Package questionbank: lapisan repository (B-12).
// Query SQL versi paket soal dipusatkan di sini agar service hanya berisi logika,
// dan query bisa diuji/ diganti tanpa menyentuh handler HTTP.
package questionbank

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// repoSelectVersions mengembalikan ID versi draft & published dari sebuah paket.
func repoSelectVersions(ctx context.Context, tx pgx.Tx, tenantID, setID string) (draft, published *string, err error) {
	err = tx.QueryRow(ctx,
		`SELECT draft_version_id, published_version_id FROM question_sets
		 WHERE tenant_id=$1 AND id=$2`, tenantID, setID).Scan(&draft, &published)
	return
}

// repoSelectDraftVersion mengembalikan versi draft yang benar-benar berstatus 'draft'.
func repoSelectDraftVersion(ctx context.Context, tx pgx.Tx, tenantID, setID string) (id string, status string, err error) {
	err = tx.QueryRow(ctx,
		`SELECT v.id, v.status FROM question_sets qs
		 JOIN question_set_versions v ON v.id=qs.draft_version_id
		 WHERE qs.tenant_id=$1 AND qs.id=$2`, tenantID, setID).Scan(&id, &status)
	return
}
