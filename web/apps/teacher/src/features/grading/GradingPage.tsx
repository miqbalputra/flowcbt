import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Input, Textarea, Badge, useToast, SkeletonList, PageHeader, EmptyState, Icon } from '@flowcbt/ui';

// Koreksi manual uraian + override skor (FR-8.3), dengan alasan (audit).
export default function GradingPage() {
  const { attemptId } = useParams();
  const toast = useToast();
  const { data: rows, refetch, isLoading } = useApiQuery<any[]>(['grading-' + attemptId], `/attempts/${attemptId}/grading`);
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

  const setField = (qid: string, field: 'score' | 'comment' | 'reason', value: string) =>
    setScores({ ...scores, [qid]: { ...(scores[qid] || { score: '', comment: '', reason: '' }), [field]: value } });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <PageHeader
        title="Penilaian uraian & override skor"
        subtitle="Beri skor pada jawaban uraian, atau koreksi skor otomatis bila perlu. Setiap override tercatat di audit log."
        actions={<Button variant="ghost" onClick={() => history.back()}><Icon name="chevron-left" /> Kembali</Button>}
      />
      <div style={{ display: 'grid', gap: 12 }}>
        {isLoading && <Card><SkeletonList rows={4} height={24} /></Card>}
        {!isLoading && (rows || []).map((r, i) => {
          const needGrading = r.type === 'essay' && r.graded_by !== 'manual';
          return (
            <Card key={r.question_id} style={needGrading ? { borderColor: 'var(--accent)' } : undefined}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>Soal #{i + 1}</strong> <Badge tone="muted">{r.type}</Badge> <Badge tone="muted">maks {r.points} poin</Badge>
                {r.graded_by && <Badge tone="ok"><Icon name={r.graded_by === 'auto' ? 'zap' : 'pencil'} /> {r.graded_by === 'auto' ? `otomatis: ${r.auto_score}` : `manual: ${r.score}`}</Badge>}
                {needGrading && <Badge tone="warn"><Icon name="clock" /> menunggu penilaian</Badge>}
              </div>
              <div dangerouslySetInnerHTML={{ __html: r.body_html }} style={{ margin: '8px 0' }} />
              <div className="surface-3" style={{ padding: 10, borderRadius: 'var(--radius-md)' }}>
                <div className="stat-label">Jawaban siswa</div>
                <div style={{ marginTop: 2 }}>{typeof r.answer === 'object' ? JSON.stringify(r.answer) : String(r.answer ?? '-')}</div>
              </div>
              {r.type === 'essay' && r.rubric && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>Rubrik: {JSON.stringify(r.rubric)}</div>}
              {r.answer_key && <div style={{ fontSize: 13, marginTop: 6 }}>Kunci: {JSON.stringify(r.answer_key)}</div>}
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 12 }}>
                <label className="field">
                  <span className="field-label">Skor</span>
                  <Input type="number" step="0.5" min="0" placeholder="0" inputMode="decimal"
                    value={scores[r.question_id]?.score ?? r.score ?? ''}
                    onChange={(e) => setField(r.question_id, 'score', e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-label">Komentar untuk siswa (opsional)</span>
                  <Input placeholder="mis. bagus, tapi rumus salah"
                    value={scores[r.question_id]?.comment ?? r.grader_comment ?? ''}
                    onChange={(e) => setField(r.question_id, 'comment', e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-label">Alasan override (wajib jika mengoreksi skor otomatis)</span>
                  <Input placeholder="mis. jawaban ditulis beda tapi benar"
                    value={scores[r.question_id]?.reason ?? r.override_reason ?? ''}
                    onChange={(e) => setField(r.question_id, 'reason', e.target.value)} />
                </label>
              </div>
              <div style={{ marginTop: 10 }}>
                <Button onClick={() => save(r.question_id)} disabled={!scores[r.question_id]?.score}><Icon name="check" /> Simpan skor</Button>
              </div>
            </Card>
          );
        })}
        {!isLoading && (rows || []).length === 0 && <Card><EmptyState icon="pencil" title="Belum ada jawaban">Halaman ini berisi jawaban satu siswa untuk dinilai.</EmptyState></Card>}
      </div>
    </div>
  );
}
