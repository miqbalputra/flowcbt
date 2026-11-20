package questionsets

import (
	"errors"
	"net/http"
	"strconv"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// POST /question-sets/{id}/publish
// Validasi: >=1 soal; tiap soal kunci valid & points>0. Versi dibuat di
// question_set_versions (version = current_version+1) lalu baris soal aktif
// DISALIN sebagai snapshot set_version_id=baru (baris kerja tetap,
// set_version_id NULL). Idempoten utk konten sama boleh — versi tetap naik.
func (m *Module) publish(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chiSetID(r)
	var (
		status    string
		version   int
		versionID string
	)
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(),
			`SELECT status, current_version FROM question_sets WHERE id=$1 FOR UPDATE`, setID).
			Scan(&status, &version); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		if status == "archived" {
			return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Paket terarsip tidak bisa diterbitkan")
		}
		failed, err := m.validateWorking(r, tx, setID)
		if err != nil {
			return err
		}
		if len(failed) > 0 {
			return validationError(failed)
		}
		version++
		if err := tx.QueryRow(r.Context(), `
			INSERT INTO question_set_versions(tenant_id, question_set_id, version, created_by)
			VALUES ($1,$2,$3,$4) RETURNING id`,
			tenantID, setID, version, ctxinfo.UserID(r.Context())).Scan(&versionID); err != nil {
			return err
		}
		// SALIN baris soal aktif menjadi snapshot versi baru.
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO questions(tenant_id, question_set_id, set_version_id, order_no, type, stimulus_id,
				body, options, answer_key, points, scoring_mode, explanation, shuffle_options, created_at, updated_at)
			SELECT tenant_id, question_set_id, $2, order_no, type, stimulus_id, body, options, answer_key,
				points, scoring_mode, explanation, shuffle_options, created_at, now()
			FROM questions
			WHERE question_set_id=$1 AND set_version_id IS NULL`, setID, versionID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `
			UPDATE question_sets SET status='published', current_version=$2, updated_at=now() WHERE id=$1`,
			setID, version); err != nil {
			return err
		}
		return m.audit(r, tx, tenantID, ctxinfo.Claims(r.Context()), "publish", "question_set", setID, version)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.Created(w, map[string]any{"data": map[string]any{
		"version": version, "version_id": versionID, "status": "published"}})
}

// POST /question-sets/{id}/unpublish — hanya bila TIDAK ada exams yang memakai
// version terakhir (exams.question_set_version_id); 409 CONFLICT bila exam/
// attempt sudah memakainya. Status kembali draft; versi dihapus bila belum
// pernah dipakai attempt (salinan yang pernah dipakai disimpan).
func (m *Module) unpublish(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chiSetID(r)
	c := ctxinfo.Claims(r.Context())
	var removed int
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var status string
		var currentVersion int
		if err := tx.QueryRow(r.Context(),
			`SELECT status, current_version FROM question_sets WHERE id=$1 FOR UPDATE`, setID).
			Scan(&status, &currentVersion); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		if status != "published" {
			return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Hanya paket published yang bisa di-unpublish")
		}
		var vid string
		if err := tx.QueryRow(r.Context(), `
			SELECT id FROM question_set_versions WHERE question_set_id=$1 AND version=$2`,
			setID, currentVersion).Scan(&vid); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.NewErr(http.StatusConflict, "CONFLICT", "Versi terakhir tidak ditemukan")
			}
			return err
		}
		// exam aktif memakai version terakhir → tolak.
		var nExam int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(1) FROM exams WHERE question_set_version_id=$1`, vid).Scan(&nExam); err != nil {
			return err
		}
		if nExam > 0 {
			return httpx.NewErr(http.StatusConflict, "EXAM_EXISTS",
				"Tidak bisa di-unpublish: versi ini sudah dipakai ujian aktif")
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE question_sets SET status='draft', updated_at=now() WHERE id=$1`, setID); err != nil {
			return err
		}
		// versi dihapus hanya bila belum pernah dipakai attempt (via exams mana pun).
		var attempts int
		if err := tx.QueryRow(r.Context(), `
			SELECT COUNT(1) FROM attempts a JOIN exams e ON e.id = a.exam_id
			WHERE e.question_set_id=$1 AND e.question_set_version_id IS NOT NULL`, setID).
			Scan(&attempts); err != nil {
			return err
		}
		if attempts == 0 {
			if _, err := tx.Exec(r.Context(),
				`DELETE FROM questions WHERE question_set_id=$1 AND set_version_id IS NOT NULL`, setID); err != nil {
				return err
			}
			ct, err := tx.Exec(r.Context(), `DELETE FROM question_set_versions WHERE question_set_id=$1`, setID)
			if err != nil {
				return err
			}
			removed = int(ct.RowsAffected())
		}
		return m.audit(r, tx, tenantID, c, "unpublish", "question_set", setID, currentVersion)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"set_id": setID, "status": "draft", "versions_removed": removed}})
}

// validateWorking menguji semua soal kerja paket sebelum versi dibuat;
// mengembalikan daftar kesalahan VALIDATION (per soal).
func (m *Module) validateWorking(r *http.Request, tx pgx.Tx, setID string) ([]map[string]string, error) {
	rows, err := tx.Query(r.Context(), `
		SELECT type, options::text, answer_key::text, points, scoring_mode
		FROM questions WHERE question_set_id=$1 AND set_version_id IS NULL ORDER BY order_no`, setID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	failed := []map[string]string{}
	i := 0
	for rows.Next() {
		var typ, options, key, scoringMode string
		var points float64
		i++
		if err := rows.Scan(&typ, &options, &key, &points, &scoringMode); err != nil {
			return nil, err
		}
		if _, _, verr := validateQuestion(typ, options, key, points, scoringMode); verr != nil {
			detailsOf(verr, "soal ke-"+strconv.Itoa(i), &failed)
		}
	}
	return failed, rows.Err()
}
