import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Input, Textarea, Badge, useToast } from '@flowcbt/ui';

// Koreksi manual uraian + override skor (FR-8.3), dengan alasan (audit).
export default function GradingPage() {
  const { attemptId } = useParams();
  const toast = useToast();
  const { data: rows, refetch } = useApiQuery<any[]>(['grading-' + attemptId], `/attempts/${attemptId}/grading`);
  const [scores, setScores] = useState<Record<string, { score: string; comment: string; reason: string }>>({});

  const save = async (qid: string) => {
    const s = scores[qid];
    if (!s) return;
    try {
      await api('PUT', `/attempts/${attemptId}/answers/${qid}/score`, {
        score: Number(s.score), comment: s.comment, override_reason: s.reason,
      });
      toast('Skor tersimpan & nilai dihitung ulang', 'ok');
      refetch();
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22 }}>Penilaian (koreksi manual & override)</h1>
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {(rows || []).map((r, i) => (
          <Card key={r.question_id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>#{i + 1}</strong> <Badge>{r.type}</Badge> <Badge tone="muted">maks {r.points}</Badge>
              {r.graded_by && <Badge tone="ok">{r.graded_by === 'auto' ? `auto: ${r.auto_score}` : `manual: ${r.score}`}</Badge>}
            </div>
            <div dangerouslySetInnerHTML={{ __html: r.body_html }} style={{ margin: '8px 0' }} />
            <div style={{ background: 'var(--muted)', padding: 10, borderRadius: 8 }}>
              <strong>Jawaban siswa:</strong>
              <div>{typeof r.answer === 'object' ? JSON.stringify(r.answer) : String(r.answer ?? '-')}</div>
            </div>
            {r.type === 'essay' && r.rubric && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Rubrik: {JSON.stringify(r.rubric)}</div>}
            {r.answer_key && <div style={{ fontSize: 13, marginTop: 6 }}>Kunci: {JSON.stringify(r.answer_key)}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input type="number" step="0.5" min="0" placeholder="skor" style={{ width: 110 }}
                value={scores[r.question_id]?.score ?? (r.score ?? '')}
                onChange={(e) => setScores({ ...scores, [r.question_id]: { ...(scores[r.question_id] || { comment: '', reason: '' }), score: e.target.value } })} />
              <Input placeholder="komentar" style={{ flex: 1, minWidth: 160 }}
                value={scores[r.question_id]?.comment ?? r.grader_comment ?? ''}
                onChange={(e) => setScores({ ...scores, [r.question_id]: { ...(scores[r.question_id] || { score: '', reason: '' }), comment: e.target.value } })} />
              <Input placeholder="alasan override (audit)" style={{ flex: 1, minWidth: 160 }}
                value={scores[r.question_id]?.reason ?? r.override_reason ?? ''}
                onChange={(e) => setScores({ ...scores, [r.question_id]: { ...(scores[r.question_id] || { score: '', comment: '' }), reason: e.target.value } })} />
              <Button onClick={() => save(r.question_id)}>Simpan skor</Button>
            </div>
          </Card>
        ))}
        {(rows || []).length === 0 && <Card>Belum ada jawaban pada attempt ini.</Card>}
      </div>
    </div>
  );
}
