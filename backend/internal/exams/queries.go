// queries.go — helper akses data paket exams: scan baris exams/attempts,
// loader soal versi terkunci, audit log, generator token, dan util
// (decode body, validasi path UUID, shuffle stabil untuk paket soal).
package exams

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Rekaman baris & scanner
// ---------------------------------------------------------------------------

// examRecord baris tabel exams (urutan kolom = examSelectPlus).
type examRecord struct {
	ID                   string
	TenantID             string
	QuestionSetID        string
	QuestionSetVersionID string // '' bila belum pernah publish
	Name                 string
	SubjectName          string
	ExamCode             string
	Token                string
	TokenActive          bool
	Status               string
	Paused               bool
	OpenAt               time.Time
	CloseAt              time.Time
	DurationMinutes      int
	MaxAttempts          int
	ShowScoreImmediately bool
	ShowExplanation      bool
	ShuffleQuestions     bool
	ShuffleOptions       bool
	FreeNavigation       bool
	RequireAllAnswered   bool
	LoginMode            string
	GuestNisRequired     bool
	PassingScore         float64
	ScoreReleased        bool
	AntiCheatJSON        string
	CreatedAt            time.Time
	UpdatedAt            time.Time
	TimeStyle            string
	ScorePolicy          string
	CreditsExamID        string // id kredit terpotong ('' bila bukan per_exam)
}

// scanExamRecord memindai satu baris hasil SELECT examSelectPlus.
func scanExamRecord(row pgx.Row) (*examRecord, error) {
	var e examRecord
	var antiCheat string
	err := row.Scan(&e.ID, &e.TenantID, &e.QuestionSetID, &e.QuestionSetVersionID,
		&e.Name, &e.SubjectName, &e.ExamCode, &e.Token, &e.TokenActive,
		&e.Status, &e.Paused, &e.OpenAt, &e.CloseAt, &e.DurationMinutes,
		&e.MaxAttempts, &e.ShowScoreImmediately, &e.ShowExplanation,
		&e.ShuffleQuestions, &e.ShuffleOptions, &e.FreeNavigation,
		&e.RequireAllAnswered, &e.LoginMode, &e.GuestNisRequired,
		&e.PassingScore, &e.ScoreReleased, &antiCheat, &e.CreatedAt, &e.UpdatedAt,
		&e.TimeStyle, &e.ScorePolicy, &e.CreditsExamID)
	if err != nil {
		return nil, err
	}
	e.AntiCheatJSON = antiCheat
	return &e, nil
}

// antiCheat mengurai JSONB anti_cheat; bila kosong/{} → default PRD.
func (e *examRecord) antiCheat() AntiCheat {
	ac := defaultAntiCheat()
	if s := strings.TrimSpace(e.AntiCheatJSON); s != "" && s != "{}" {
		_ = json.Unmarshal([]byte(s), &ac)
	}
	ac.normalize()
	return ac
}

// attemptRecord baris tabel attempts (urutan kolom = attemptSelect).
type attemptRecord struct {
	ID             string
	ExamID         string
	StudentID      string // '' bila guest tanpa record (tidak terjadi — guest punya record)
	AttemptNo      int
	Status         string
	StartedAt      *time.Time
	DeadlineAt     *time.Time
	SubmittedAt    *time.Time
	DeviceToken    string
	PackageJSON    string
	PenaltyPoints  float64
	CheatingStatus string
	Score          float64
	MaxScore       float64
	FinalScore     float64

	// internal (tidak dari DB/DOM): ada uraian menunggu penilaian guru.
	PendingManual bool
}

// scanAttemptRecord memindai satu baris hasil SELECT attemptSelect.
func scanAttemptRecord(row pgx.Row) (*attemptRecord, error) {
	var a attemptRecord
	var pkg string
	err := row.Scan(&a.ID, &a.ExamID, &a.StudentID, &a.AttemptNo, &a.Status,
		&a.StartedAt, &a.DeadlineAt, &a.SubmittedAt, &a.DeviceToken, &pkg,
		&a.PenaltyPoints, &a.CheatingStatus, &a.Score, &a.MaxScore, &a.FinalScore)
	if err != nil {
		return nil, err
	}
	a.PackageJSON = pkg
	return &a, nil
}

