package questionsets

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net/http"
	"strings"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
)

// tenant menghasilkan tenant konteks; 400 NO_TENANT bila kosong.
func (m *Module) tenant(w http.ResponseWriter, r *http.Request) (string, bool) {
	tenantID := ctxinfo.TenantID(r.Context())
	if tenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "NO_TENANT", "Akun tanpa tenant"))
		return "", false
	}
	return tenantID, true
}

// decode mem-parsing body JSON (400/VALIDATION bila gagal).
func (m *Module) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := httpx.Decode(r, dst); err != nil {
		httpx.Error(w, err)
		return false
	}
	if err := m.a.V.Struct(dst); err != nil {
		httpx.Error(w, &httpx.APIError{Status: http.StatusBadRequest, Code: "VALIDATION",
			Message: "Validasi gagal", Details: validationDetails(err)})
		return false
	}
	return true
}

// validationDetails merapikan error go-playground validator.
func validationDetails(err error) []map[string]string {
	out := []map[string]string{}
	if verrs, ok := err.(validator.ValidationErrors); ok {
		for _, fe := range verrs {
			out = append(out, map[string]string{"field": fe.Field(), "rule": fe.Tag()})
		}
	}
	return out
}

// validationError membungkus daftar kesalahan VALIDATION (per soal/baris)
// menjadi APIError 400 dengan details.
func validationError(failed []map[string]string) error {
	if len(failed) == 0 {
		return nil
	}
	msgs := make([]string, 0, len(failed))
	for _, d := range failed {
		msgs = append(msgs, d["message"])
	}
	return &httpx.APIError{Status: http.StatusBadRequest, Code: "VALIDATION",
		Message: "Struktur soal tidak valid: " + strings.Join(msgs, "; "), Details: failed}
}

// detailsOf menambahkan isi APIError VALIDATION ke daftar (dengan prefix soal).
func detailsOf(err error, prefix string, into *[]map[string]string) {
	var ae *httpx.APIError
	if ok := asAPIError(err, &ae); ok && ae.Details != nil {
		for _, d := range toMapList(ae.Details) {
			msg := d["message"]
			if msg == "" {
				msg = ae.Message
			}
			*into = append(*into, map[string]string{"field": d["field"], "message": prefix + ": " + msg})
		}
		return
	}
	*into = append(*into, map[string]string{"field": "", "message": prefix + ": " + err.Error()})
}

func asAPIError(err error, dst **httpx.APIError) bool {
	ae, ok := err.(*httpx.APIError)
	if ok {
		*dst = ae
	}
	return ok
}

func toMapList(v any) []map[string]string {
	if list, ok := v.([]map[string]string); ok {
		return list
	}
	return []map[string]string{}
}

// generateExamCode menghasilkan "KD-"+6 karakter (huruf besar/angka, tanpa ambigu).
func generateExamCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 6)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		b[i] = alphabet[n.Int64()]
	}
	return "KD-" + string(b), nil
}

// workingQuestions membaca soal kerja paket (set_version_id NULL) urut order_no,
// lengkap termasuk answer_key (kunci hanya untuk guru).
func workingQuestions(r *http.Request, tx pgx.Tx, setID string) ([]questionFull, error) {
	rows, err := tx.Query(r.Context(), `
		SELECT q.id, q.question_set_id, q.set_version_id, q.order_no, q.type, q.stimulus_id, q.body,
			q.options, q.answer_key, q.points, q.scoring_mode, q.explanation, q.shuffle_options, q.updated_at
		FROM questions q
		WHERE q.question_set_id=$1 AND q.set_version_id IS NULL
		ORDER BY q.order_no`, setID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []questionFull{}
	for rows.Next() {
		var q questionFull
		if err := rows.Scan(&q.ID, &q.QuestionSetID, &q.SetVersionID, &q.OrderNo, &q.Type, &q.StimulusID,
			&q.Body, &q.Options, &q.AnswerKey, &q.Points, &q.ScoringMode, &q.Explanation,
			&q.ShuffleOptions, &q.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// stimuliOf membaca daftar stimulus paket (sudah ada di GET set).
func stimuliOf(r *http.Request, tx pgx.Tx, setID string) ([]stimulusSummary, error) {
	rows, err := tx.Query(r.Context(), `
		SELECT id, title, content FROM stimuli WHERE question_set_id=$1 ORDER BY created_at`, setID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []stimulusSummary{}
	for rows.Next() {
		var s stimulusSummary
		if err := rows.Scan(&s.ID, &s.Title, &s.Content); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// audit mencatat aksi sensitif ke audit_logs (tenant scoping tetap).
func (m *Module) audit(r *http.Request, tx pgx.Tx, tenantID string, c *auth.Claims,
	action, entity, entityID string, meta any) error {
	if meta == nil {
		meta = map[string]any{}
	}
	var actorID, actorRole string
	if c != nil {
		actorID, actorRole = c.UserID, c.Role
	}
	_, err := tx.Exec(r.Context(), `
		INSERT INTO audit_logs(tenant_id, actor_id, actor_role, action, entity, entity_id, meta)
		VALUES ($1, NULLIF($2,'')::uuid, NULLIF($3,''), $4, $5, $6, $7)`,
		tenantID, actorID, actorRole, action, entity, entityID, jsonRaw(meta))
	return err
}

// ---- util JSON ----

// parseJSON mem-parsing raw JSON ke dst; bila kosong, dst dibiarkan (zero).
func parseJSON(raw string, dst any) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	return json.Unmarshal([]byte(raw), dst)
}

var _ = context.Background
