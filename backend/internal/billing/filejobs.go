package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"flowcbt/backend/internal/platform"
)

// ProcessFileJobs adalah konsumen antrean file_jobs (B-10). Saat ini menangani
// tenant_export: menghasilkan ringkasan data tenant sebagai JSON di storage.
// Job lain (student_import) sudah commit sinkron di handler dan sengaja dilewati.
func ProcessFileJobs(ctx context.Context, db *platform.DB, storage platform.Storage, batch int) (done int, err error) {
	if db == nil || storage == nil {
		return 0, nil
	}
	if batch <= 0 {
		batch = 10
	}
	// Job kedaluwarsa ditutup agar tidak menggantung selamanya.
	_, _ = db.System.Exec(ctx,
		`UPDATE file_jobs SET status='expired', finished_at=now(), error='expired'
		 WHERE status IN ('queued','running') AND expires_at IS NOT NULL AND expires_at < now()`)

	rows, err := db.System.Query(ctx,
		`SELECT id, tenant_id FROM file_jobs
		 WHERE kind='tenant_export' AND status='queued'
		 ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, batch)
	if err != nil {
		return 0, err
	}
	type job struct{ id, tid string }
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.tid); err != nil {
			rows.Close()
			return 0, err
		}
		jobs = append(jobs, j)
	}
	rows.Close()
	if len(jobs) == 0 {
		return 0, nil
	}
	ids := make([]string, 0, len(jobs))
	for _, j := range jobs {
		ids = append(ids, j.id)
	}
	if _, err := db.System.Exec(ctx,
		`UPDATE file_jobs SET status='running' WHERE id = ANY($1::uuid[]) AND status='queued'`, ids); err != nil {
		return 0, err
	}

	for _, j := range jobs {
		summary := map[string]any{"tenant_id": j.tid, "generated_at": time.Now().UTC()}
		for _, table := range []string{"students", "classes", "question_sets", "exams", "attempts"} {
			var n int
			if e := db.System.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s WHERE tenant_id=$1`, table), j.tid).Scan(&n); e == nil {
				summary[table] = n
			}
		}
		payload, _ := json.Marshal(summary)
		key := fmt.Sprintf("exports/%s/%s.json", j.tid, j.id)
		if e := storage.Put(ctx, key, bytes.NewReader(payload), int64(len(payload)), "application/json"); e != nil {
			_, _ = db.System.Exec(ctx,
				`UPDATE file_jobs SET status='failed', error=$1, finished_at=now() WHERE id=$2`, e.Error(), j.id)
			continue
		}
		if _, e := db.System.Exec(ctx,
			`UPDATE file_jobs SET status='done', output_key=$1, summary=$2::jsonb, finished_at=now() WHERE id=$3`,
			key, string(payload), j.id); e != nil {
			return done, e
		}
		done++
	}
	return done, nil
}
