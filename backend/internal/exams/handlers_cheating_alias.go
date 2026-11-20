// handlers_cheating_alias.go — PUT /attempts/{attemptID}/cheating-decision
// (alias staf sesuai PRD §9; logika sama dengan /exams/{examID}/cheating-decision).
package exams

import (
	"net/http"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

type cheatDecisionAttemptReq struct {
	Decision string `json:"decision" validate:"required,oneof=valid cancel_penalty disqualify"`
	Reason   string `json:"reason"`
}

func (m *Module) attemptCheatingDecision(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req cheatDecisionAttemptReq
	if !m.decode(w, r, &req) {
		return
	}
	switch req.Decision {
	case "cancel_penalty", "disqualify":
		if req.Reason == "" {
			httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "REASON_REQUIRED",
				"Alasan wajib diisi untuk membatalkan penalti / diskualifikasi"))
			return
		}
	}
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		return applyCheatingDecision(r, tx, tenantID, attemptID, req.Decision, req.Reason)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"attempt_id": attemptID, "decision": req.Decision,
	}})
}

func applyCheatingDecision(r *http.Request, tbody pgx.Tx, tenantID, attemptID, decision, reason string) error {
	ctx2 := r.Context()
	a, err := loadAttempt(ctx2, tbody, attemptID)
	if err != nil {
		return err
	}
	switch decision {
	case "valid":
		final := gradingFinal(a.Score, a.MaxScore, 0)
		if _, err := tbody.Exec(ctx2, `
			UPDATE attempts SET penalty_points=0, final_score=$2, cheating_status='none',
				penalty_note=$3 WHERE id=$1`,
			a.ID, final, noteOf("valid", reason)); err != nil {
			return err
		}
	case "cancel_penalty":
		final := gradingFinal(a.Score, a.MaxScore, 0)
		if _, err := tbody.Exec(ctx2, `
			UPDATE attempts SET penalty_points=0, final_score=$2, penalty_note=$3 WHERE id=$1`,
			a.ID, final, noteOf("cancel_penalty", reason)); err != nil {
			return err
		}
		if _, err := tbody.Exec(ctx2, `
			UPDATE attempt_violations SET cancelled=true, cancel_reason=$2
			WHERE attempt_id=$1 AND cancelled=false`, a.ID, reason); err != nil {
			return err
		}
	case "disqualify":
		if _, err := tbody.Exec(ctx2, `
			UPDATE attempts SET status='disqualified', score=0, final_score=0,
				cheating_status='disqualified', penalty_note=$2 WHERE id=$1`,
			a.ID, noteOf("disqualify", reason)); err != nil {
			return err
		}
	}
	return audit(ctx2, tbody, tenantID, ctxinfo.Claims(ctx2),
		"cheating_decision", "attempt", a.ID,
		map[string]any{"decision": decision, "reason": reason})
}
