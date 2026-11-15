import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Input, Textarea, Modal, useToast, Badge } from '@flowcbt/ui';
import { QUESTION_TYPE_LABEL, type Question, type QuestionType } from '@flowcbt/shared';

// Editor soal (FR-4.4): 5 tipe AKM, autosave draft, tambah/ubah/hapus soal, publish (FR-4.7).
export default function QuestionSetEditorPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: set } = useApiQuery<any>(['qs-' + id], `/question-sets/${id}`);
  const { data: questions, refetch } = useApiQuery<Question[]>(['qs-q-' + id], `/question-sets/${id}/questions`);
  const [edit, setEdit] = useState<any>(null); // soal yang sedang diedit
  const [showImport, setShowImport] = useState(false);

  const saveQuestion = async (q: any) => {
    try {
      if (q.id) await api('PUT', `/questions/${q.id}`, q);
      else await api('POST', `/question-sets/${id}/questions`, q);
      toast('Tersimpan (autosave)', 'ok');
      setEdit(null);
      refetch();
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  const del = async (qid: string) => {
    if (!confirm('Hapus soal ini?')) return;
    await api('DELETE', `/questions/${qid}`);
    refetch();
  };

  const publish = async () => {
    try {
      const r = await api<any>('POST', `/question-sets/${id}/publish`, {});
      toast(`Dipublish: ${r.questions} soal, ${r.max_points} poin`, 'ok');
    } catch (err: any) { toast(err.message, 'danger'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{set?.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{set?.subject_name} · kode {set?.exam_code} · <Badge tone={set?.status === 'published' ? 'ok' : 'muted'}>{set?.status}</Badge></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`${(window as any).__API__ || ''}`}></a>
          <Button variant="ghost" onClick={() => setShowImport(true)}>Import xlsx</Button>
          <a href={undefined as any} onClick={(e) => { e.preventDefault(); window.location.href = (import.meta as any).env?.VITE_API_BASE + '/question-sets/' + id + '/export'; }}><Button variant="ghost">Export xlsx</Button></a>
          <Button onClick={publish} disabled={set?.status === 'published'}>Publish</Button>
          <Button onClick={() => setEdit({ type: 'mcq', body_html: '', options_json: [{ id: 'A', html: '' }, { id: 'B', html: '' }], answer_key_json: { correct: 'A' }, points: 1, scoring_mode: 'all_or_nothing', partial_wrong_penalty: true, shuffle_options: true, media_ids: [] })}>+ Soal</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {(questions || []).map((q, i) => (
          <Card key={q.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>#{i + 1}</strong> <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge> <Badge tone="muted">{q.points} poin</Badge>
                <div dangerouslySetInnerHTML={{ __html: q.body_html }} style={{ marginTop: 4 }} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button variant="ghost" onClick={() => setEdit({ ...q })}>Edit</Button>
                <Button variant="danger" onClick={() => del(q.id)}>Hapus</Button>
              </div>
            </div>
          </Card>
        ))}
        {(questions || []).length === 0 && <Card>Belum ada soal — klik “+ Soal”.</Card>}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit soal' : 'Soal baru'}>
        {edit && <QuestionForm q={edit} onSave={saveQuestion} onCancel={() => setEdit(null)} />}
      </Modal>
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import soal dari template xlsx">
        <ImportForm setId={id!} onDone={() => { setShowImport(false); refetch(); }} />
      </Modal>
    </div>
  );
}

function ImportForm({ setId, onDone }: { setId: string; onDone: () => void }) {
  const toast = useToast();
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <a href={(import.meta as any).env?.VITE_API_BASE + '/question-sets/import/template'}><Button variant="ghost">Unduh template</Button></a>
      <input ref={ref} type="file" accept=".xlsx" />
      <Button onClick={async () => {
        const f = ref.current?.files?.[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        const { getAccessToken, API_BASE } = await import('@flowcbt/api-client');
        const res = await fetch(API_BASE + '/question-sets/import?subject=Import', { method: 'POST', headers: { Authorization: 'Bearer ' + getAccessToken() }, body: fd });
        const j = await res.json();
        toast(`Import: ${j.data?.imported ?? j.error?.message}`, j.error ? 'danger' : 'ok');
        onDone();
      }}>Upload & simpan sebagai draft</Button>
    </div>
  );
}

// Form soal per tipe (FR-4.3/4.4).
function QuestionForm({ q, onSave, onCancel }: { q: any; onSave: (q: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState<any>(q);
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const types: QuestionType[] = ['mcq', 'mcq_complex', 'matching', 'short_answer', 'essay'];

  const opts = Array.isArray(form.options_json) ? form.options_json : [];
  const setOpt = (i: number, html: string) => {
    const o = [...opts]; o[i] = { ...o[i], html }; set('options_json', o);
  };
  const addOpt = () => set('options_json', [...opts, { id: String.fromCharCode(65 + opts.length), html: '' }]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label>Tipe
        <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
          {types.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
        </select>
      </label>
      <label>Pertanyaan (HTML sederhana: &lt;p&gt;, &lt;b&gt;, &lt;ul&gt;…)
        <Textarea value={form.body_html} onChange={(e) => set('body_html', e.target.value)} rows={3} />
      </label>
      <label>Poin<Input type="number" step="0.5" min="0.5" value={form.points} onChange={(e) => set('points', Number(e.target.value))} /></label>

      {(form.type === 'mcq' || form.type === 'mcq_complex') && (
        <div>
          <strong>Opsi</strong>
          {opts.map((o: any, i: number) => (
            <div key={o.id} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <strong style={{ width: 20 }}>{o.id}</strong>
              <Input value={o.html} onChange={(e) => setOpt(i, e.target.value)} />
            </div>
          ))}
          <Button variant="ghost" onClick={addOpt} style={{ marginTop: 6 }}>+ Opsi</Button>
          {form.type === 'mcq' ? (
            <label>Kunci
              <select className="input" value={form.answer_key_json?.correct || 'A'} onChange={(e) => set('answer_key_json', { correct: e.target.value })}>
                {opts.map((o: any) => <option key={o.id} value={o.id}>{o.id}</option>)}
              </select>
            </label>
          ) : (
            <div>
              <strong>Kunci benar (centang):</strong>
              {opts.map((o: any) => (
                <label key={o.id} style={{ display: 'block' }}>
                  <input type="checkbox" checked={(form.answer_key_json?.correct || []).includes(o.id)}
                    onChange={(e) => {
                      const cur: string[] = form.answer_key_json?.correct || [];
                      set('answer_key_json', { correct: e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id) });
                    }} /> {o.id}
                </label>
              ))}
              <label>Mode penilaian
                <select className="input" value={form.scoring_mode} onChange={(e) => set('scoring_mode', e.target.value)}>
                  <option value="all_or_nothing">Semua-atau-tidak</option>
                  <option value="partial">Parsial (FR-8.1b)</option>
                </select>
              </label>
              <label><input type="checkbox" checked={form.partial_wrong_penalty} onChange={(e) => set('partial_wrong_penalty', e.target.checked)} /> Penalti jawaban salah pada mode parsial</label>
            </div>
          )}
        </div>
      )}

      {form.type === 'matching' && (
        <MatchingEditor form={form} set={set} />
      )}

      {form.type === 'short_answer' && (
        <label>Kunci (pisahkan dengan | untuk multi-variasi; angka: 15 cocok 15,0 / 15.0)
          <Input value={(form.answer_key_json?.accepted || []).join('|')} onChange={(e) => set('answer_key_json', { accepted: e.target.value.split('|').map((s) => s.trim()).filter(Boolean) })} placeholder="15|lima belas" />
        </label>
      )}

      {form.type === 'essay' && (
        <label>{'Rubrik (JSON: {"max_points":10,"criteria":[...]}) — dinilai manual guru'}
          <Textarea value={JSON.stringify(form.rubric_json || { max_points: form.points, criteria: [] })} onChange={(e) => { try { set('rubric_json', JSON.parse(e.target.value)); } catch {} }} rows={2} />
        </label>
      )}

      <label>Pembahasan (opsional)
        <Textarea value={form.explanation_html || ''} onChange={(e) => set('explanation_html', e.target.value)} rows={2} />
      </label>
      <label><input type="checkbox" checked={form.shuffle_options !== false} onChange={(e) => set('shuffle_options', e.target.checked)} /> Acak urutan opsi per siswa</label>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => onSave(form)}>Simpan</Button>
        <Button variant="ghost" onClick={onCancel}>Batal</Button>
      </div>
    </div>
  );
}

function MatchingEditor({ form, set }: { form: any; set: (k: string, v: any) => void }) {
  const opts = form.options_json?.left ? form.options_json : { left: [{ id: 'L1', html: '' }, { id: 'L2', html: '' }], right: [{ id: 'R1', html: '' }, { id: 'R2', html: '' }] };
  const pairs: Record<string, string> = form.answer_key_json?.pairs || {};
  const setSide = (side: 'left' | 'right', i: number, html: string) => {
    const o = { ...opts, [side]: opts[side].map((x: any, j: number) => (j === i ? { ...x, html } : x)) };
    set('options_json', o);
  };
  const setPair = (l: string, r: string) => set('answer_key_json', { pairs: { ...pairs, [l]: r } });
  return (
    <div>
      <strong>Menjodohkan</strong>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
        <div>
          <em>Kiri</em>
          {opts.left.map((l: any, i: number) => (
            <Input key={l.id} value={l.html} onChange={(e) => setSide('left', i, e.target.value)} style={{ marginTop: 6 }} placeholder={`Item kiri ${i + 1}`} />
          ))}
        </div>
        <div>
          <em>Kanan</em>
          {opts.right.map((r: any, i: number) => (
            <Input key={r.id} value={r.html} onChange={(e) => setSide('right', i, e.target.value)} style={{ marginTop: 6 }} placeholder={`Item kanan ${i + 1}`} />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <em>Pasangan benar:</em>
        {opts.left.map((l: any) => (
          <div key={l.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <span>{l.html || l.id}</span> →
            <select className="input" style={{ maxWidth: 160 }} value={pairs[l.id] || ''} onChange={(e) => setPair(l.id, e.target.value)}>
              <option value="">pilih</option>
              {opts.right.map((r: any) => <option key={r.id} value={r.id}>{r.html || r.id}</option>)}
            </select>
          </div>
        ))}
      </div>
      <label>Mode penilaian
        <select className="input" value={form.scoring_mode} onChange={(e) => set('scoring_mode', e.target.value)}>
          <option value="all_or_nothing">Semua-atau-tidak</option>
          <option value="partial">Parsial per pasangan (FR-8.1b)</option>
        </select>
      </label>
    </div>
  );
}
