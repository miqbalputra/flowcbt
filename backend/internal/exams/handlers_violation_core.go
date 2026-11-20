// handlers_violation_core.go — inti pencatatan pelanggaran & penalti, dipakai
// oleh POST /attempts/{id}/violations (online) dan event 'violation' antrean
// sync (offline → tersinkron). Penalti SELALU dihitung di server (FR-5.8, AC-8).
package exams

import (
	"context"
	"net/http"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/grading"

	"github.com/jackc/pgx/v5"
)

// violationCore meletakkan satu pelanggaran (idempoten oleh
// (attempt_id, client_event_id) sejak migrasi 0005),
// memperbarui penalti & status kecurangan (ES:warned → flagged), mengembalikan
// keadaan terkini. Pemanggil menyediakan tx aktif + exam yang dimuat.
func violationCore(ctx context.Context, tx pgx.Tx, tenantID string,
	a *attemptRecord, e *examRecord, req violationReq) (*violationResp, error) {
	ac := e.antiCheat()
	resp := &violationResp{CheatingStatus: a.CheatingStatus, Violations: 0,
		TotalPenalty: a.PenaltyPoints, WarnLeft: ac.FlagThreshold,
		AttemptActive: a.Status == "in_progress" || a.Status == "pending_sync"}
	// Tanpa efek: attempt sudah final / anti-cheat mati.
	if (a.Status != "in_progress" && a.Status != "pending_sync") || !ac.Enabled {
		if err := violationState(ctx, tx, a, ac, resp); err != nil {
			return nil, err
		}
		return resp, nil
	}
	var startedAt *time.Time
	if req.StartedAt != "" {
		if t, perr := time.Parse(time.RFC3339, req.StartedAt); perr == nil {
			startedAt = &t
		}
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO attempt_violations(tenant_id, attempt_id, type, started_at, duration_ms, penalty_applied, client_event_id)
		VALUES ($1,$2,$3,$4,$5,0,$6)
		ON CONFLICT (attempt_id, client_event_id) DO NOTHING`,
		tenantID, a.ID, req.Type, startedAt, req.DurationMS, req.ClientEventID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() > 0 {
		// Penalti satu langkah (WAJIB internal/grading — PRD 5.8: dihitung server).
		np := grading.ApplyPenalty(a.PenaltyPoints, ac.PenaltyPoints, 1, ac.MaxPenalty)
		if _, err := tx.Exec(ctx,
			`UPDATE attempt_violations SET penalty_applied=$2
			 WHERE attempt_id=$1 AND client_event_id=$3`,
			a.ID, np-a.PenaltyPoints, req.ClientEventID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE attempts SET penalty_points=$2 WHERE id=$1`, a.ID, np); err != nil {
			return nil, err
		}
		a.PenaltyPoints = np
	}
	if err := violationState(ctx, tx, a, ac, resp); err != nil {
		return nil, err
	}
	// cheating_status mengikuti kalkulasi total (AC-8)
	if resp.CheatingStatus != a.CheatingStatus {
		a.CheatingStatus = resp.CheatingStatus
	}
	return resp, nil
}

// violationFromEvent memetakan event sync 'violation' → violationCore.
// Payload: {violation_type, started_at(RFC3339), duration_ms} — bila kosong,
// dianggap focus_lost sederhana.
func (m *Module) violationFromEvent(ctx context.Context, tx pgx.Tx,
	r *http.Request, a *attemptRecord, e *examRecord, ev syncEventReq) (*violationResp, error) {
	vt := ev.Payload.VType
	if vt == "" {
		vt = "focus_lost"
	}
	if vt != "tab_hidden" && vt != "blur" && vt != "fullscreen_exit" && vt != "camera_off" &&
		vt != "no_face" && vt != "multi_face" {
		vt = "focus_lost"
	}
	req := violationReq{
		ClientEventID: ev.ClientEventID,
		Type:          vt,
		StartedAt:     ev.Payload.StartedAt,
		DurationMS:    ev.Payload.DurMS,
	}
	tenantID := ctxinfo.TenantID(r.Context())
	resp, err := violationCore(ctx, tx, tenantID, a, e, req)
	if err != nil {
		return nil, err
	}
	// Auto-submit dari antrean (AC-8): finalisasi sekarang.
	if resp != nil && resp.ShouldAutoSubmit && resp.AttemptActive {
		_, _ = finalizeAttempt(ctx, tx, tenantID, a, e, nowTS())
		a.Status = "submitted"
	}
	return resp, nil
}
