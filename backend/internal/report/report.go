// Package report: laporan real-time & historis, analisis butir, rekap nilai, export (M9).
package report

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"
	"flowcbt/backend/internal/realtime"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
)

type Service struct {
	DB   *platform.DB
	Hub  *realtime.Hub
	Clock platform.Clock
}

func (s *Service) Routes(r chi.Router) {
	r.Route("/reports", func(r chi.Router) {
		r.Get("/live", s.liveList)
		r.Get("/live/{examId}", s.liveExam)
		r.Get("/live/stream", s.liveStream) // SSE
		r.Get("/history", s.history)
		r.Get("/exams/{id}", s.examReport)
		r.Get("/exams/{id}/attempts", s.examAttempts)
		r.Get("/exams/{id}/item-analysis", s.itemAnalysis)
		r.Get("/exams/{id}/export", s.exportExam)
	})
}

// liveList: ujian yang sedang berjalan (FR-9.1).
func (s *Service) liveList(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	now := s.Clock.Now()
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT e.id, e.name, qs.subject_name, e.close_at,
			        (SELECT count(*) FROM exam_participants ep WHERE ep.exam_id=e.id),
			        (SELECT count(*) FROM attempts a WHERE a.exam_id=e.id AND a.status='in_progress'),
			        (SELECT count(*) FROM attempts a WHERE a.exam_id=e.id AND a.status NOT IN ('in_progress','cancelled')),
			        (SELECT count(*) FROM attempts a WHERE a.exam_id=e.id AND a.last_seen_at < $2 - interval '5 minutes' AND a.status='in_progress')
			 FROM exams e JOIN question_sets qs ON qs.id=e.question_set_id
			 WHERE e.tenant_id=$1 AND e.status='published' AND (e.open_at IS NULL OR e.open_at <= $2) AND (e.close_at IS NULL OR e.close_at >= $2)
			 ORDER BY e.open_at DESC`, tid, now)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id, name, subject string
			var closeAt *time.Time
			var total, inProg, done, offline int
			if err := rws.Scan(&id, &name, &subject, &closeAt, &total, &inProg, &done, &offline); err != nil {
				return err
			}
			rows = append(rows, map[string]any{
				"exam_id": id, "name": name, "subject": subject, "close_at": closeAt,
				"total": total, "in_progress": inProg, "done": done, "offline_stale": offline,
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// liveExam: detail per siswa untuk satu ujian berjalan (FR-9.2) + publish ke SSE.
func (s *Service) liveExam(w http.ResponseWriter, r *http.Request) {
	s.writeLive(w, r, true)
}

func (s *Service) writeLive(w http.ResponseWriter, r *http.Request, publish bool) {
	tid := httpx.TenantIDFrom(r.Context())
	examID := chi.URLParam(r, "examId")
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT st.id, st.name, st.student_code, COALESCE(c.name,''), st.is_guest,
			        COALESCE(a.status,'not_started'), COALESCE(a.answered_count,0),
			        (SELECT count(*) FROM questions q WHERE q.set_version_id = e.set_version_id),
			        a.last_seen_at, a.violation_count, a.cheating_status, a.id
			 FROM exam_participants ep
			 JOIN students st ON st.id=ep.student_id
			 LEFT JOIN classes c ON c.id=st.class_id
			 JOIN exams e ON e.id=ep.exam_id
			 LEFT JOIN attempts a ON a.exam_id=ep.exam_id AND a.student_id=ep.student_id AND a.status NOT IN ('cancelled')
			   AND a.attempt_no = (SELECT max(attempt_no) FROM attempts WHERE exam_id=ep.exam_id AND student_id=ep.student_id AND status NOT IN ('cancelled'))
			 WHERE ep.tenant_id=$1 AND ep.exam_id=$2
			 ORDER BY c.name, st.name`, tid, examID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var sid, name, code, className, status, cheat string
			var guest bool
			var answered, total int
			var lastSeen *time.Time
			var vcount int
			var attemptID *string
			if err := rws.Scan(&sid, &name, &code, &className, &guest, &status, &answered, &total, &lastSeen, &vcount, &cheat, &attemptID); err != nil {
				return err
			}
			rows = append(rows, map[string]any{
				"student_id": sid, "name": name, "student_code": code, "class": className, "is_guest": guest,
				"status": status, "answered": answered, "total_questions": total,
				"last_seen_at": lastSeen, "violation_count": vcount, "cheating_status": cheat,
				"attempt_id": attemptID,
				"offline": lastSeen != nil && time.Since(*lastSeen) > 5*time.Minute,
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	payload, _ := json.Marshal(map[string]any{"exam_id": examID, "participants": rows, "at": s.Clock.Now()})
	if publish && s.Hub != nil {
		s.Hub.Publish("live:"+tid+":"+examID, string(payload))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"exam_id": examID, "participants": rows})
}

// liveStream: SSE (FR-9.3); klien subscribe topic live:<tenant>:<examId>.
func (s *Service) liveStream(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	examID := r.URL.Query().Get("examId")
	topic := "live:" + tid
	if examID != "" {
		topic += ":" + examID
	}
	s.Hub.SSE(w, r, topic)
}

// PublishLive dipanggil saat ada perubahan (dari modul attempt/others) — opsional.
func (s *Service) PublishLive(tid, examID string) {
	if s.Hub != nil {
		s.Hub.Publish("live:"+tid+":"+examID, "")
	}
}

// history: daftar ujian selesai + filter (FR-9.6/9.7).
func (s *Service) history(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	q := r.URL.Query().Get("q")
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		query := `SELECT e.id, e.name, qs.subject_name, qs.exam_code, e.status, e.open_at, e.close_at, e.published_at,
		   (SELECT count(*) FROM attempts a WHERE a.exam_id=e.id AND a.status NOT IN ('cancelled')),
		   (SELECT avg(a.final_score) FROM attempts a WHERE a.exam_id=e.id AND a.status IN ('graded','awaiting_manual_grading') AND a.cheating_status <> 'disqualified')
		FROM exams e JOIN question_sets qs ON qs.id=e.question_set_id
		WHERE e.tenant_id=$1 AND e.status IN ('published','closed','paused')`
		args := []any{tid}
		if q != "" {
			query += ` AND (e.name || ' ' || qs.subject_name || ' ' || qs.exam_code) ILIKE '%'||$2||'%'`
			args = append(args, q)
		}
		query += ` ORDER BY COALESCE(e.close_at, e.published_at) DESC NULLS LAST LIMIT 200`
		rws, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id, name, subject, code, status string
			var openAt, closeAt, pubAt *time.Time
			var attempts int
			var avg *float64
			if err := rws.Scan(&id, &name, &subject, &code, &status, &openAt, &closeAt, &pubAt, &attempts, &avg); err != nil {
				return err
			}
			rows = append(rows, map[string]any{
				"exam_id": id, "name": name, "subject": subject, "exam_code": code, "status": status,
				"open_at": openAt, "close_at": closeAt, "published_at": pubAt, "attempts": attempts, "avg_score": avg,
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// examReport: statistik per ujian (FR-9.8): rata-rata, max/min, median, kelulusan, histogram.
func (s *Service) examReport(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	examID := chi.URLParam(r, "id")
	var out map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var name, subject string
		var passing *float64
		if err := tx.QueryRow(r.Context(),
			`SELECT e.name, qs.subject_name, e.passing_score FROM exams e JOIN question_sets qs ON qs.id=e.question_set_id WHERE e.tenant_id=$1 AND e.id=$2`,
			tid, examID).Scan(&name, &subject, &passing); err != nil {
			return httpx.NotFound("ujian tidak ditemukan")
		}
		var count int
		var avg, min, max, median *float64
		if err := tx.QueryRow(r.Context(),
			`SELECT count(*), avg(final_score), min(final_score), max(final_score), percentile_cont(0.5) WITHIN GROUP (ORDER BY final_score)
			 FROM attempts WHERE tenant_id=$1 AND exam_id=$2 AND status IN ('graded','awaiting_manual_grading') AND cheating_status <> 'disqualified'`,
			tid, examID).Scan(&count, &avg, &min, &max, &median); err != nil {
			return err
		}
		var passed int
		if passing != nil {
			if err := tx.QueryRow(r.Context(),
				`SELECT count(*) FROM attempts WHERE tenant_id=$1 AND exam_id=$2 AND passed=true`, tid, examID).Scan(&passed); err != nil {
				return err
			}
		}
		// histogram 0-100 per 10
		hist := map[string]int{}
		rws, err := tx.Query(r.Context(),
			`SELECT width_bucket(final_score, 0, 100, 10) AS b, count(*) FROM attempts
			 WHERE tenant_id=$1 AND exam_id=$2 AND status IN ('graded','awaiting_manual_grading') AND cheating_status <> 'disqualified'
			 GROUP BY b ORDER BY b`, tid, examID)
		if err != nil {
			return err
		}
		for rws.Next() {
			var b, c int
			if err := rws.Scan(&b, &c); err != nil {
				rws.Close()
				return err
			}
			hist[fmt.Sprintf("%d-%d", (b-1)*10, b*10)] = c
		}
		rws.Close()
		out = map[string]any{
			"exam_id": examID, "name": name, "subject": subject, "passing_score": passing,
			"count": count, "avg": avg, "min": min, "max": max, "median": median,
			"passed": passed, "pass_rate": passRate(passed, count), "histogram": hist,
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func passRate(p, n int) any {
	if n == 0 {
		return nil
	}
	return fmt.Sprintf("%.1f%%", float64(p)/float64(n)*100)
}

// examAttempts: rekap nilai per ujian (FR-3.6) + kebijakan nilai akhir multi-percobaan (FR-5.3).
func (s *Service) examAttempts(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	examID := chi.URLParam(r, "id")
	var scorePolicy string
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `SELECT score_policy FROM exams WHERE tenant_id=$1 AND id=$2`, tid, examID).Scan(&scorePolicy); err != nil {
			return httpx.NotFound("ujian tidak ditemukan")
		}
		rws, err := tx.Query(r.Context(),
			`SELECT a.id, st.id, st.name, st.student_code, COALESCE(c.name,''), a.attempt_no, a.status, a.final_score, a.raw_score,
			        a.penalty_points, a.cheating_status, a.started_at, a.submitted_at,
			        CASE WHEN a.submitted_at IS NOT NULL THEN EXTRACT(EPOCH FROM (a.submitted_at - a.started_at))::int ELSE NULL END
			 FROM attempts a JOIN students st ON st.id=a.student_id LEFT JOIN classes c ON c.id=st.class_id
			 WHERE a.tenant_id=$1 AND a.exam_id=$2 AND a.status NOT IN ('cancelled')
			 ORDER BY c.name, st.name, a.attempt_no`, tid, examID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var aid, sid, name, code, className, status, cheat string
			var no int
			var final, raw, penalty *float64
			var started, submitted *time.Time
			var dur *int
			if err := rws.Scan(&aid, &sid, &name, &code, &className, &no, &status, &final, &raw, &penalty, &cheat, &started, &submitted, &dur); err != nil {
				return err
			}
			rows = append(rows, map[string]any{
				"attempt_id": aid, "student_id": sid, "name": name, "student_code": code, "class": className,
				"attempt_no": no, "status": status, "final_score": final, "raw_score": raw,
				"penalty_points": penalty, "cheating_status": cheat, "started_at": started, "submitted_at": submitted, "duration_s": dur,
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"score_policy": scorePolicy, "attempts": rows})
}

// itemAnalysis: analisis butir soal (FR-9.9).
func (s *Service) itemAnalysis(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	examID := chi.URLParam(r, "id")
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var setVerID string
		if err := tx.QueryRow(r.Context(), `SELECT set_version_id FROM exams WHERE tenant_id=$1 AND id=$2`, tid, examID).Scan(&setVerID); err != nil {
			return httpx.NotFound("ujian tidak ditemukan")
		}
		rws, err := tx.Query(r.Context(),
			`SELECT q.id, q.order_no, q.type, q.points,
			        count(aa.id) AS answered,
			        count(*) FILTER (WHERE aa.is_correct = true) AS correct,
			        avg(aa.auto_score) AS avg_score
			 FROM questions q
			 LEFT JOIN attempt_answers aa ON aa.question_id = q.id
			   AND aa.attempt_id IN (SELECT id FROM attempts WHERE exam_id=$1 AND status NOT IN ('cancelled','in_progress','pending_sync'))
			 WHERE q.set_version_id=$2
			 GROUP BY q.id, q.order_no, q.type, q.points ORDER BY q.order_no`, examID, setVerID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var qid, qtype string
			var order int
			var points float64
			var answered, correct int
			var avgScore *float64
			if err := rws.Scan(&qid, &order, &qtype, &points, &answered, &correct, &avgScore); err != nil {
				return err
			}
			pct := 0.0
			if answered > 0 {
				pct = float64(correct) / float64(answered) * 100
			}
			rows = append(rows, map[string]any{
				"question_id": qid, "order_no": order, "type": qtype, "points": points,
				"answered": answered, "correct": correct, "pct_correct": fmt.Sprintf("%.1f", pct), "avg_score": avgScore,
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// exportExam: rekap nilai ujian ke xlsx/csv (FR-9.11).
func (s *Service) exportExam(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	examID := chi.URLParam(r, "id")
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "xlsx"
	}
	type row struct {
		Name, Code, Class, Status string
		Final, Raw, Penalty        *float64
		Submitted                  *time.Time
	}
	var rows []row
	var examName string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `SELECT name FROM exams WHERE tenant_id=$1 AND id=$2`, tid, examID).Scan(&examName); err != nil {
			return httpx.NotFound("ujian tidak ditemukan")
		}
		rws, err := tx.Query(r.Context(),
			`SELECT st.name, st.student_code, COALESCE(c.name,''), a.status, a.final_score, a.raw_score, a.penalty_points, a.submitted_at
			 FROM attempts a JOIN students st ON st.id=a.student_id LEFT JOIN classes c ON c.id=st.class_id
			 WHERE a.tenant_id=$1 AND a.exam_id=$2 AND a.status NOT IN ('cancelled') ORDER BY c.name, st.name`, tid, examID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var rw row
			if err := rws.Scan(&rw.Name, &rw.Code, &rw.Class, &rw.Status, &rw.Final, &rw.Raw, &rw.Penalty, &rw.Submitted); err != nil {
				return err
			}
			rows = append(rows, rw)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	header := []string{"Nama", "Kode Siswa", "Kelas", "Status", "Nilai Akhir", "Nilai Asli", "Penalti", "Submit"}
	data := [][]string{header}
	for _, rw := range rows {
		data = append(data, []string{rw.Name, rw.Code, rw.Class, rw.Status, f2s(rw.Final), f2s(rw.Raw), f2s(rw.Penalty), t2s(rw.Submitted)})
	}
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="rekap-%s.csv"`, strings.ReplaceAll(examName, " ", "-")))
		for _, d := range data {
			w.Write([]byte(strings.Join(d, ",") + "\n"))
		}
		return
	}
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	for ri, d := range data {
		for ci, v := range d {
			cell, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
			f.SetCellValue(sheet, cell, v)
		}
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="rekap-%s.xlsx"`, strings.ReplaceAll(examName, " ", "-")))
	_ = f.Write(w)
}

func f2s(f *float64) string {
	if f == nil {
		return ""
	}
	return fmt.Sprintf("%.2f", *f)
}

func t2s(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02 15:04:05")
}

var _ = context.Background

// AttemptsHandler mengekspos rekap nilai per ujian sebagai handler (dipasang di /exams/{id}/attempts sesuai PRD Bagian 9).
func (s *Service) AttemptsHandler() http.HandlerFunc { return s.examAttempts }
