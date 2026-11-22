// handlers_cheating_summary.go — GET /exams/cheating-summary: ringkasan
// kecurangan lintas ujian untuk menu "Anti-Curang" staf (FR-5.8C, PRD §9).
// Satu query ringkas per ujian + agregat jenis pelanggaran; detail &
// keputusan tetap di halaman per-ujian (/exams/{examID}/cheating-report).
package exams

import (
	"encoding/json"
	"net/http"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// cheatSummaryExam satu baris ringkasan per ujian.
type cheatSummaryExam struct {
	ExamID           string  `json:"exam_id"`
	Name             string  `json:"name"`
	SubjectName      string  `json:"subject_name"`
	ExamCode         string  `json:"exam_code"`
	Status           string  `json:"status"`
	AntiCheatEnabled bool    `json:"anti_cheat_enabled"`
	Attempts         int     `json:"attempts"`
	Violators        int     `json:"violators"`
	Violations       int     `json:"violations"`
	Warned           int     `json:"warned"`
	Flagged          int     `json:"flagged"`
	PenaltyPoints    float64 `json:"penalty_points"`
}

// cheatSummaryType agregat satu jenis pelanggaran.
type cheatSummaryType struct {
	Type string `json:"type"`
	N    int    `json:"n"`
}

// enabledFromAntiCheatJSON membaca flag "enabled" dari JSONB anti_cheat
// (kosong/rusak → false: ujian tanpa konfigurasi tidak dihitung aktif).
func enabledFromAntiCheatJSON(s string) bool {
	if s == "" || s == "{}" {
		return false
	}
	var ac AntiCheat
	if err := json.Unmarshal([]byte(s), &ac); err != nil {
		return false
	}
	return ac.Enabled
}

func (m *Module) cheatingSummary(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	exams := []cheatSummaryExam{}
	byType := []cheatSummaryType{}
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), `
			SELECT e.id::text, e.name, COALESCE(e.subject_name,''), COALESCE(e.exam_code,''),
				e.status, COALESCE(e.anti_cheat::text,'{}'),
				(SELECT COUNT(*) FROM attempts a WHERE a.exam_id=e.id),
				(SELECT COUNT(DISTINCT v.attempt_id) FROM attempt_violations v
					JOIN attempts a2 ON a2.id=v.attempt_id
					WHERE a2.exam_id=e.id AND v.cancelled=false),
				(SELECT COUNT(*) FROM attempt_violations v
					JOIN attempts a3 ON a3.id=v.attempt_id
					WHERE a3.exam_id=e.id AND v.cancelled=false),
				(SELECT COUNT(*) FROM attempts a4 WHERE a4.exam_id=e.id
					AND a4.cheating_status IN ('warned','warning')),
				(SELECT COUNT(*) FROM attempts a5 WHERE a5.exam_id=e.id
					AND a5.cheating_status='flagged'),
				(SELECT COALESCE(SUM(a6.penalty_points),0) FROM attempts a6 WHERE a6.exam_id=e.id)
			FROM exams e
			ORDER BY e.created_at DESC`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var row cheatSummaryExam
			var acJSON string
			if err := rows.Scan(&row.ExamID, &row.Name, &row.SubjectName, &row.ExamCode,
				&row.Status, &acJSON, &row.Attempts, &row.Violators, &row.Violations,
				&row.Warned, &row.Flagged, &row.PenaltyPoints); err != nil {
				return err
			}
			row.AntiCheatEnabled = enabledFromAntiCheatJSON(acJSON)
			exams = append(exams, row)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		trows, err := tx.Query(r.Context(), `
			SELECT v.type, COUNT(*) FROM attempt_violations v
			WHERE v.cancelled=false GROUP BY v.type ORDER BY COUNT(*) DESC`)
		if err != nil {
			return err
		}
		defer trows.Close()
		for trows.Next() {
			var t cheatSummaryType
			if err := trows.Scan(&t.Type, &t.N); err != nil {
				return err
			}
			byType = append(byType, t)
		}
		return trows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	totals := map[string]int{}
	for _, e := range exams {
		totals["flagged"] += e.Flagged
		totals["warned"] += e.Warned
		totals["violations"] += e.Violations
		totals["violators"] += e.Violators
		if e.Flagged > 0 || e.Warned > 0 || e.Violations > 0 {
			totals["examsWith"]++
		}
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"exams": exams, "by_type": byType, "totals": totals,
	}})
}
