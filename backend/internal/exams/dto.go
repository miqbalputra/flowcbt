// dto.go — bentuk data (kontrak API §9/§11 PRD) yang dipakai handler modul
// ujian. Semua struct request punya tag validator; respons memakai json tag
// snake_case sesuai kontrak FE.
package exams

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"
)

// --------------------------------------------------------------------------
// Kolom select: urutan WAJIB sinkron dengan fungsi scan terkait
// (scanExamRecord di queries.go / scanAttemptRecord di queries.go).
// --------------------------------------------------------------------------

// examSelect kolom exams — urutan sama dengan scanExamRecord.
const examSelect = `id::text, tenant_id::text, question_set_id::text,
	COALESCE(question_set_version_id::text,''), name, subject_name, exam_code,
	token, token_active, status, paused, open_at, close_at, duration_minutes,
	max_attempts, show_score_immediately, show_explanation, shuffle_questions,
	shuffle_options, free_navigation, require_all_answered, login_mode,
	guest_nis_required, COALESCE(passing_score,0)::float8, score_released,
	anti_cheat::text, created_at, updated_at`

// attemptSelect kolom attempts — urutan sama dengan scanAttemptRecord.
const attemptSelect = `id::text, exam_id::text, COALESCE(student_id::text,''),
	attempt_no, status, started_at, deadline_at, submitted_at,
	COALESCE(device_token,''), COALESCE(package_json::text,'{}'),
	penalty_points::float8, cheating_status, COALESCE(score,0)::float8,
	COALESCE(max_score,0)::float8, COALESCE(final_score,0)::float8`

// examSelectPlus examSelect + examSelectExtra (dipakai SELECT ujian lengkap).
const examSelectPlus = examSelect + examSelectExtra

// examSelectExtra kolom tambahan examSelect (time_style, score_policy,
// credits_exam_id) yang dibaca scanExamRecord setelah anti_cheat.
const examSelectExtra = `, time_style, score_policy, COALESCE(credits_exam_id::text,'')`

// --------------------------------------------------------------------------
// Konfigurasi anti-cheat & proctoring (FR-5.8).
// --------------------------------------------------------------------------

// AntiCheat konfigurasi anti-cheat & proctoring per ujian (FR-5.8).
type AntiCheat struct {
	Enabled          bool    `json:"enabled"`
	ToleranceSeconds int     `json:"tolerance_seconds"`
	PenaltyPoints    float64 `json:"penalty_points"`
	MaxPenalty       float64 `json:"max_penalty"`
	FlagThreshold    int     `json:"flag_threshold"`
	AutoSubmit       bool    `json:"auto_submit"`
	AutoSubmitAt     int     `json:"auto_submit_at"`
	CameraEnabled    bool    `json:"camera_enabled"`
	CameraMode       string  `json:"camera_mode"`
	SnapshotMinS     int     `json:"snapshot_min_s"`
	SnapshotMaxS     int     `json:"snapshot_max_s"`
}

// defaultAntiCheat nilai awal sesuai PRD FR-5.8 (bila body kosong).
func defaultAntiCheat() AntiCheat {
	return AntiCheat{
		ToleranceSeconds: 3,
		PenaltyPoints:    5,
		MaxPenalty:       30,
		FlagThreshold:    3,
		CameraMode:       "notify",
		SnapshotMinS:     30,
		SnapshotMaxS:     90,
	}
}

// normalize menjaga konfigurasi tetap aman sebelum dipakai/disimpan.
func (ac *AntiCheat) normalize() {
	if ac.ToleranceSeconds < 0 {
		ac.ToleranceSeconds = 3
	}
	if ac.FlagThreshold <= 0 {
		ac.FlagThreshold = 3
	}
	if ac.MaxPenalty < 0 {
		ac.MaxPenalty = 30
	}
	if ac.PenaltyPoints < 0 {
		ac.PenaltyPoints = 5
	}
	if ac.SnapshotMinS <= 0 {
		ac.SnapshotMinS = 30
	}
	if ac.SnapshotMaxS < ac.SnapshotMinS {
		ac.SnapshotMaxS = ac.SnapshotMinS
	}
	if ac.CameraMode != "strict" && ac.CameraMode != "notify" {
		ac.CameraMode = "notify"
	}
	if ac.AutoSubmitAt <= 0 {
		ac.AutoSubmitAt = ac.FlagThreshold
	}
}

// --------------------------------------------------------------------------
// Request staf (M5).
// --------------------------------------------------------------------------