// attemptPackage bentuk tersimpan attempts.package_json.
type attemptPackage struct {
	Order        []string            `json:"order"`         // [question_id ...] sesuai urutan tampil
	OptionsOrder map[string][]string `json:"options_order"` // qid -> [option ...] (bila shuffle_options)
}

// loadExam mengambil satu ujian milik tenant; tidak ada → 404 (AC-9).
func loadExam(ctx context.Context, tx pgx.Tx, examID string) (*examRecord, error) {
	e, err := scanExamRecord(tx.QueryRow(ctx,
		`SELECT `+examSelectPlus+` FROM exams WHERE id=$1`, examID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
		}
		return nil, err
	}
	return e, nil
}

// loadAttempt mengambil satu attempt milik tenant; tidak ada → 404.
func loadAttempt(ctx context.Context, tx pgx.Tx, attemptID string) (*attemptRecord, error) {
	a, err := scanAttemptRecord(tx.QueryRow(ctx,
		`SELECT `+attemptSelect+` FROM attempts WHERE id=$1`, attemptID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Attempt tidak ditemukan")
		}
		return nil, err
	}
	return a, nil
}

// loadExamByID sederhana (tanpa 404 APIError) untuk kebutuhan internal.
func examExists(ctx context.Context, tx pgx.Tx, examID string) (bool, error) {
	var one bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM exams WHERE id=$1)`, examID).Scan(&one)
	return one, err
}

// ---------------------------------------------------------------------------
// Soal versi (paket yang dikunci ujian)
// ---------------------------------------------------------------------------

// versionQuestion soal pada satu versi set — untuk paket siswa & penilaian.
type versionQuestion struct {
	ID          string
	OrderNo     int
	Type        string
	StimulusID  *string
	Body        string
	Options     json.RawMessage
	AnswerKey   json.RawMessage
	Points      float64
	ScoringMode string
	Explanation string
	ShuffleOpts bool
}

// loadVersionQuestions membaca soal milik satu versi urut order_no.
func loadVersionQuestions(ctx context.Context, tx pgx.Tx, versionID string) ([]versionQuestion, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, order_no, type, stimulus_id::text, body, options,
		       answer_key, points::float8, scoring_mode, explanation, shuffle_options
		FROM questions
		WHERE set_version_id=$1
		ORDER BY order_no, id`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []versionQuestion{}
	for rows.Next() {
		var q versionQuestion
		if err := rows.Scan(&q.ID, &q.OrderNo, &q.Type, &q.StimulusID, &q.Body,
			&q.Options, &q.AnswerKey, &q.Points, &q.ScoringMode, &q.Explanation,
			&q.ShuffleOpts); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// draftSetInfo metadata question_set untuk detail ujian & pembuatan ujian.
func loadQuestionSetInfo(ctx context.Context, tx pgx.Tx, setID string) (title, subject, examCode string, currentVersion int, err error) {
	err = tx.QueryRow(ctx, `
		SELECT title, subject_name, exam_code, current_version
		FROM question_sets WHERE id=$1`, setID).
		Scan(&title, &subject, &examCode, &currentVersion)
	return
}

// ---------------------------------------------------------------------------
// Util request (mengikuti pola modul lain)
// ---------------------------------------------------------------------------

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// urlUUID ambil param path; non-UUID → 404 (AC-9: ID tenant lain → 404).
func urlUUID(r *http.Request, name string) (string, error) {
	v := chi.URLParam(r, name)
	if !uuidRe.MatchString(v) {
		return "", httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Data tidak ditemukan")
	}
	return v, nil
}

// tenantOf tenant dari JWT; kosong → 400.
func tenantOf(r *http.Request) (string, error) {
	t := ctxinfo.TenantID(r.Context())
	if t == "" {
		return "", httpx.NewErr(http.StatusBadRequest, "NO_TENANT", "Akun tanpa tenant")
	}
	return t, nil
}

// decode mem-parsing body JSON + validasi → false & 400 bila gagal (pola
// questionsets/helpers.go). Versi method agar memakai m.a.V.
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

// tenant tenant dari JWT; bila kosong kirim 400 & false.
func (m *Module) tenant(w http.ResponseWriter, r *http.Request) (string, bool) {
	tenantID := ctxinfo.TenantID(r.Context())
	if tenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "NO_TENANT", "Akun tanpa tenant"))
		return "", false
	}
	return tenantID, true
}

