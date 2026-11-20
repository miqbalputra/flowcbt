package billing

import (
	"context"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

type Module struct{ a *app.App }

func Init(a *app.App) *Module { return &Module{a: a} }

// TenantQuota = status hak akses & kuota aktif tenant (PRD §3).
type TenantQuota struct {
	Status          string     `json:"status"`
	TrialEndsAt     *time.Time `json:"trial_ends_at"`
	RightsEndsAt    *time.Time `json:"rights_ends_at"`
	RetentionDelete *time.Time `json:"retention_delete_at"`
	MonthlyActive   bool       `json:"monthly_active"`
	MonthlyPlan     string     `json:"monthly_plan,omitempty"`
	MonthlyEndsAt   *time.Time `json:"monthly_ends_at,omitempty"`
	ExamCredits     int        `json:"exam_credits_remaining"`
	MaxStudents     int        `json:"max_students"`
	StudentsCount   int        `json:"students_count"`
	AccessOK        bool       `json:"access_ok"`
	ReadOnly        bool       `json:"read_only"`
}

// Quota menghitung status langganan & kuota tenant (via pool admin).
func (m *Module) Quota(ctx context.Context, tenantID string) (*TenantQuota, error) {
	q := &TenantQuota{Status: "active", MaxStudents: 10}
	err := m.a.DB.Admin.QueryRow(ctx, `
		SELECT status, trial_ends_at, rights_ends_at, retention_delete_at,
			COALESCE((SELECT MAX(p.max_students) FROM subscriptions s JOIN plans p ON p.id=s.plan_id
			 WHERE s.tenant_id=t.id AND s.status='active' AND (s.ends_at IS NULL OR s.ends_at > now())), 10)
		FROM tenants t WHERE t.id=$1`, tenantID).
		Scan(&q.Status, &q.TrialEndsAt, &q.RightsEndsAt, &q.RetentionDelete, &q.MaxStudents)
	if err != nil {
		return nil, err
	}
	var planName *string
	var monthlyEnd *time.Time
	err = m.a.DB.Admin.QueryRow(ctx, `
		SELECT p.name, s.ends_at FROM subscriptions s JOIN plans p ON p.id = s.plan_id
		WHERE s.tenant_id=$1 AND s.kind='monthly' AND s.status='active' AND (s.ends_at IS NULL OR s.ends_at > now())
		ORDER BY s.ends_at DESC NULLS LAST LIMIT 1`, tenantID).Scan(&planName, &monthlyEnd)
	if err == nil {
		q.MonthlyActive = true
		q.MonthlyPlan = *planName
		q.MonthlyEndsAt = monthlyEnd
	}
	var total, used int
	if err := m.a.DB.Admin.QueryRow(ctx, `
		SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(used),0)
		FROM exam_credits WHERE tenant_id=$1`, tenantID).Scan(&total, &used); err != nil {
		return nil, err
	}
	q.ExamCredits = total - used
	if q.MonthlyActive && q.MaxStudents == 0 {
		q.MaxStudents = 100
	}
	if q.StudentsCount, err = m.studentsCount(ctx, tenantID); err != nil {
		return nil, err
	}
	now := time.Now()
	trialOK := q.TrialEndsAt != nil && q.TrialEndsAt.After(now)
	q.AccessOK = trialOK || q.MonthlyActive || q.ExamCredits > 0
	q.ReadOnly = q.Status == "read_only"
	return q, nil
}

func (m *Module) studentsCount(ctx context.Context, tenantID string) (int, error) {
	var n int
	err := m.a.DB.Admin.QueryRow(ctx, `
		SELECT COUNT(1) FROM students
		WHERE tenant_id=$1 AND merged_into_id IS NULL AND status='active' AND is_guest=false`, tenantID).Scan(&n)
	return n, err
}

type QuotaDecision struct {
	Source      string `json:"source"` // trial|monthly|per_exam|none
	TrialActive bool   `json:"trial_active"`
}

// CheckExamQuota memutuskan sumber kuota tanpa memotong.
func (m *Module) CheckExamQuota(ctx context.Context, tenantID string) (*QuotaDecision, error) {
	dec := &QuotaDecision{Source: "none"}
	var trialEnd *time.Time
	if err := m.a.DB.Admin.QueryRow(ctx, `SELECT trial_ends_at FROM tenants WHERE id=$1`, tenantID).Scan(&trialEnd); err != nil {
		return nil, err
	}
	if trialEnd != nil && trialEnd.After(time.Now()) {
		dec.TrialActive = true
		dec.Source = "trial"
		return dec, nil
	}
	var monthly int
	if err := m.a.DB.Admin.QueryRow(ctx, `
		SELECT COUNT(1) FROM subscriptions WHERE tenant_id=$1 AND kind='monthly' AND status='active'
		AND (ends_at IS NULL OR ends_at > now())`, tenantID).Scan(&monthly); err != nil {
		return nil, err
	}
	if monthly > 0 {
		dec.Source = "monthly"
		return dec, nil
	}
	var credits int
	if err := m.a.DB.Admin.QueryRow(ctx, `
		SELECT COALESCE(SUM(quantity-used),0) FROM exam_credits WHERE tenant_id=$1`, tenantID).Scan(&credits); err != nil {
		return nil, err
	}
	if credits > 0 {
		dec.Source = "per_exam"
		return dec, nil
	}
	return dec, nil
}

// ConsumeCredit memotong 1 kredit ujian (panggil saat publish, dalam admin tx).
func (m *Module) ConsumeCredit(ctx context.Context, tx pgx.Tx, tenantID, examID string) error {
	tag, err := tx.Exec(ctx, `
		UPDATE exam_credits SET used = used + 1
		WHERE id = (SELECT id FROM exam_credits WHERE tenant_id=$1 AND used < quantity ORDER BY created_at LIMIT 1)`,
		tenantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.ErrQuotaExceeded
	}
	return nil
}