// saveExamReq body POST /exams dan PUT /exams/{examID}.
type saveExamReq struct {
	QuestionSetID        string        `json:"question_set_id" validate:"required,uuid"`
	Name                 string        `json:"name" validate:"required,min=2,max=200"`
	OpenAt               string        `json:"open_at" validate:"required"`
	CloseAt              string        `json:"close_at" validate:"required"`
	DurationMinutes      int           `json:"duration_minutes" validate:"required,min=1,max=600"`
	TimeStyle            string        `json:"time_style" validate:"omitempty,oneof=grace hard_close"`
	MaxAttempts          *int          `json:"max_attempts" validate:"omitempty,gte=1,lte=10"`
	ScorePolicy          string        `json:"score_policy" validate:"omitempty,oneof=highest last avg"`
	ShowScoreImmediately *bool         `json:"show_score_immediately"`
	ShowExplanation      bool          `json:"show_explanation"`
	ShuffleQuestions     bool          `json:"shuffle_questions"`
	ShuffleOptions       bool          `json:"shuffle_options"`
	FreeNavigation       *bool         `json:"free_navigation"`
	RequireAllAnswered   bool          `json:"require_all_answered"`
	LoginMode            string        `json:"login_mode" validate:"omitempty,oneof=account guest both"`
	GuestNisRequired     bool          `json:"guest_nis_required"`
	PassingScore         *float64      `json:"passing_score"`
	AntiCheat            *AntiCheatRaw `json:"anti_cheat"`
}

// AntiCheatRaw bentuk bebas dari FE (semua field opsional) → AntiCheat.
type AntiCheatRaw struct {
	Enabled          *bool    `json:"enabled"`
	ToleranceSeconds *int     `json:"tolerance_seconds"`
	PenaltyPoints    *float64 `json:"penalty_points"`
	MaxPenalty       *float64 `json:"max_penalty"`
	FlagThreshold    *int     `json:"flag_threshold"`
	AutoSubmit       *bool    `json:"auto_submit"`
	AutoSubmitAt     *int     `json:"auto_submit_at"`
	CameraEnabled    *bool    `json:"camera_enabled"`
	CameraMode       *string  `json:"camera_mode"`
	SnapshotMinS     *int     `json:"snapshot_min_s"`
	SnapshotMaxS     *int     `json:"snapshot_max_s"`
}

// toAntiCheat gabungkan raw FE dengan default PRD.
func (raw *AntiCheatRaw) toAntiCheat() AntiCheat {
	ac := defaultAntiCheat()
	if raw == nil {
		ac.normalize()
		return ac
	}
	if raw.Enabled != nil {
		ac.Enabled = *raw.Enabled
	}
	if raw.ToleranceSeconds != nil {
		ac.ToleranceSeconds = *raw.ToleranceSeconds
	}
	if raw.PenaltyPoints != nil {
		ac.PenaltyPoints = *raw.PenaltyPoints
	}
	if raw.MaxPenalty != nil {
		ac.MaxPenalty = *raw.MaxPenalty
	}
	if raw.FlagThreshold != nil {
		ac.FlagThreshold = *raw.FlagThreshold
	}
	if raw.AutoSubmit != nil {
		ac.AutoSubmit = *raw.AutoSubmit
	}
	if raw.AutoSubmitAt != nil {
		ac.AutoSubmitAt = *raw.AutoSubmitAt
	}
	if raw.CameraEnabled != nil {
		ac.CameraEnabled = *raw.CameraEnabled
	}
	if raw.CameraMode != nil {
		ac.CameraMode = *raw.CameraMode
	}
	if raw.SnapshotMinS != nil {
		ac.SnapshotMinS = *raw.SnapshotMinS
	}
	if raw.SnapshotMaxS != nil {
		ac.SnapshotMaxS = *raw.SnapshotMaxS
	}
	ac.normalize()
	return ac
}

// assignmentsReq body PUT /exams/{examID}/assignments (REPLACE).
type assignmentsReq struct {
	ClassIDs   []string `json:"class_ids"`
	StudentIDs []string `json:"student_ids"`
}

// releaseScoresReq body PUT /exams/{examID}/release-scores (FR-5.4).
type releaseScoresReq struct {
	Released bool `json:"released"`
}

// extendTimeReq body POST .../extend-time (FR-5.7).
type extendTimeReq struct {
	Seconds int `json:"seconds" validate:"required,min=1,max=86400"`
}

// cheatDecisionReq body PUT /exams/{examID}/cheating-decision (FR-5.8C).
type cheatDecisionReq struct {
	AttemptID string `json:"attempt_id" validate:"required,uuid"`
	Decision  string `json:"decision" validate:"required,oneof=valid cancel_penalty disqualify"`
	Reason    string `json:"reason" validate:"max=500"`
}

// --------------------------------------------------------------------------
// Request & respons siswa (M6/M7).
// --------------------------------------------------------------------------

// startReq body POST /student/exams/{examID}/start.
type startReq struct {
	Token      string         `json:"token" validate:"required,min=4,max=12"`
	DeviceInfo map[string]any `json:"device_info"`
}

// startResp hasil start/resume attempt.
type startResp struct {
	AttemptID  string        `json:"attempt_id"`
	Resume     bool          `json:"resume"`
	StartedAt  *time.Time    `json:"started_at"`
	DeadlineAt *time.Time    `json:"deadline_at"`
	ServerTime time.Time     `json:"server_time"`
	Package    *startPackage `json:"package,omitempty"`
}

