import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApiQuery } from '@flowcbt/api-client';
import { Button, Card, Input, useToast } from '@flowcbt/ui';

// Wizard buat ujian (FR-11): Info → Soal → Peserta → Jadwal → Publish.
export default function ExamWizardPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const { data: sets } = useApiQuery<any[]>(['qs-pub'], '/question-sets?status=published');
  const { data: classes } = useApiQuery<any[]>(['classes'], '/classes');
  const [f, setF] = useState<any>({
    name: '', question_set_id: '', open_at: '', close_at: '', duration_minutes: 60,
    close_policy: 'grace', login_mode: 'both', max_attempts: 1, score_policy: 'highest',
    passing_score: 60, show_score_immediately: true, show_review: false, show_explanations: false,
    shuffle_questions: true, shuffle_options: true, free_navigation: true, require_all_answered: false,
    anticheat_enabled: true, leave_tolerance_seconds: 3, penalty_mode: 'points', penalty_value: 5, penalty_max: 30,
    flag_threshold: 3, auto_submit_threshold: null, camera_enabled: false, camera_deny_policy: 'block',
  });
  const [classIds, setClassIds] = useState<string[]>([]);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  // datetime-local membaca waktu LOKAL; tampilkan dari ISO dikonversi ke lokal (bukan slice UTC)
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const STEP_LABELS = ['Info', 'Soal', 'Peserta', 'Jadwal', 'Setelan'];

  // validasi per langkah sebelum "Lanjut" diperbolehkan
  const stepError = (s: number): string => {
    if (s === 0 && !String(f.name).trim()) return 'Nama ujian wajib diisi.';
    if (s === 0 && !f.question_set_id) return 'Pilih paket soal (sudah publish).';
    if (s === 2 && classIds.length === 0) return 'Pilih minimal satu kelas peserta.';
    if (s === 3) {
      if (!f.duration_minutes || f.duration_minutes < 1) return 'Durasi minimal 1 menit.';
      if (f.open_at && f.close_at && new Date(f.close_at) <= new Date(f.open_at)) return 'Waktu tutup harus setelah waktu buka.';
    }
    return '';
  };
  const [err, setErr] = useState('');
  const goNext = () => {
    const e = stepError(step);
    if (e) { setErr(e); return; }
    setErr('');
    setStep(step + 1);
  };
  const goPrev = () => { setErr(''); setStep(step - 1); };

  const createAndPublish = async () => {
    for (let s = 0; s < 4; s++) {
      const e = stepError(s);
      if (e) { setStep(s); setErr(e); return; }
    }
    try {
      const body = {
        ...f,
        open_at: f.open_at ? new Date(f.open_at).toISOString() : null,
        close_at: f.close_at ? new Date(f.close_at).toISOString() : null,
      };
      const r = await api<any>('POST', '/exams', body);
      await api('PUT', `/exams/${r.id}/assignments`, { class_ids: classIds, student_ids: [] });
      const p = await api<any>('POST', `/exams/${r.id}/publish`, {});
      toast(`Ujian dipublish! Token: ${p.token}`, 'ok');
      nav(`/exams/${r.id}`);
    } catch (err: any) {
      toast(err.message + (err.details ? ' — beli paket di /billing' : ''), 'danger');
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22 }}>Buat Ujian — langkah {step + 1}/5</h1>
      <div style={{ display: 'flex', gap: 6, margin: '8px 0 4px', flexWrap: 'wrap' }} role="list" aria-label="Progres wizard">
        {STEP_LABELS.map((label, i) => (
          <span key={label} role="listitem" style={{
            fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
            border: '1px solid ' + (i === step ? 'var(--brand-600)' : i < step ? 'var(--ok)' : 'var(--muted)'),
            color: i === step ? 'var(--brand-600)' : i < step ? 'var(--ok)' : 'var(--text-muted)',
            background: i === step ? 'var(--brand-100)' : 'transparent',
          }}>
            {i < step ? '✓ ' : ''}{i + 1}. {label}
          </span>
        ))}
      </div>
      <Card>
        {step === 0 && (
          <div style={{ display: 'grid', gap: 10 }}>
            <label>Nama ujian<Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="UH Matematika Bab 1" /></label>
            <label>Paket soal (sudah publish)
              <select className="input" value={f.question_set_id} onChange={(e) => set('question_set_id', e.target.value)}>
                <option value="">pilih…</option>
                {(sets || []).map((s) => <option key={s.id} value={s.id}>{s.title} ({s.subject_name}, {s.question_count} soal)</option>)}
              </select>
            </label>
          </div>
        )}
        {step === 1 && (
          <div>
            <p>Paket soal: <strong>{(sets || []).find((s) => s.id === f.question_set_id)?.title || '-'}</strong></p>
            <p style={{ color: 'var(--text-muted)' }}>Tambah/ubah soal dilakukan di halaman Bank Soal, lalu publish di sana.</p>
          </div>
        )}
        {step === 2 && (
          <div>
            <strong>Peserta (kelas):</strong>
            {(classes || []).map((c) => (
              <label key={c.id} style={{ display: 'block', marginTop: 6 }}>
                <input type="checkbox" checked={classIds.includes(c.id)} onChange={(e) => setClassIds(e.target.checked ? [...classIds, c.id] : classIds.filter((x) => x !== c.id))} /> {c.name}
              </label>
            ))}
          </div>
        )}
        {step === 3 && (
          <div style={{ display: 'grid', gap: 10 }}>
            <label>Buka<Input type="datetime-local" value={toLocalInput(f.open_at)} onChange={(e) => set('open_at', e.target.value ? new Date(e.target.value).toISOString() : '')} /></label>
            <label>Tutup<Input type="datetime-local" value={toLocalInput(f.close_at)} onChange={(e) => set('close_at', e.target.value ? new Date(e.target.value).toISOString() : '')} /></label>
            <label>Durasi (menit)<Input type="number" value={f.duration_minutes} onChange={(e) => set('duration_minutes', Number(e.target.value))} /></label>
            <label>Jika lewat waktu tutup
              <select className="input" value={f.close_policy} onChange={(e) => set('close_policy', e.target.value)}>
                <option value="grace">Grace (selesai sesuai durasi)</option>
                <option value="hard">Hard close (dipotong saat tutup)</option>
              </select>
            </label>
            <label>Login siswa
              <select className="input" value={f.login_mode} onChange={(e) => set('login_mode', e.target.value)}>
                <option value="both">Akun & tanpa akun</option>
                <option value="account">Hanya akun</option>
                <option value="guest">Hanya tanpa akun (tamu)</option>
              </select>
            </label>
            <label>Maks percobaan (kosong = tak terbatas)<Input type="number" value={f.max_attempts ?? ''} onChange={(e) => set('max_attempts', e.target.value ? Number(e.target.value) : null)} /></label>
            <label>Kebijakan nilai (multi percobaan)
              <select className="input" value={f.score_policy} onChange={(e) => set('score_policy', e.target.value)}>
                <option value="highest">Tertinggi</option><option value="last">Terakhir</option><option value="avg">Rata-rata</option>
              </select>
            </label>
            <label>KKM (opsional)<Input type="number" value={f.passing_score ?? ''} onChange={(e) => set('passing_score', e.target.value ? Number(e.target.value) : null)} /></label>
          </div>
        )}
        {step === 4 && (
          <div style={{ display: 'grid', gap: 10 }}>
            <label><input type="checkbox" checked={f.show_score_immediately} onChange={(e) => set('show_score_immediately', e.target.checked)} /> Nilai langsung muncul setelah selesai</label>
            <label><input type="checkbox" checked={f.show_review} onChange={(e) => set('show_review', e.target.checked)} /> Tampilkan review jawaban & kunci</label>
            <label><input type="checkbox" checked={f.show_explanations} onChange={(e) => set('show_explanations', e.target.checked)} /> Tampilkan pembahasan</label>
            <label><input type="checkbox" checked={f.shuffle_questions} onChange={(e) => set('shuffle_questions', e.target.checked)} /> Acak urutan soal</label>
            <label><input type="checkbox" checked={f.shuffle_options} onChange={(e) => set('shuffle_options', e.target.checked)} /> Acak opsi</label>
            <label><input type="checkbox" checked={f.anticheat_enabled} onChange={(e) => set('anticheat_enabled', e.target.checked)} /> Anti-cheat: deteksi keluar aplikasi</label>
            <label>Toleransi keluar (detik)<Input type="number" value={f.leave_tolerance_seconds} onChange={(e) => set('leave_tolerance_seconds', Number(e.target.value))} /></label>
            <label>Penalti per pelanggaran
              <select className="input" value={f.penalty_mode} onChange={(e) => set('penalty_mode', e.target.value)}>
                <option value="points">Poin (skala 100)</option><option value="percent">Persen</option><option value="none">Tanpa penalti</option>
              </select>
            </label>
            <label>Nilai penalti per pelanggaran<Input type="number" value={f.penalty_value} onChange={(e) => set('penalty_value', Number(e.target.value))} /></label>
            <label>Maks total penalti<Input type="number" value={f.penalty_max} onChange={(e) => set('penalty_max', Number(e.target.value))} /></label>
            <label>Ambang "dilaporkan curang" (pelanggaran)<Input type="number" value={f.flag_threshold ?? ''} onChange={(e) => set('flag_threshold', e.target.value ? Number(e.target.value) : null)} /></label>
            <label><input type="checkbox" checked={f.camera_enabled} onChange={(e) => set('camera_enabled', e.target.checked)} /> Proctoring kamera (snapshot berkala, FR-5.8B)</label>
          </div>
        )}
        {err && <div role="alert" style={{ color: '#fff', background: 'var(--danger)', borderRadius: 10, padding: '8px 12px', marginTop: 10, fontSize: 14 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button variant="ghost" disabled={step === 0} onClick={goPrev}>Kembali</Button>
          {step < 4
            ? <Button onClick={goNext}>Lanjut</Button>
            : <Button onClick={createAndPublish}>Publish ujian</Button>}
        </div>
      </Card>
    </div>
  );
}
