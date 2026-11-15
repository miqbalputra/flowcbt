package audit

import (
	"context"

	"flowcbt/backend/internal/platform"
)

// Writer mencatat audit log aksi sensitif (Bagian 12). Append-only (RLS revoke UPDATE/DELETE).
type Writer struct{}

func New() *Writer { return &Writer{} }

func (w *Writer) Log(ctx context.Context, q platform.Queryer, tenantID, actorType, actorID, action, entity string, entityID any, meta any, ip string) {
	if meta == nil {
		meta = map[string]any{}
	}
	_, _ = q.Exec(ctx,
		`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action, entity, entity_id, meta, ip)
		 VALUES ($1,$2,$3,$4,$5,$6,$7, NULLIF($8,'')::inet)`,
		tenantIDOrNil(tenantID), actorType, actorIDOrNil(actorID), action, entity, entityID, meta, ip)
}

func tenantIDOrNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func actorIDOrNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}