// startPackage paket soal untuk pra-muat klien (TANPA kunci jawaban, FR-7.2).
type startPackage struct {
	Name           string            `json:"name"`
	SubjectName    string            `json:"subject_name"`
	Questions      []packageQuestion `json:"questions"`
	ExplainVisible bool              `json:"explain_visible"`
	Rules          examRulesView     `json:"rules"`
	RequireAll     bool              `json:"require_all_answered"`
	FreeNavigation bool              `json:"free_navigation"`
}

// syncEventReq satu event jawaban tertunda dalam antrean offline (AC-3).
type syncEventReq struct {
	ClientEventID string `json:"client_event_id" validate:"required,max=64"`
	// oneof mencakup seluruh tipe yang ditangani handler sync: answer,
	// flag, nav, violation (pelanggaran antrean offline) dan submit (AC-4).
	// Tanpa violation/submit di sini validator menolak batch → antrean
	// offline macet dengan 400 padahal handler sudah mendukung.
	Type       string         `json:"type" validate:"required,oneof=answer flag nav violation submit"`
	QuestionID string         `json:"question_id" validate:"omitempty,uuid"`
	Payload    syncPayloadReq `json:"payload"`
	ClientTS   int64          `json:"client_ts"` // epoch ms
	Seq        int64          `json:"seq"`
}

// syncPayloadReq payload event: jawaban &/atau tanda ragu.
type syncPayloadReq struct {
	Answer     json.RawMessage `json:"answer"`
	Flag       *bool           `json:"flag"`
	QuestionID string          `json:"question_id"`
	// khusus 'violation' (antrean offline):
	VType     string `json:"violation_type"`
	StartedAt string `json:"started_at"`
	DurMS     int    `json:"duration_ms"`
}

// syncReq body POST /student/attempts/{attemptID}/answers:sync.
type syncReq struct {
	Events          []syncEventReq `json:"events" validate:"required,min=1,max=200,dive"`
	ClientElapsedMS int64          `json:"client_elapsed_ms"`
}

// syncReject satu event ditolak server (AC-5).
type syncReject struct {
	ClientEventID string `json:"client_event_id"`
	Reason        string `json:"reason"`
}

// syncResp hasil sinkronisasi antrean jawaban per event id klien.
type syncResp struct {
	Acked      []string     `json:"acked"`
	Rejected   []syncReject `json:"rejected"`
	ServerTime time.Time    `json:"server_time"`
	Status     string       `json:"status"`
}

// submitReq body POST /student/attempts/{attemptID}/submit.
type submitReq struct {
	ClientEventID   string `json:"client_event_id" validate:"required,max=64"`
	ClientElapsedMS int64  `json:"client_elapsed_ms"`
}

// violationReq body POST /student/attempts/{attemptID}/violations (AC-8).
type violationReq struct {
	ClientEventID string `json:"client_event_id" validate:"required,max=64"`
	Type          string `json:"type" validate:"required,oneof=tab_hidden blur fullscreen_exit camera_off no_face multi_face"`
	StartedAt     string `json:"started_at"` // RFC3339 opsional
	DurationMS    int    `json:"duration_ms" validate:"min=0,max=86400000"`
}

// violationResp hasil pencatatan pelanggaran (AC-8).
type violationResp struct {
	Violations       int     `json:"violations"`
	TotalPenalty     float64 `json:"total_penalty"`
	CheatingStatus   string  `json:"cheating_status"`
	ShouldAutoSubmit bool    `json:"should_auto_submit"`
	WarnLeft         int     `json:"warn_left"`

	// internal: attempt masih aktif (dipakai alur auto-submit, tak di-serialize).
	AttemptActive bool `json:"-"`
}

// --------------------------------------------------------------------------
// Util parsing.
// --------------------------------------------------------------------------

// parseWindow mem-parsing jadwal buka-tutup; close wajib > open.
func parseWindow(openAt, closeAt string) (time.Time, time.Time, error) {
	open, err := time.Parse(time.RFC3339, strings.TrimSpace(openAt))
	if err != nil {
		return time.Time{}, time.Time{}, httpx.NewErr(http.StatusBadRequest,
			"VALIDATION", "open_at tidak valid (format RFC3339)")
	}
	close, err := time.Parse(time.RFC3339, strings.TrimSpace(closeAt))
	if err != nil {
		return time.Time{}, time.Time{}, httpx.NewErr(http.StatusBadRequest,
			"VALIDATION", "close_at tidak valid (format RFC3339)")
	}
	if !close.After(open) {
		return time.Time{}, time.Time{}, httpx.NewErr(http.StatusBadRequest,
			"VALIDATION", "close_at harus setelah open_at")
	}
	return open, close, nil
}
