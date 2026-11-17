import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApiQuery, QueryError } from '@flowcbt/api-client';
import { Button, Card, Input, useToast, PageHeader, EmptyState, Icon } from '@flowcbt/ui';

// Wizard buat ujian (FR-11): Info → Soal → Peserta → Jadwal → Publish.
export default function ExamWizardPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const { data: sets, isLoading: lSets, error: eSets } = useApiQuery<any[]>(['qs-pub'], '/question-sets?status=published');
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
      if (f.duration_minutes > 240) return 'Durasi maksimal 240 menit.';
      if (!f.open_at || !f.close_at) return 'Waktu buka dan tutup wajib diisi.';
      if (f.open_at && f.close_at && new Date(f.close_at) <= new Date(f.open_at)) return 'Waktu tutup harus setelah waktu buka.';
    }
    if (s === 4) {
      if (f.passing_score < 0 || f.passing_score > 100) return 'Nilai lulus harus 0–100.';
      if (f.penalty_value < 0) return 'Penalti tidak boleh negatif.';
      if (f.penalty_mode === 'points' && f.penalty_value > 100) return 'Penalti poin maksimal 100.';
      if (f.penalty_mode === 'percent' && f.penalty_value > 100) return 'Penalti persen maksimal 100.';
      if (f.flag_threshold !== null && f.flag_threshold < 1) return 'Ambang pelanggaran minimal 1.';
      if (f.max_attempts < 1 || f.max_attempts > 10) return 'Maksimal percobaan harus 1–10.';
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
    for (let s = 0; s <= 4; s++) {
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
      <PageHeader
        title="Buat Ujian"
        subtitle={`Langkah ${step + 1} dari 5: ${STEP_LABELS[step]}`}
        actions={<Button variant="ghost" onClick={() => nav('/exams')}><Icon name="x" /> Batal</Button>}
      />
      <div style={{ display: 'flex', gap: 6, margin: '0 0 14px', flexWrap: 'wrap' }} role="list" aria-label="Progres wizard">
        {STEP_LABELS.map((label, i) => (
          <span key={label} role="listitem" aria-current={i === step ? 'step' : undefined} className={'badge ' + (i === step ? 'badge-brand' : i < step ? 'badge-ok' : 'badge-muted')}>
            {i < step && <Icon name="check" size={12} />}
            {label}
          </span>
        ))}
      </div>
      <Card>
        {step === 0 && (
          <div style={{ display: 'grid', gap: 14 }}>
            <label className="field"><span>Nama ujian</span><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="cth. Ulangan Harian Matematika Bab 1" /></label>
            <label className="field"><span>Paket soal (sudah dipublish)</span>
              <select className="input" value={f.question_set_id} onChange={(e) => set('question_set_id', e.target.value)}>
                <option value="">Pilih paket soal…</option>
                {eSets && <option value="" disabled>Gagal memuat paket soal</option>}
                {(sets || []).map((s) => <option key={s.id} value={s.id}>{s.title} ({s.subject_name}, {s.question_count} soal)</option>)}
              </select>
            </label>
            {!lSets && !eSets && (sets || []).length === 0 && <EmptyState icon="bank" title="Belum ada paket soal yang dipublish">Buka menu Bank Soal untuk membuat dan mempublish paket soal terlebih dulu.</EmptyState>}
          </div>
        )}
        {step === 1 && (
          <div>
            <p style={{ margin: '0 0 6px' }}>Paket soal: <strong>{(sets || []).find((s) => s.id === f.question_set_id)?.title || '-'}</strong></p>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Menambah atau mengubah soal dilakukan di halaman Bank Soal, lalu dipublish di sana. Ujian memakai salinan soal terpublish.</p>
          </div>
        )}
        {step === 2 && (
          <div>
            <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Pilih kelas peserta:</p>
            {(classes || []).map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={classIds.includes(c.id)} onChange={(e) => setClassIds(e.target.checked ? [...classIds, c.id] : classIds.filter((x) => x !== c.id))} />
                <span>{c.name} <em style={{ fontStyle: 'normal', color: 'var(--text-faint)', fontSize: 13 }}>({c.student_count} siswa)</em></span>
              </label>
            ))}
          </div>
        )}
        {step === 3 && (
          <div style={{ display: 'grid', gap: 14 }}>
            <label className="field"><span>Jadwal buka</span><Input type="datetime-local" value={toLocalInput(f.open_at)} onChange={(e) => set('open_at', e.target.value ? new Date(e.target.value).toISOString() : '')} /></label>
            <label className="field"><span>Jadwal tutup</span><Input type="datetime-local" value={toLocalInput(f.close_at)} onChange={(e) => set('close_at', e.target.value ? new Date(e.target.value).toISOString() : '')} /></label>
            <label className="field"><span>Durasi pengerjaan (menit)</span><Input type="number" min={1} max={240} aria-invalid={err.includes('Durasi')} aria-describedby={err.includes('Durasi') ? 'wizard-error' : undefined} value={f.duration_minutes} onChange={(e) => set('duration_minutes', Number(e.target.value))} /></label>
            <label className="field"><span>Jika lewat waktu tutup</span>
              <select className="input" value={f.close_policy} onChange={(e) => set('close_policy', e.target.value)}>
                <option value="grace">Biarkan selesai sesuai durasi masing-masing</option>
                <option value="hard">Dipotong langsung saat waktu tutup</option>
              </select>
            </label>
            <label className="field"><span>Metode login siswa</span>
              <select className="input" value={f.login_mode} onChange={(e) => set('login_mode', e.target.value)}>
                <option value="both">Dengan akun & tanpa akun</option>
                <option value="account">Hanya dengan akun</option>
                <option value="guest">Hanya tanpa akun (tamu)</option>
              </select>
            </label>
            <label className="field"><span>Maksimal percobaan <em style={{ fontStyle: 'normal', color: 'var(--text-faint)' }}>(kosong = tak terbatas)</em></span><Input type="number" value={f.max_attempts ?? ''} onChange={(e) => set('max_attempts', e.target.value ? Number(e.target.value) : null)} /></label>
            <label className="field"><span>Nilai akhir jika lebih dari satu percobaan</span>
              <select className="input" value={f.score_policy} onChange={(e) => set('score_policy', e.target.value)}>
                <option value="highest">Nilai tertinggi</option><option value="last">Nilai terakhir</option><option value="avg">Rata-rata</option>
              </select>
            </label>
            <label className="field"><span>KKM / ambang kelulusan <em style={{ fontStyle: 'normal', color: 'var(--text-faint)' }}>(opsional)</em></span><Input type="number" min={0} max={100} aria-invalid={err.includes('Nilai lulus')} aria-describedby={err.includes('Nilai lulus') ? 'wizard-error' : undefined} value={f.passing_score ?? ''} onChange={(e) => set('passing_score', e.target.value ? Number(e.target.value) : null)} /></label>
          </div>
        )}
        {step === 4 && (
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="card-sub" style={{ margin: '4px 0 8px' }}>Tampilan ke siswa</div>
            <label className="check"><input type="checkbox" checked={f.show_score_immediately} onChange={(e) => set('show_score_immediately', e.target.checked)} /> Nilai langsung muncul setelah siswa selesai</label>
            <label className="check"><input type="checkbox" checked={f.show_review} onChange={(e) => set('show_review', e.target.checked)} /> Siswa boleh mengulas jawaban & kunci</label>
            <label className="check"><input type="checkbox" checked={f.show_explanations} onChange={(e) => set('show_explanations', e.target.checked)} /> Tampilkan pembahasan</label>
            <label className="check"><input type="checkbox" checked={f.shuffle_questions} onChange={(e) => set('shuffle_questions', e.target.checked)} /> Acak urutan soal</label>
            <label className="check"><input type="checkbox" checked={f.shuffle_options} onChange={(e) => set('shuffle_options', e.target.checked)} /> Acak urutan pilihan jawaban</label>
            <div className="card-sub" style={{ margin: '16px 0 8px' }}>Anti-cheat & pengawasan</div>
            <label className="check"><input type="checkbox" checked={f.anticheat_enabled} onChange={(e) => set('anticheat_enabled', e.target.checked)} /> Deteksi saat siswa keluar aplikasi/tab</label>
            <label className="field"><span>Toleransi keluar (detik)</span><Input type="number" value={f.leave_tolerance_seconds} onChange={(e) => set('leave_tolerance_seconds', Number(e.target.value))} /></label>
            <label className="field"><span>Penalti per pelanggaran</span>
              <select className="input" value={f.penalty_mode} onChange={(e) => set('penalty_mode', e.target.value)}>
                <option value="points">Kurangi skor (poin, skala 100)</option><option value="percent">Kurangi persen nilai</option><option value="none">Tanpa penalti — hanya catatan</option>
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label className="field"><span>Besarnya penalti</span><Input type="number" value={f.penalty_value} onChange={(e) => set('penalty_value', Number(e.target.value))} /></label>
              <label className="field"><span>Batas total penalti</span><Input type="number" value={f.penalty_max} onChange={(e) => set('penalty_max', Number(e.target.value))} /></label>
            </div>
            <label className="field"><span>Dilaporkan curang otomatis setelah (pelanggaran)</span><Input type="number" value={f.flag_threshold ?? ''} onChange={(e) => set('flag_threshold', e.target.value ? Number(e.target.value) : null)} /></label>
            <label className="check"><input type="checkbox" checked={f.camera_enabled} onChange={(e) => set('camera_enabled', e.target.checked)} /> Proctoring kamera (foto berkala, hanya guru yang melihat)</label>
          </div>
        )}
        {err && <div id="wizard-error" role="alert" className="banner banner-danger" style={{ marginTop: 14 }}>{err}</div>}
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
