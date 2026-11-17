import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@flowcbt/api-client';
import { Button, Card, Badge, BottomSheet, ConnectionBadge, useToast, ThemeToggle, Icon } from '@flowcbt/ui';
import { fmtDuration, QUESTION_TYPE_LABEL, sanitizeHtml, stripHtml, type ExamPacket, type Question, type SyncEvent } from '@flowcbt/shared';
import { db, LocalAttempt } from '../offline/db';
import { calibrate, deadlineCountdownMs, drainOutbox, newEventId, type ServerClock } from '../offline/engine';

// Halaman butir soal (FR-6.3): satu soal per layar, timer sticky, indikator koneksi,
// jawaban SELALU ditulis ke IndexedDB dulu (FR-6.3/7.3), sinkron periodik + saat online (FR-7.4).
export default function AttemptPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [att, setAtt] = useState<LocalAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, { payload: any; flagged: boolean }>>({});
  const [idx, setIdx] = useState(0);
  const [showNav, setShowNav] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const [warned, setWarned] = useState(0);
  const seqRef = useRef(0);
  const clockRef = useRef<ServerClock | null>(null);
  const startedPerfRef = useRef(0);

  const packet: ExamPacket | null = att?.packet || null;
  const questions: Question[] = useMemo(() => packet?.questions || [], [packet]);
  const q: Question | undefined = questions[idx];
  const [scale, setScale] = useState(1);

  // muat attempt dari IndexedDB (pemulihan, FR-7.8) + mulai jam monotonic terkalibrasi server
  useEffect(() => {
    (async () => {
      const a = await db.attempts.get(id!);
      if (!a) {
        // coba pulihkan dari server
        try {
          const remote = await api<any>('GET', `/attempts/${id}`);
          if (remote.status !== 'in_progress') { nav(`/attempt/${id}/done`); return; }
        } catch { /* offline */ }
        toast('Data ujian tidak ditemukan di perangkat. Mulai ulang dari daftar ujian.', 'danger');
        nav('/exams');
        return;
      }
      setAtt(a);
      startedPerfRef.current = a.startedPerf;
      // Kumpulan jawaban remote juga dipakai untuk re-kalibrasi jam (performance.now
      // reset ke ~0 pada dokumen baru, sehingga startedPerf sesi lama basi).
      let remoteServerNow: number | null = null;
      const recoveredAtPerf = performance.now();
      clockRef.current = calibrate(a.serverNowIso, a.startedPerf);
      // pulihkan jawaban yang sudah tersimpan lokal
      const outbox = await db.outbox.where('attemptId').equals(id!).toArray();
      const map: Record<string, { payload: any; flagged: boolean }> = {};
      let maxSeq = 0;
      for (const e of outbox) {
        maxSeq = Math.max(maxSeq, e.seq);
        if (e.type === 'answer' && e.question_id) map[e.question_id] = { payload: e.payload, flagged: map[e.question_id]?.flagged || false };
        if (e.type === 'flag' && e.question_id) map[e.question_id] = { payload: map[e.question_id]?.payload, flagged: (e.payload as any)?.flagged };
      }
      // gabung dengan jawaban ter-ACK dari server (server sumber akhir, FR-7.8)
      try {
        const remote = await api<any>('GET', `/attempts/${id}`);
        for (const ans of remote.answers || []) {
          if (!map[ans.question_id]) map[ans.question_id] = { payload: ans.answer_json, flagged: ans.flagged };
        }
        seqRef.current = Math.max(maxSeq, ...(remote.answers || []).map((a: any) => a.seq || 0));
        if (remote.server_now) remoteServerNow = Date.parse(remote.server_now);
      } catch { /* offline: pakai lokal saja */ }
      // re-kalibrasi: jam lama memakai basePerf dokumen sebelumnya (bocor sisa waktu)
      if (remoteServerNow !== null) {
        clockRef.current = calibrate(new Date(remoteServerNow).toISOString(), recoveredAtPerf);
        startedPerfRef.current = recoveredAtPerf;
        try { await db.attempts.update(id!, { startedPerf: recoveredAtPerf, serverNowIso: new Date(remoteServerNow).toISOString() }); } catch { /* abaikan */ }
      }
      setAnswers(map);
    })();
  }, [id]);

  // tulis event ke outbox lokal (selalu lokal dulu) lalu coba sinkron
  const pushEvent = useCallback(async (ev: SyncEvent & { attemptId: string }) => {
    await db.outbox.put(ev);
    setPending((p) => p + 1);
    void syncNow();
  }, []);

  const syncNow = useCallback(async () => {
    if (!id || !navigator.onLine) return;
    try {
      const n = await drainOutbox(id, {
        getAll: (a) => db.outbox.where('attemptId').equals(a).toArray(),
        put: async (e) => { await db.outbox.put({ ...e, attemptId: id } as any); },
        deleteMany: async (ids) => { await db.outbox.where('client_event_id').anyOf(ids).delete(); },
      }, async (attemptId, events) => {
        const res = await api<any>('POST', `/attempts/${attemptId}/answers:sync`, { events });
        return res;
      }, (left) => setPending(left));
      if (n > 0) setPending((p) => Math.max(0, p - n));
    } catch { /* tetap offline; akan dicoba lagi */ }
  }, [id]);

  // sinkron periodik 5 detik + saat online kembali (FR-7.4, AC-2 ≤15 dtk)
  useEffect(() => {
    const t = setInterval(syncNow, 5000);
    const onOnline = () => { setOnline(true); void syncNow(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { clearInterval(t); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [syncNow]);

  // timer hitung mundur (FR-5.2) dari deadline server + auto-submit lokal saat habis (AC-5)
  useEffect(() => {
    if (!att || !clockRef.current) return;
    setLeft(deadlineCountdownMs(att.deadlineIso, clockRef.current));
    const t = setInterval(() => {
      setLeft(deadlineCountdownMs(att.deadlineIso, clockRef.current!));
    }, 500);
    return () => clearInterval(t);
  }, [att]);

  useEffect(() => {
    // guard integritas: attempt sudah submitted/pending_sync → bukan halaman soal (H2)
    if (att && att.status !== 'in_progress') nav(`/attempt/${id}/done`, { replace: true });
  }, [att, id]);

  useEffect(() => {
    if (att && left !== null && left <= 0 && att.status === 'in_progress') {
      void doAutoSubmit();
    }
  }, [left, att]);

  // deteksi keluar aplikasi (FR-5.8A) — event dicatat meski offline via outbox
  useEffect(() => {
    if (!att) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt) {
        const dur = Date.now() - hiddenAt;
        hiddenAt = 0;
        if (dur > (packet?.exam.anticheat.leave_tolerance_seconds || 3) * 1000) {
          const ev: SyncEvent & { attemptId: string } = {
            client_event_id: newEventId(), type: 'violation', seq: ++seqRef.current,
            payload: { type: 'tab_hidden', duration_ms: dur },
            client_ts: new Date().toISOString(), attemptId: id!,
          };
          void db.outbox.put(ev).then(() => {
            // kirim juga sebagai violation langsung bila online
            if (navigator.onLine) {
              api('POST', `/attempts/${id}/violations`, { violations: [{ client_event_id: ev.client_event_id, type: 'tab_hidden', started_at: ev.client_ts, duration_ms: dur }] }).catch(() => {});
            }
            setWarned((w) => w + 1);
            setPending((p) => p + 1);
          });
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [att, id, packet]);

  const setAnswer = async (qid: string, payload: any) => {
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], payload } }));
    const ev: SyncEvent & { attemptId: string } = {
      client_event_id: newEventId(), type: 'answer', question_id: qid, payload, seq: ++seqRef.current,
      client_ts: new Date().toISOString(), elapsed_ms: clockRef.current ? clockRef.current.nowMs() - Date.parse(att!.serverNowIso) : undefined,
      attemptId: id!,
    };
    await pushEvent(ev);
  };

  const toggleFlag = async (qid: string) => {
    const flagged = !answers[qid]?.flagged;
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], flagged } }));
    const ev: SyncEvent & { attemptId: string } = {
      client_event_id: newEventId(), type: 'flag', question_id: qid, payload: { flagged }, seq: ++seqRef.current,
      client_ts: new Date().toISOString(), attemptId: id!,
    };
    await pushEvent(ev);
  };

  // submit otomatis lokal (AC-5, timeout): tulis event submit ke outbox;
  // DonePage yang mengirimkannya ke server (dengan submitted:true) saat drain.
  const doAutoSubmit = async () => {
    if (!att || att.status !== 'in_progress') return;
    const ev: SyncEvent & { attemptId: string } = {
      client_event_id: newEventId(), type: 'submit', seq: ++seqRef.current,
      client_ts: new Date().toISOString(), attemptId: id!,
    };
    await db.outbox.put(ev);
    await db.attempts.update(id!, { submittedLocal: true, status: 'pending_sync' });
    setAtt({ ...att, submittedLocal: true, status: 'pending_sync' });
    nav(`/attempt/${id}/done`);
  };

  // Ekstra: opsi yang bisa dipilih via keyboard A–E / 1–5 ( hanya MCQ ).
  const optionIds = useMemo(() => {
    if (!q || (q.type !== 'mcq' && q.type !== 'mcq_complex')) return [] as string[];
    return (q.options_json as { id: string }[]).map((o) => o.id);
  }, [q]);

  const selectById = (oid: string) => {
    if (!q) return;
    if (q.type === 'mcq') { void setAnswer(q.id, { selected: oid }); return; }
    if (q.type === 'mcq_complex') {
      const sel: string[] = answers[q.id]?.payload?.selected || [];
      void setAnswer(q.id, { selected: sel.includes(oid) ? sel.filter((x) => x !== oid) : [...sel, oid] });
    }
  };

  // Power-user: A–E / 1–5 pilih opsi, R ragu-ragu, ←/→ pindah soal.
  useEffect(() => {
    if (!att || showNav) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toUpperCase();
      if (/^[A-E]$/.test(key)) {
        const oid = optionIds[key.charCodeAt(0) - 65];
        if (oid) { e.preventDefault(); selectById(oid); }
      } else if (/^[1-5]$/.test(key)) {
        const oid = optionIds[Number(key) - 1];
        if (oid) { e.preventDefault(); selectById(oid); }
      } else if (key === 'R' && q) {
        e.preventDefault(); void toggleFlag(q.id);
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault(); setIdx(idx - 1);
      } else if (e.key === 'ArrowRight' && idx < questions.length - 1) {
        e.preventDefault(); setIdx(idx + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [att, showNav, optionIds, q, idx, questions.length, answers]);

  if (!att || !packet || !q) return <div style={{ padding: 24 }}><Card>Memuat ujian…</Card></div>;
  const answeredCount = Object.values(answers).filter((a) => a.payload != null).length;
  const isLast = idx === questions.length - 1;

  const questionMap = (
    <>
      <div className="qmap-grid">
        {questions.map((qq, i) => {
          const a = answers[qq.id];
          const answered = a?.payload != null;
          return (
            <button
              key={qq.id}
              onClick={() => { setIdx(i); setShowNav(false); }}
              className={'qmap-tile' + (answered ? ' answered' : '') + (a?.flagged ? ' flagged' : '') + (i === idx ? ' current' : '')}
              aria-label={`Soal ${i + 1}${answered ? ', sudah dijawab' : ''}${a?.flagged ? ', ragu-ragu' : ''}`}
              aria-current={i === idx}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="qmap-legend">
        <span><i style={{ background: 'var(--ok)', borderColor: 'var(--ok)' }} />Terjawab</span>
        <span><i style={{ background: 'var(--warn)', borderColor: 'var(--warn)' }} />Ragu-ragu</span>
        <span><i />Kosong</span>
        <span><i style={{ border: '2px solid var(--brand-600)' }} />Aktif</span>
      </div>
    </>
  );

  return (
    <div className="exam-shell" style={{ ['--exam-scale' as any]: scale }}>
      <header className="exam-header">
        <div style={{ minWidth: 0 }}>
          <div className="e-title">{packet.exam.name}</div>
          <div className="e-sub">Ujian · {questions.length} soal · {answeredCount} terjawab</div>
        </div>
        <span className={'sync-dot' + (pending > 0 || !online ? ' warn' : '')} role="status" aria-live="polite">
          <span className="dot" style={{ background: 'currentColor' }} aria-hidden="true" />
          {pending > 0 ? `${pending} menunggu` : online ? 'Tersimpan' : 'Offline'}
        </span>
        <div style={{ flex: 1 }} />
        <span className={'exam-timer' + (left !== null && left < 300000 ? ' low' : left !== null && left < 600000 ? ' warn' : '')}
          role="timer" aria-live="off" aria-label="Sisa waktu pengerjaan">
          {fmtDuration((left || 0) / 1000)}
        </span>
        <span className="sr-only" aria-live="assertive">
          {left !== null && [600000, 300000, 60000].includes(left) ? `Sisa waktu ${fmtDuration(left / 1000)}` : ''}
        </span>
        <div className="e-tools">
          <div className="text-ctrl" aria-label="Ukuran teks soal">
            <button aria-label="A- perkecil teks" onClick={() => setScale((v) => Math.max(0.9, +(v - 0.1).toFixed(1)))}>A-</button>
            <span>{Math.round(scale * 100)}%</span>
            <button aria-label="A+ perbesar teks" onClick={() => setScale((v) => Math.min(1.3, +(v + 0.1).toFixed(1)))}>A+</button>
          </div>
          <ThemeToggle />
          <span className="profile-pill"><span className="avatar" aria-hidden="true">S</span> Siswa</span>
        </div>
      </header>

      {(pending > 0 || warned > 0) && (
        <div className="exam-notices">
          {pending > 0 && <div className="banner banner-warn" role="status" aria-live="polite">{pending} jawaban belum terkirim — tersimpan aman di perangkat.</div>}
          {warned > 0 && <div className="banner banner-danger" role="alert">Pelanggaran ke-{warned} tercatat. Sisa kesempatan: {Math.max(0, (packet.exam.anticheat.flag_threshold ?? 3) - warned)}.</div>}
        </div>
      )}

      <div className="exam-body">
        <section className="exam-stimulus" aria-label="Bacaan dan pertanyaan">
          <div className="exam-meta">
            <span className="q-no">SOAL {idx + 1} / {questions.length}</span>
            <Badge tone="muted">{QUESTION_TYPE_LABEL[q.type]}</Badge>
            <Badge tone="brand">{q.points} poin</Badge>
          </div>
          <div className="exam-question" dangerouslySetInnerHTML={{ __html: sanitizeHtml(q.body_html) }} />
        </section>
        <aside className="exam-options" aria-label="Jawaban dan peta soal">
          <div className="exam-options-title">
            <span>Pilih jawaban</span>
            {(q.type === 'mcq' || q.type === 'mcq_complex') && <span><kbd className="kb">A–E</kbd> / <kbd className="kb">1–5</kbd></span>}
          </div>
          <QuestionInput q={q} value={answers[q.id]?.payload} onAnswer={(p) => setAnswer(q.id, p)} />
          <div className="exam-map">
            <div className="exam-options-title"><span>Peta soal</span><span className="mono">{answeredCount}/{questions.length}</span></div>
            {questionMap}
          </div>
        </aside>
      </div>

      <footer className="exam-actionbar">
        <Button variant="ghost" aria-label="Soal sebelumnya" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
          <Icon name="chevron-left" /><span className="long">Sebelumnya</span>
        </Button>
        <button className={'flag-toggle' + (answers[q.id]?.flagged ? ' on' : '')} aria-pressed={!!answers[q.id]?.flagged}
          aria-label={answers[q.id]?.flagged ? 'Ragu-ragu R — batalkan tanda soal ini' : 'Ragu-ragu R — tandai soal ini'}
          onClick={() => toggleFlag(q.id)}>
          <span className="box" aria-hidden="true">{answers[q.id]?.flagged ? '✓' : ''}</span>
          <span className="label">Ragu-ragu <kbd className="kb">R</kbd></span>
        </button>
        <Button variant="ghost" aria-label="Buka peta soal" onClick={() => setShowNav(true)}><Icon name="list" /><span className="long">Peta</span></Button>
        <div className="spacer" />
        {isLast
          ? <Button aria-label="Selesai — selesaikan ujian" onClick={() => nav(`/attempt/${id}/review`)}><Icon name="check" /><span className="long">Selesaikan Ujian</span><span className="short">Selesai</span></Button>
          : <Button aria-label="Lanjut ke soal selanjutnya" onClick={() => setIdx(idx + 1)}><span className="long">Selanjutnya</span><span className="short">Lanjut</span><Icon name="chevron-right" /></Button>}
      </footer>

      <BottomSheet open={showNav} onClose={() => setShowNav(false)} title="Peta Soal">
        {questionMap}
      </BottomSheet>
    </div>
  );
}

// ---- Input jawaban per tipe soal (FR-4.3) ----
function QuestionInput({ q, value, onAnswer }: { q: Question; value: any; onAnswer: (p: any) => void }) {
  switch (q.type) {
    case 'mcq': {
      const opts = q.options_json as { id: string; html: string }[];
      return (
        <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
          {opts.map((o) => (
            <button
              key={o.id}
              onClick={() => onAnswer({ selected: o.id })}
              className={'option-card' + (value?.selected === o.id ? ' checked' : '')}
              aria-pressed={value?.selected === o.id}
            >
              <span className="opt-letter" aria-hidden="true">{o.id}</span>
              <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(o.html) }} />
            </button>
          ))}
        </div>
      );
    }
    case 'mcq_complex': {
      const opts = q.options_json as { id: string; html: string }[];
      const sel: string[] = value?.selected || [];
      const toggle = (id: string) => onAnswer({ selected: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
      return (
        <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
          {opts.map((o) => (
            <button key={o.id} onClick={() => toggle(o.id)} className={'option-card' + (sel.includes(o.id) ? ' checked' : '')} aria-pressed={sel.includes(o.id)}>
              <span className="opt-letter" aria-hidden="true">{sel.includes(o.id) ? <Icon name="check" size={14} /> : '\u00A0'}</span>
              <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(o.html) }} />
            </button>
          ))}
        </div>
      );
    }
    case 'matching':
      // komponen terpisah agar hook (useState) tidak dipanggil kondisional di switch
      return <MatchingInput q={q} value={value} onAnswer={onAnswer} />;
    case 'short_answer':
      return (
        <div style={{ marginTop: 12 }}>
          <DebouncedTextField placeholder="Ketik jawaban singkat…" value={value} onCommit={onAnswer} />
        </div>
      );
    case 'essay':
      return (
        <div style={{ marginTop: 12 }}>
          <DebouncedTextField placeholder="Tulis jawaban uraian…" value={value} onCommit={onAnswer} multiline />
        </div>
      );
  }
}

// Matching (FR-11): tap kiri lalu tap kanan untuk memasangkan. Tap kanan yang sudah
// berpasangan (atau tap kiri yang sama dua kali) melepas pasangan (unpair).
function MatchingInput({ q, value, onAnswer }: { q: Question; value: any; onAnswer: (p: any) => void }) {
  const opts = q.options_json as { left: { id: string; html: string }[]; right: { id: string; html: string }[] };
  const pairs: Record<string, string> = value?.pairs || {};
  const [picked, setPicked] = useState<string | null>(null);
  const pairedLeft = new Map(Object.entries(pairs));
  const pairedRight = new Map(Object.entries(pairs).map(([l, r]) => [r, l]));

  const tapLeft = (l: string) => {
    if (picked === l) { setPicked(null); return; } // batal pilih
    if (pairs[l]) { const np = { ...pairs }; delete np[l]; onAnswer({ pairs: np }); return; } // unpair
    setPicked(l);
  };
  const tapRight = (r: string) => {
    if (!picked) {
      if (pairedRight.has(r)) { // unpair dari sisi kanan
        const np = { ...pairs }; delete np[pairedRight.get(r)!]; onAnswer({ pairs: np });
      }
      return;
    }
    const np = { ...pairs };
    delete np[picked]; // normalisasi: satu pasangan per kiri
    for (const [l, pr] of Object.entries(np)) if (pr === r) delete np[l]; // kanan boleh dipakai ulang: lepas pasangan lama
    np[picked] = r;
    onAnswer({ pairs: np });
    setPicked(null);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div className="matching-grid">
        <div style={{ display: 'grid', gap: 9 }}>
          {opts.left.map((l) => {
            const pr = pairedLeft.get(l.id);
            return (
              <button key={l.id} onClick={() => tapLeft(l.id)} aria-pressed={picked === l.id} aria-label={`Item kiri: ${stripHtml(l.html)}${pr ? ', sudah berpasangan; ketuk untuk melepas' : ''}`} className={'q-opt' + (picked === l.id ? ' flagged' : '') + (pr ? ' selected' : '')}>
                <div>
                  <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(l.html) }} />
                  {pr && <div style={{ marginTop: 6 }}><Badge tone="ok"><Icon name="chevron-right" /> {shortText(opts.right.find((r) => r.id === pr)?.html || '')}</Badge></div>}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gap: 9 }}>
          {opts.right.map((r) => (
            <button
              key={r.id}
              onClick={() => tapRight(r.id)}
              aria-label={`Item kanan: ${stripHtml(r.html)}`}
              className={'q-opt' + (pairedRight.has(r.id) ? ' selected' : '')}
            >
              <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(r.html) }} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 9 }}>
        Pilih item di kiri, lalu pasangannya di kanan. Ketuk item yang sudah berpasangan untuk melepasnya.
      </div>
    </div>
  );
}

function shortText(html: string, max = 24): string {
  const t = html.replace(/<[^>]*>/g, '').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// Input jawaban berbasis teks dengan debounce (600 ms) + commit saat blur:
// mencegah satu event API per ketikan membanjiri outbox/sinkron.
function DebouncedTextField({ value, onCommit, placeholder, multiline = false }: {
  value: any; onCommit: (p: { text: string }) => void; placeholder: string; multiline?: boolean;
}) {
  const [text, setText] = useState<string>(value?.text || '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if ((value?.text || '') !== textRef.current) commitRef.current({ text: textRef.current });
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = (t: string) => {
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; commitRef.current({ text: textRef.current }); }, 600);
  };

  const shared = {
    value: text,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onBlur: flush,
    'aria-label': placeholder.replace('…', ''),
  };
  return multiline
    ? <textarea className="input" style={{ minHeight: 160 }} placeholder={placeholder} {...shared} />
    : <input className="input" style={{ minHeight: 48 }} placeholder={placeholder} {...shared} />;
}
