// Package attempt: alur pengerjaan siswa (M6/M7 backend) — start, answers:sync idempoten,
// submit (online/offline→pending_sync), pemulihan, hasil; auto-submit oleh worker.
package attempt

import (
	"context"
	"encoding/json"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"time"

	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/grading"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// DeadlineTolerance adalah toleransi server saat memvalidasi jawaban dari klien offline (AC-5, FR-7.5).
const DeadlineTolerance = 5 * time.Second

type Service struct {
	DB     *platform.DB
	Audit  *audit.Writer
	Clock  platform.Clock
}

// Routes mendaftarkan rute non-/exams (dipanggil dari server).
func (s *Service) Routes(r chi.Router) {
	r.Route("/me", func(r chi.Router) {
		r.Get("/exams", s.myExams)
	})
}

// ExamRoutes mendaftarkan rute di dalam subrouter /exams (start oleh siswa, regrade oleh guru).
func (s *Service) ExamRoutes(r chi.Router) {
	r.Post("/{id}/start", s.start)      // siswa
	r.Post("/{id}/regrade", s.regradeExam) // guru
}

// AttemptRoutes mendaftarkan rute di dalam subrouter /attempts.
func (s *Service) AttemptRoutes(r chi.Router) {
	r.Get("/{id}", s.getAttempt)
	r.Post("/{id}/answers:sync", s.syncAnswers)
	r.Post("/{id}/submit", s.submit)
	r.Post("/{id}/violations", s.addViolations)
	r.Get("/{id}/result", s.result)
	r.Get("/{id}/grading", s.gradingDetail)
	r.Put("/{id}/answers/{qid}/score", s.putScore)
	r.Put("/{id}/cheating-decision", s.cheatingDecision)
}

// --- GET /me/exams (FR-6.1) ---

func (s *Service) myExams(w http.ResponseWriter, r *http.Request) {
	claims := httpx.ClaimsFrom(r.Context())
	tid := claims.TenantID
	studentID := claims.Sub
	now := s.Clock.Now()
	var out []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT e.id, e.name, qs.subject_name, qs.exam_code, e.open_at, e.close_at, e.duration_minutes, e.max_attempts,
			        e.show_score_immediately, e.scores_released_at,
			        (SELECT count(*) FROM attempts a WHERE a.exam_id=e.id AND a.student_id=$2 AND a.status NOT IN ('cancelled')),
			        (SELECT a.id FROM attempts a WHERE a.exam_id=e.id AND a.student_id=$2 AND a.status='in_progress' ORDER BY a.attempt_no DESC LIMIT 1),
			        (SELECT a.final_score FROM attempts a WHERE a.exam_id=e.id AND a.student_id=$2 AND a.status IN ('submitted','awaiting_manual_grading','graded') ORDER BY a.attempt_no DESC LIMIT 1)
			 FROM exams e
			 JOIN exam_participants ep ON ep.exam_id=e.id AND ep.student_id=$2
			 JOIN question_sets qs ON qs.id=e.question_set_id
			 WHERE e.tenant_id=$1 AND e.status='published'
			 ORDER BY e.open_at DESC NULLS LAST`, tid, studentID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id, name, subject, code string
			var openAt, closeAt *time.Time
			var dur, used int
			var maxAttPtr *int
			var showImm bool
			var released *time.Time
			var activeAttempt *string
			var lastScore *float64
			if err := rws.Scan(&id, &name, &subject, &code, &openAt, &closeAt, &dur, &maxAttPtr, &showImm, &released, &used, &activeAttempt, &lastScore); err != nil {
				return err
			}
			state := "upcoming"
			if openAt != nil && now.Before(*openAt) {
				state = "upcoming"
			} else if closeAt != nil && now.After(*closeAt) {
				state = "closed"
			} else {
				state = "open"
			}
			m := map[string]any{
				"exam_id": id, "name": name, "subject": subject, "exam_code": code,
				"open_at": openAt, "close_at": closeAt, "duration_minutes": dur,
				"state": state, "attempts_used": used, "max_attempts": maxAttPtr,
				"active_attempt_id": activeAttempt, "last_score": lastScore,
			}
			out = append(out, m)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if out == nil {
		out = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// --- POST /exams/{id}/start (FR-6.2): token → attempt baru + paket soal TANPA kunci ---

type startInput struct {
	Token string `json:"token"`
}

type packetQuestion struct {
	ID          string          `json:"id"`
	OrderNo     int             `json:"order_no"`
	Type        string          `json:"type"`
	BodyHTML    string          `json:"body_html"`
	OptionsJSON json.RawMessage `json:"options_json"`
	StimulusID  *string         `json:"stimulus_id,omitempty"`
	MediaIDs    []string        `json:"media_ids"`
	Points      float64         `json:"points"`
}

func (s *Service) start(w http.ResponseWriter, r *http.Request) {
	var in startInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	claims := httpx.ClaimsFrom(r.Context())
	tid := claims.TenantID
	studentID := claims.Sub
	device := httpx.DeviceHashFrom(r.Context())
	in.Token = strings.ToUpper(strings.TrimSpace(in.Token))

	examID := chi.URLParam(r, "id")
	now := s.Clock.Now()

	var (
		attemptID   string
		examName    string
		setVerID    string
		loginMode   string
		examStatus  string
		openAt      *time.Time
		closeAt     *time.Time
		durMin      int
		closePolicy string
		maxAttempts *int
		scorePolicy string
		showScore   bool
		showReview  bool
		showExpl    bool
		shufQ       bool
		shufO       bool
		penaltyMode string
		penaltyVal  float64
		penaltyMax  float64
		leaveTol    int
		flagThr     *int
		autoSubThr  *int
		antiEnabled bool
		reqAll      bool
	)
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		// token global → exam (FR-4.9)
		var tokTenant, tokExam string
		if err := tx.QueryRow(r.Context(), `SELECT tenant_id, exam_id FROM exam_tokens WHERE token=$1 AND is_active=true`, in.Token).Scan(&tokTenant, &tokExam); err != nil {
			return httpx.Err(httpx.CodeTokenInvalid, "token ujian tidak valid", 401)
		}
		if tokTenant != tid || tokExam != examID {
			return httpx.Err(httpx.CodeTokenInvalid, "token tidak cocok untuk ujian ini", 401)
		}
		if err := tx.QueryRow(r.Context(),
			`SELECT name, status, open_at, close_at, duration_minutes, close_policy, login_mode, max_attempts, score_policy,
			        show_score_immediately, show_review, show_explanations, shuffle_questions, shuffle_options,
			        anticheat_enabled, leave_tolerance_seconds, penalty_mode, penalty_value, penalty_max, flag_threshold,
			        auto_submit_threshold, require_all_answered, set_version_id
			 FROM exams WHERE tenant_id=$1 AND id=$2`, tid, examID).
			Scan(&examName, &examStatus, &openAt, &closeAt, &durMin, &closePolicy, &loginMode, &maxAttempts, &scorePolicy,
				&showScore, &showReview, &showExpl, &shufQ, &shufO,
				&antiEnabled, &leaveTol, &penaltyMode, &penaltyVal, &penaltyMax, &flagThr, &autoSubThr, &reqAll, &setVerID); err != nil {
			return httpx.NotFound("ujian tidak ditemukan")
		}
		if examStatus != "published" {
			return httpx.Err(httpx.CodeExamNotOpen, "ujian belum dibuka atau sudah ditutup", 409)
		}
		if openAt != nil && now.Before(*openAt) {
			return httpx.Err(httpx.CodeExamNotOpen, "ujian belum dibuka", 409)
		}
		if closeAt != nil && now.After(*closeAt) {
			return httpx.Err(httpx.CodeExamNotOpen, "ujian sudah ditutup", 409)
		}
		// login mode: akun saja → tamu ditolak
		var isGuest bool
		if err := tx.QueryRow(r.Context(), `SELECT is_guest FROM students WHERE tenant_id=$1 AND id=$2`, tid, studentID).Scan(&isGuest); err != nil {
			return httpx.NotFound("siswa tidak ditemukan")
		}
		if loginMode == "account" && isGuest {
			return httpx.Forbidden("ujian ini hanya untuk login dengan akun")
		}
		// harus terdaftar sebagai peserta
		var cnt int
		if err := tx.QueryRow(r.Context(),
			`SELECT count(*) FROM exam_participants WHERE tenant_id=$1 AND exam_id=$2 AND student_id=$3`, tid, examID, studentID).Scan(&cnt); err != nil {
			return err
		}
		if cnt == 0 {
			return httpx.Forbidden("Anda tidak terdaftar sebagai peserta ujian ini")
		}
		// batas percobaan (AC-6)
		var used int
		var override *int
		if err := tx.QueryRow(r.Context(),
			`SELECT count(*), (SELECT attempts_override FROM exam_participants WHERE exam_id=$1 AND student_id=$2)
			 FROM attempts WHERE tenant_id=$3 AND exam_id=$1 AND student_id=$2 AND status NOT IN ('cancelled')`, examID, studentID, tid).Scan(&used, &override); err != nil {
			return err
		}
		maxAtt := maxAttempts
		if override != nil {
			maxAtt = override
		}
		if maxAtt != nil && used >= *maxAtt {
			return httpx.Conflict(httpx.CodeAttemptLimit, "batas percobaan tercapai", )
		}
		// satu sesi aktif per ujian (FR-1.6)
		var activeAttempt *string
		_ = tx.QueryRow(r.Context(),
			`SELECT id FROM attempts WHERE tenant_id=$1 AND exam_id=$2 AND student_id=$3 AND status='in_progress' ORDER BY attempt_no DESC LIMIT 1`,
			tid, examID, studentID).Scan(&activeAttempt)
		if activeAttempt != nil {
			// lanjutkan attempt yang sama (pemulihan) — kembalikan attempt yang sedang berjalan
			var aid string
			var dl time.Time
			if err := tx.QueryRow(r.Context(),
				`SELECT id, deadline_at FROM attempts WHERE id=$1`, *activeAttempt).Scan(&aid, &dl); err != nil {
				return err
			}
			attemptID = aid
			_ = dl
			return errResume{attemptID: aid}
		}
		// buat attempt baru
		var attemptNo int
		if err := tx.QueryRow(r.Context(),
			`SELECT COALESCE(max(attempt_no),0)+1 FROM attempts WHERE tenant_id=$1 AND exam_id=$2 AND student_id=$3`, tid, examID, studentID).Scan(&attemptNo); err != nil {
			return err
		}
		var classSnap *string
		_ = tx.QueryRow(r.Context(), `SELECT c.name FROM students st LEFT JOIN classes c ON c.id=st.class_id WHERE st.tenant_id=$1 AND st.id=$2`, tid, studentID).Scan(&classSnap)
		deadline := now.Add(time.Duration(durMin) * time.Minute)
		if closePolicy == "hard" && closeAt != nil && deadline.After(*closeAt) {
			deadline = *closeAt
		}
		var seed int64
		if err := tx.QueryRow(r.Context(), `SELECT (random()*9223372036854775807)::bigint`).Scan(&seed); err != nil {
			seed = now.UnixNano()
		}
		err := tx.QueryRow(r.Context(),
			`INSERT INTO attempts (tenant_id, exam_id, set_version_id, student_id, attempt_no, class_snapshot, status, started_at, deadline_at, shuffle_seed)
			 VALUES ($1,$2,$3,$4,$5,$6,'in_progress', $7, $8, $9) RETURNING id`,
			tid, examID, setVerID, studentID, attemptNo, classSnap, now, deadline, seed).Scan(&attemptID)
		if err != nil {
			return err
		}
		_ = deadline
		if device != "" {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO attempt_sessions (tenant_id, attempt_id, device_hash) VALUES ($1,$2,$3)`, tid, attemptID, device); err != nil {
				// sudah ada sesi aktif → ganti sesi lama (replace_old)
				_, _ = tx.Exec(r.Context(), `UPDATE attempt_sessions SET revoked_at=now(), revoked_by='new_login' WHERE attempt_id=$1 AND revoked_at IS NULL`, attemptID)
				_, err = tx.Exec(r.Context(), `INSERT INTO attempt_sessions (tenant_id, attempt_id, device_hash) VALUES ($1,$2,$3)`, tid, attemptID, device)
				if err != nil {
					return err
				}
			}
		}
		s.Audit.Log(r.Context(), tx, tid, "student", studentID, "attempt.start", "attempt", attemptID, map[string]any{"exam": examID, "attempt_no": attemptNo}, "")
		return nil
	})
	if err != nil {
		if re, ok := err.(errResume); ok {
			// kembalikan attempt aktif (lanjutkan), bukan error
			s.writePacket(w, r, tid, studentID, re.attemptID, true)
			return
		}
		httpx.WriteError(w, err)
		return
	}
	s.writePacket(w, r, tid, studentID, attemptID, false)
	_ = examName
}