// validationDetails merapikan error validator (pola questionsets).
func validationDetails(err error) []map[string]string {
	out := []map[string]string{}
	if verrs, ok := err.(validator.ValidationErrors); ok {
		for _, fe := range verrs {
			out = append(out, map[string]string{"field": fe.Field(), "rule": fe.Tag()})
		}
	}
	return out
}

// audit mencatat aksi sensitif ke audit_logs (tenant scoping tetap).
func audit(ctx context.Context, tx pgx.Tx, tenantID string, c *auth.Claims,
	action, entity, entityID string, meta any) error {
	if meta == nil {
		meta = map[string]any{}
	}
	var actorID, actorRole string
	if c != nil {
		actorID, actorRole = c.UserID, c.Role
	}
	raw, _ := json.Marshal(meta)
	_, err := tx.Exec(ctx, `
		INSERT INTO audit_logs(tenant_id, actor_id, actor_role, action, entity, entity_id, meta)
		VALUES ($1, NULLIF($2,'')::uuid, NULLIF($3,''), $4, $5, $6, $7)`,
		tenantID, actorID, actorRole, action, entity, entityID, raw)
	return err
}

// ---------------------------------------------------------------------------
// Generator token ujian (6 huruf besar-angka, tanpa karakter ambigu)
// ---------------------------------------------------------------------------

const tokenAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// randomToken menghasilkan token acak sepanjang n karakter.
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	for i := range b {
		k, err := rand.Int(rand.Reader, big.NewInt(int64(len(tokenAlphabet))))
		if err != nil {
			return "", err
		}
		b[i] = tokenAlphabet[k.Int64()]
	}
	return string(b), nil
}

// uniqueToken menghasilkan token yang belum dipakai tenant (cek ke DB).
func uniqueToken(ctx context.Context, tx pgx.Tx) (string, error) {
	for i := 0; i < 10; i++ {
		t, err := randomToken(6)
		if err != nil {
			return "", err
		}
		var used bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM exams WHERE token=$1)`, t).Scan(&used); err != nil {
			return "", err
		}
		if !used {
			return t, nil
		}
	}
	return "", httpx.NewErr(http.StatusInternalServerError, "INTERNAL", "Gagal membuat token ujian")
}

// ---------------------------------------------------------------------------
// Shuffle stabil (paket soal per attempt)
// ---------------------------------------------------------------------------

// stableShuffle mengacak urutan secara deterministik dari seed (attempt id):
// urutan tetap sama di semua restart perangkat (M6/AC-6).
func stableShuffle[T any](items []T, seed string) []T {
	if len(items) < 2 {
		return items
	}
	// LCG deterministik dari FNV-1a seed.
	h := uint64(14695981039346656037)
	for _, c := range []byte(seed) {
		h ^= uint64(c)
		h *= 1099511628211
	}
	out := append([]T(nil), items...)
	for i := len(out) - 1; i > 0; i-- {
		h ^= h >> 33
		h *= 0xFF51AFD7ED558CCD
		h ^= h >> 33
		j := int(h % uint64(i+1))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// strPtr konversi string kosong → NULL-safe pointer.
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ftoa format angka sederhana untuk meta log.
func ftoa(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}