type errResume struct{ attemptID string }

func (e errResume) Error() string { return "resume active attempt" }

// writePacket mengirim paket soal TANPA answer_key/rubric (Bagian 12) dengan shuffle deterministik per attempt.
func (s *Service) writePacket(w http.ResponseWriter, r *http.Request, tid, studentID, attemptID string, resumed bool) {
	var (
		examID, examName, setVerID, status string
		deadline, started                 time.Time
		seed                               int64
		shufQ, shufO                       bool
		durMin                             int
		maxAtt                             *int
		examCode                           string
		showScore, showReview, showExpl    bool
		penaltyMode                        string
		penaltyVal, penaltyMax             float64
		leaveTol                           int
		flagThr, autoSub                   *int
		antiEnabled, reqAll                bool
		cameraEnabled                      bool
	)
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(),
			`SELECT a.exam_id, e.name, a.set_version_id, a.status, a.deadline_at, a.started_at, a.shuffle_seed,
			        e.shuffle_questions, e.shuffle_options, e.duration_minutes, e.max_attempts, qs.exam_code,
			        e.show_score_immediately, e.show_review, e.show_explanations,
			        e.penalty_mode, e.penalty_value, e.penalty_max, e.leave_tolerance_seconds, e.flag_threshold, e.auto_submit_threshold,
			        e.anticheat_enabled, e.require_all_answered, e.camera_enabled
			 FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN question_sets qs ON qs.id=e.question_set_id
			 WHERE a.tenant_id=$1 AND a.id=$2 AND a.student_id=$3`, tid, attemptID, studentID).
			Scan(&examID, &examName, &setVerID, &status, &deadline, &started, &seed,
				&shufQ, &shufO, &durMin, &maxAtt, &examCode,
				&showScore, &showReview, &showExpl,
				&penaltyMode, &penaltyVal, &penaltyMax, &leaveTol, &flagThr, &autoSub,
				&antiEnabled, &reqAll, &cameraEnabled); err != nil {
			return httpx.NotFound("attempt tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}

	// muat soal versi attempt — KUNCI DIHAPUS (Bagian 12)
	type qRow struct {
		ID, Type, Body string
		OrderNo        int
		Opts           json.RawMessage
		StimID         *string
		Media          []string
		Points         float64
	}
	var questions []qRow
	var stimuli []map[string]any
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT id, type, body_html, order_no, options_json, stimulus_id, media_ids, points FROM questions WHERE set_version_id=$1 ORDER BY order_no`, setVerID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var q qRow
			if err := rws.Scan(&q.ID, &q.Type, &q.Body, &q.OrderNo, &q.Opts, &q.StimID, &q.Media, &q.Points); err != nil {
				return err
			}
			questions = append(questions, q)
		}
		if err := rws.Err(); err != nil {
			return err
		}
		srws, err := tx.Query(r.Context(), `SELECT id, order_no, title, content_html, media_ids FROM stimuli WHERE set_version_id=$1 ORDER BY order_no`, setVerID)
		if err != nil {
			return err
		}
		defer srws.Close()
		for srws.Next() {
			var id, content string
			var order int
			var title *string
			var media []string
			if err := srws.Scan(&id, &order, &title, &content, &media); err != nil {
				return err
			}
			stimuli = append(stimuli, map[string]any{"id": id, "order_no": order, "title": title, "content_html": content, "media_ids": media})
		}
		return srws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}

	// shuffle deterministik per attempt (FR: acak urutan soal & opsi per siswa)
	rng := rand.New(rand.NewSource(seed))
	if shufQ {
		rng.Shuffle(len(questions), func(i, j int) { questions[i], questions[j] = questions[j], questions[i] })
	}
	for i := range questions {
		questions[i].OrderNo = i + 1
		if shufO {
			questions[i].Opts = shuffleOptions(questions[i].Opts, questions[i].Type, rng)
		}
	}

	pq := make([]packetQuestion, len(questions))
	for i, q := range questions {
		pq[i] = packetQuestion{ID: q.ID, OrderNo: q.OrderNo, Type: q.Type, BodyHTML: q.Body, OptionsJSON: q.Opts, StimulusID: q.StimID, MediaIDs: q.Media, Points: q.Points}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"attempt_id": attemptID,
		"resumed":    resumed,
		"exam": map[string]any{
			"id": examID, "name": examName, "exam_code": examCode, "duration_minutes": durMin,
			"show_score_immediately": showScore, "show_review": showReview, "show_explanations": showExpl,
			"max_attempts": maxAtt, "require_all_answered": reqAll,
			"anticheat": map[string]any{
				"enabled": antiEnabled, "leave_tolerance_seconds": leaveTol,
				"penalty_mode": penaltyMode, "penalty_value": penaltyVal, "penalty_max": penaltyMax,
				"flag_threshold": flagThr, "auto_submit_threshold": autoSub,
			},
			"camera_enabled": cameraEnabled,
		},
		"started_at":  started,
		"deadline_at": deadline,
		"server_now":  s.Clock.Now(),
		"stimuli":     stimuli,
		"questions":   pq,
	})
}

// shuffleOptions mengacak urutan opsi (pilihan ganda / sisi kanan menjodohkan) — ID opsi tetap stabil.
func shuffleOptions(opts json.RawMessage, qtype string, rng *rand.Rand) json.RawMessage {
	if len(opts) == 0 {
		return opts
	}
	switch qtype {
	case "mcq", "mcq_complex":
		var arr []map[string]any
		if json.Unmarshal(opts, &arr) != nil || len(arr) < 2 {
			return opts
		}
		rng.Shuffle(len(arr), func(i, j int) { arr[i], arr[j] = arr[j], arr[i] })
		b, _ := json.Marshal(arr)
		return b
	case "matching":
		var m struct {
			Left  []map[string]any `json:"left"`
			Right []map[string]any `json:"right"`
		}
		if json.Unmarshal(opts, &m) != nil {
			return opts
		}
		rng.Shuffle(len(m.Right), func(i, j int) { m.Right[i], m.Right[j] = m.Right[j], m.Right[i] })
		b, _ := json.Marshal(m)
		return b
	}
	return opts
}

// --- GET /attempts/{id} pemulihan (FR-7.8) ---

func (s *Service) getAttempt(w http.ResponseWriter, r *http.Request) {
	claims := httpx.ClaimsFrom(r.Context())
	tid := claims.TenantID
	attemptID := chi.URLParam(r, "id")
	var out map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var examID, studentID, status string
		var deadline, started time.Time
		if err := tx.QueryRow(r.Context(),
			`SELECT exam_id, student_id, status, started_at, deadline_at FROM attempts WHERE tenant_id=$1 AND id=$2`, tid, attemptID).
			Scan(&examID, &studentID, &status, &started, &deadline); err != nil {
			return httpx.NotFound("attempt tidak ditemukan")
		}
		if claims.Role == "student" && studentID != claims.Sub {
			return httpx.Forbidden("bukan attempt Anda")
		}
		// jawaban yang sudah ter-ACK (server sebagai sumber akhir, FR-7.8)
		var answers []map[string]any
		rws, err := tx.Query(r.Context(),
			`SELECT question_id, answer_json, flagged, seq FROM attempt_answers WHERE attempt_id=$1 ORDER BY seq`, attemptID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var qid string
			var ans json.RawMessage
			var flagged bool
			var seq int64
			if err := rws.Scan(&qid, &ans, &flagged, &seq); err != nil {
				return err
			}
			answers = append(answers, map[string]any{"question_id": qid, "answer_json": rawOrNull(ans), "flagged": flagged, "seq": seq})
		}
		out = map[string]any{
			"attempt_id": attemptID, "exam_id": examID, "status": status,
			"started_at": started, "deadline_at": deadline, "server_now": s.Clock.Now(),
			"answers": answers,
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// --- POST /attempts/{id}/answers:sync (FR-7.4): batch event, idempoten via client_event_id (AC-3) ---

type syncEvent struct {
	ClientEventID string          `json:"client_event_id"`
	Type          string          `json:"type"` // answer | flag | nav | submit | violation | …
	QuestionID    string          `json:"question_id,omitempty"`
	Payload       json.RawMessage `json:"payload,omitempty"`
	ClientTS      *time.Time      `json:"client_ts,omitempty"`
	ElapsedMS     *int64          `json:"elapsed_ms,omitempty"`
	Seq           int64           `json:"seq"`
}

type syncInput struct {
	Events    []syncEvent `json:"events"`
	Submitted bool        `json:"submitted,omitempty"`
	Reason    string      `json:"submit_reason,omitempty"` // manual | offline_sync
}

func (s *Service) syncAnswers(w http.ResponseWriter, r *http.Request) {
	claims := httpx.ClaimsFrom(r.Context())
	tid := claims.TenantID
	attemptID := chi.URLParam(r, "id")
	var in syncInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	now := s.Clock.Now()
	acked := make([]map[string]any, 0, len(in.Events))
	var submitNow bool
	var reason string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var studentID, status string
		var deadline time.Time
		var lastSeq int64
		var leaveTol int
		var antiEnabled bool
		if err := tx.QueryRow(r.Context(),
			`SELECT a.student_id, a.status, a.deadline_at, a.last_seq, e.leave_tolerance_seconds, e.anticheat_enabled
			 FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.tenant_id=$1 AND a.id=$2`, tid, attemptID).
			Scan(&studentID, &status, &deadline, &lastSeq, &leaveTol, &antiEnabled); err != nil {
			return httpx.NotFound("attempt tidak ditemukan")
		}
		if claims.Role == "student" && studentID != claims.Sub {
			return httpx.Forbidden("bukan attempt Anda")
		}
		// H2: event yang sudah selesai (graded/submitted) tetap dicatat untuk audit,
		// tapi TIDAK mengubah jawaban/bendera — proyeksi hanya untuk attempt aktif.
		projectable := status == "in_progress" || status == "pending_sync"
		if status == "cancelled" {
			return httpx.Err(httpx.CodeAttemptExpired, "attempt sudah dibatalkan", 410)
		}
		for _, ev := range in.Events {
			if ev.ClientEventID == "" {
				return httpx.BadRequest(httpx.CodeValidation, "client_event_id wajib untuk idempotensi")
			}
			// AC-5: validasi deadline + toleransi (otoritas server, FR-7.5)
			accepted := now.Before(deadline.Add(DeadlineTolerance))
			rejectReason := ""
			if !accepted {
				rejectReason = "past_deadline"
			}
			tag, err := tx.Exec(r.Context(),
				`INSERT INTO attempt_events (tenant_id, attempt_id, client_event_id, type, payload, client_ts, elapsed_ms, seq, accepted, reject_reason)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
				 ON CONFLICT (attempt_id, client_event_id) DO NOTHING`,
				tid, attemptID, ev.ClientEventID, ev.Type, payloadOrEmpty(ev.Payload), ev.ClientTS, ev.ElapsedMS, ev.Seq, accepted, nullStr2(rejectReason))
			if err != nil {
				return err
			}
			acked = append(acked, map[string]any{"client_event_id": ev.ClientEventID, "accepted": accepted, "duplicate": tag.RowsAffected() == 0})
			if !accepted {
				continue // jawaban lewat deadline ditolak & ditandai (AC-5)
			}
			// H3: seq monotonik server-side — klien dapat mengirim seq besar/rusak;
			// clamp agar LWW tidak pernah membuang jawaban berikutnya.
			seq := lastSeq + 1
			if ev.Seq > lastSeq {
				seq = ev.Seq
			}
			// proyeksi last-write-wins by seq (FR-7.4)
			switch ev.Type {
			case "answer":
				if ev.QuestionID == "" {
					continue
				}
				if !projectable {
					continue // H2: tidak mengubah jawaban setelah selesai
				}
				_, _ = tx.Exec(r.Context(),
					`INSERT INTO attempt_answers (tenant_id, attempt_id, question_id, answer_json, seq, updated_at)
					 VALUES ($1,$2,$3,$4,$5, now())
					 ON CONFLICT (attempt_id, question_id) DO UPDATE SET
					   answer_json = CASE WHEN excluded.seq > attempt_answers.seq THEN excluded.answer_json ELSE attempt_answers.answer_json END,
					   seq = GREATEST(attempt_answers.seq, excluded.seq), updated_at = now()`,
					tid, attemptID, ev.QuestionID, payloadOrEmpty(ev.Payload), seq)
			case "flag":
				if !projectable {
					continue // H2
				}
				var p struct {
					Flagged bool `json:"flagged"`
				}
				_ = json.Unmarshal(ev.Payload, &p)
				_, _ = tx.Exec(r.Context(),
					`INSERT INTO attempt_answers (tenant_id, attempt_id, question_id, flagged, seq, updated_at)
					 VALUES ($1,$2,$3,$4,$5, now())
					 ON CONFLICT (attempt_id, question_id) DO UPDATE SET
					   flagged = CASE WHEN excluded.seq > attempt_answers.seq THEN excluded.flagged ELSE attempt_answers.flagged END,
					   seq = GREATEST(attempt_answers.seq, excluded.seq), updated_at = now()`,
					tid, attemptID, ev.QuestionID, p.Flagged, seq)
			case "violation":
				// H4: pelanggaran yang disinkron dari outbox offline tetap masuk
				// attempt_violations (dasar perhitungan penalti di gradeAttempt).
				var v struct {
					Type       string `json:"type"`
					DurationMS int    `json:"duration_ms"`
					StartedAt  string `json:"started_at"`
				}
				_ = json.Unmarshal(ev.Payload, &v)
				if v.Type == "" {
					v.Type = "tab_hidden"
				}
				startedAt := now
				if ts, err := parseTime(v.StartedAt); err == nil {
					startedAt = ts
				} else if ev.ClientTS != nil {
					startedAt = *ev.ClientTS
				}
				counted := antiEnabled && v.DurationMS > leaveTol*1000
				_, _ = tx.Exec(r.Context(),
					`INSERT INTO attempt_violations (tenant_id, attempt_id, client_event_id, type, started_at, duration_ms, counted)
					 VALUES ($1,$2,$3,$4,$5,$6,$7)
					 ON CONFLICT (attempt_id, client_event_id) DO NOTHING`,
					tid, attemptID, ev.ClientEventID, v.Type, startedAt, v.DurationMS, counted)
			case "submit":
				submitNow = true
				reason = "manual"
			}
			if seq > 0 {
				_, _ = tx.Exec(r.Context(), `UPDATE attempts SET last_seq = GREATEST(last_seq, $1) WHERE id=$2`, seq, attemptID)
				lastSeq = seq
			}
		}
		_, _ = tx.Exec(r.Context(), `UPDATE attempts SET last_seen_at=now(), answered_count=(SELECT count(*) FROM attempt_answers WHERE attempt_id=$1 AND answer_json IS NOT NULL) WHERE id=$1`, attemptID)
		if in.Submitted {
			submitNow = true
			if in.Reason != "" {
				reason = in.Reason
			}
		}
		if submitNow && status == "in_progress" {
			if _, err := tx.Exec(r.Context(),
				`UPDATE attempts SET status='pending_sync', submit_reason=$1, submitted_at=now() WHERE id=$2`,
				nullStr2(reason), attemptID); err != nil {
				return err
			}
			// langsung nilai (server online saat terima) → status akhir di-set oleh gradeAttempt
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	// bila submit ikut terkirim pada batch yang sama → nilai sekarang (AC-4: saat online, attempt menjadi submitted)
	if submitNow {
		if err := s.gradeAttempt(r.Context(), tid, attemptID, reasonOr(reason, "offline_sync")); err != nil {
			httpx.WriteError(w, err)
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"acked": acked, "server_now": now})
}

func reasonOr(r, def string) string {
	if r == "" {
		return def
	}
	return r
}

func payloadOrEmpty(p json.RawMessage) json.RawMessage {
	if len(p) == 0 {
		return json.RawMessage("{}")
	}
	return p
}

func rawOrNull(b json.RawMessage) any {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil
	}
	return v
}

func nullStr2(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// --- POST /attempts/{id}/submit (online) ---

func (s *Service) submit(w http.ResponseWriter, r *http.Request) {
	claims := httpx.ClaimsFrom(r.Context())
	tid := claims.TenantID
	attemptID := chi.URLParam(r, "id")
	var in struct {
		ClientEventID string `json:"client_event_id"`
	}
	_ = httpx.DecodeJSON(r, &in)
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var studentID, status string
		if err := tx.QueryRow(r.Context(), `SELECT student_id, status FROM attempts WHERE tenant_id=$1 AND id=$2`, tid, attemptID).Scan(&studentID, &status); err != nil {
			return httpx.NotFound("attempt tidak ditemukan")
		}
		if studentID != claims.Sub {
			return httpx.Forbidden("bukan attempt Anda")
		}
		if status != "in_progress" && status != "pending_sync" {
			return httpx.Conflict("ALREADY_SUBMITTED", "attempt sudah selesai")
		}
		if in.ClientEventID != "" {
			_, _ = tx.Exec(r.Context(),
				`INSERT INTO attempt_events (tenant_id, attempt_id, client_event_id, type, payload, seq, accepted)
				 VALUES ($1,$2,$3,'submit','{}', (SELECT COALESCE(max(seq),0)+1 FROM attempt_events WHERE attempt_id=$2), true)
				 ON CONFLICT (attempt_id, client_event_id) DO NOTHING`, tid, attemptID, in.ClientEventID)
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if err := s.gradeAttempt(r.Context(), tid, attemptID, "manual"); err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "attempt_id": attemptID})
}

// --- GET /attempts/{id}/result (FR-5.4/6.5) ---

func (s *Service) result(w http.ResponseWriter, r *http.Request) {
	claims := httpx.ClaimsFrom(r.Context())
	tid := claims.TenantID
	attemptID := chi.URLParam(r, "id")
	var out map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var studentID, status, examID string
		var raw, max, penalty, final *float64
		var provisional bool
		var passed *bool
		var showScore, showReview, showExpl bool
		var released *time.Time
		var vcount int
		var cheat string
		if err := tx.QueryRow(r.Context(),
			`SELECT a.student_id, a.status, a.exam_id, a.raw_score, a.max_score, a.penalty_points, a.final_score, a.score_provisional, a.passed,
			        e.show_score_immediately, e.show_review, e.show_explanations, e.scores_released_at,
			        COALESCE(a.violation_count,0), COALESCE(a.cheating_status,'none')
			 FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.tenant_id=$1 AND a.id=$2`, tid, attemptID).
			Scan(&studentID, &status, &examID, &raw, &max, &penalty, &final, &provisional, &passed, &showScore, &showReview, &showExpl, &released, &vcount, &cheat); err != nil {
			return httpx.NotFound("attempt tidak ditemukan")
		}
		if claims.Role == "student" && studentID != claims.Sub {
			return httpx.Forbidden("bukan attempt Anda")
		}
		out = map[string]any{
			"attempt_id": attemptID, "exam_id": examID, "status": status,
			"raw_score": raw, "max_score": max, "penalty_points": penalty, "final_score": final,
			"provisional": provisional, "passed": passed,
			"violation_count": vcount, "cheating_status": cheat,
		}
		canShow := showScore || released != nil
		out["score_visible"] = canShow && status != "in_progress" && status != "pending_sync"
		if out["score_visible"].(bool) && (showReview || claims.Role != "student") {
			// review per soal: jawaban siswa + benar/salah + skor (kunci hanya bila show_review & sudah rilis)
			rws, err := tx.Query(r.Context(),
				`SELECT aa.question_id, q.order_no, q.type, q.points, aa.answer_json, aa.flagged, aa.is_correct, aa.score, aa.graded_by,
				        CASE WHEN $3 THEN q.answer_key_json ELSE NULL END,
				        CASE WHEN $4 THEN q.explanation_html ELSE NULL END
				 FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id
				 WHERE aa.attempt_id=$1 ORDER BY q.order_no`, attemptID, showReview, showExpl)
			if err != nil {
				return err
			}
			defer rws.Close()
			var review []map[string]any
			for rws.Next() {
				var qid, qtype, gradedBy string
				var order int
				var points float64
				var ans, key json.RawMessage
				var flagged bool
				var correct *bool
				var score *float64
				var expl *string
				if err := rws.Scan(&qid, &order, &qtype, &points, &ans, &flagged, &correct, &score, &gradedBy, &key, &expl); err != nil {
					return err
				}
				review = append(review, map[string]any{
					"question_id": qid, "order_no": order, "type": qtype, "points": points,
					"answer": rawOrNull(ans), "flagged": flagged, "is_correct": correct, "score": score,
					"graded_by": gradedBy, "answer_key": rawOrNull(key), "explanation": expl,
				})
			}
			out["review"] = review
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// --- Auto-submit oleh worker (AC-5): deadline lewat → submit reason timeout ---

func (s *Service) AutoSubmitExpired(ctx context.Context) (int, error) {
	var n int
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		rws, err := tx.Query(ctx,
			`SELECT id, tenant_id FROM attempts WHERE status='in_progress' AND deadline_at < now() - make_interval(secs => $1)`, DeadlineTolerance.Seconds())
		if err != nil {
			return err
		}
		var ids []struct{ id, tid string }
		for rws.Next() {
			var id, tid string
			if err := rws.Scan(&id, &tid); err != nil {
				return err
			}
			ids = append(ids, struct{ id, tid string }{id, tid})
		}
		rws.Close()
		for _, it := range ids {
			if _, err := tx.Exec(ctx,
				`UPDATE attempts SET status='submitted', submit_reason='timeout', submitted_at=now() WHERE id=$1 AND status='in_progress'`, it.id); err != nil {
				return err
			}
			n++
		}
		return nil
	})
	if err != nil {
		return n, err
	}
	if g, err := s.GradePendingAttempts(ctx); err != nil {
		return n, err
	} else {
		n += g
	}
	return n, nil
}

// GradePendingAttempts menilai semua attempt yang sudah selesai pengerjaan tetapi
// belum punya skor (H5): force-submit guru, submit timeout, atau sync offline
// yang gagal di tengah jalan — dijalankan worker secara periodik.
func (s *Service) GradePendingAttempts(ctx context.Context) (int, error) {
	rows, err := s.DB.System.Query(ctx,
		`SELECT id, tenant_id FROM attempts
		 WHERE status IN ('submitted','pending_sync') AND raw_score IS NULL`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []struct{ id, tid string }
	for rows.Next() {
		var id, tid string
		if err := rows.Scan(&id, &tid); err != nil {
			return 0, err
		}
		ids = append(ids, struct{ id, tid string }{id, tid})
	}
	rows.Close()
	n := 0
	for _, it := range ids {
		if err := s.gradeAttempt(ctx, it.tid, it.id, ""); err == nil {
			n++
		}
	}
	return n, nil
}

var _ = sort.Strings
var _ = grading.FinalScore

// Handler eksplisit agar server bisa memasangnya per peran (siswa vs guru).
func (s *Service) StartHandler() http.HandlerFunc            { return s.start }
func (s *Service) RegradeHandler() http.HandlerFunc          { return s.regradeExam }
func (s *Service) GetHandler() http.HandlerFunc              { return s.getAttempt }
func (s *Service) SyncHandler() http.HandlerFunc             { return s.syncAnswers }
func (s *Service) SubmitHandler() http.HandlerFunc           { return s.submit }
func (s *Service) ViolationsHandler() http.HandlerFunc       { return s.addViolations }
func (s *Service) ResultHandler() http.HandlerFunc           { return s.result }
func (s *Service) GradingHandler() http.HandlerFunc          { return s.gradingDetail }
func (s *Service) PutScoreHandler() http.HandlerFunc         { return s.putScore }
func (s *Service) CheatingDecisionHandler() http.HandlerFunc { return s.cheatingDecision }
