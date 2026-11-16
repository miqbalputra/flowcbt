import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@flowcbt/api-client';
import { Button, Card, Badge, BottomSheet, ConnectionBadge, useToast, ThemeToggle, Icon } from '@flowcbt/ui';
import { fmtDuration, QUESTION_TYPE_LABEL, type ExamPacket, type Question, type SyncEvent } from '@flowcbt/shared';
import { db, LocalAttempt } from '../offline/db';
import { calibrate, deadlineCountdownMs, drainOutbox, newEventId, connState, type ServerClock } from '../offline/engine';

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

  if (!att || !packet) return <div style={{ padding: 24 }}><Card>Memuat ujian…</Card></div>;
  const q = questions[idx];
  const state = connState(online, pending);

  return (
    <div className="app-wrap">
      {/* header sticky: nama ujian, timer, koneksi, tema (FR-6.3) */}
      <div className="st-head" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ flex: 1, minWidth: 100, fontSize: 15 }}>{packet.exam.name}</strong>
        <span className={'timer-chip' + (left !== null && left < 60000 ? ' low' : '')}>
          <Icon name="clock" size={15} />
          {fmtDuration((left || 0) / 1000)}
        </span>
        <ConnectionBadge online={online} pending={pending} />
        <ThemeToggle />
      </div>
      <div style={{ height: 12 }} />
      {warned > 0 && (
        <div className="banner banner-danger" role="alert" style={{ marginBottom: 12 }}>
          <strong>Pelanggaran ke-{warned} tercatat</strong> — Anda meninggalkan halaman ujian.
          Sisa kesempatan sebelum dilaporkan: {Math.max(0, (packet.exam.anticheat.flag_threshold ?? 3) - warned)}.
        </div>
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span className="card-sub">
            Soal <strong style={{ color: 'var(--text)' }}>{idx + 1}</strong> dari {questions.length}
          </span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Badge tone="muted">{QUESTION_TYPE_LABEL[q.type]}</Badge>
            <Badge tone="brand">{q.points} poin</Badge>
          </span>
        </div>
        <div className="q-body" dangerouslySetInnerHTML={{ __html: q.body_html }} />
        <QuestionInput q={q} value={answers[q.id]?.payload} flagged={answers[q.id]?.flagged} onAnswer={(p) => setAnswer(q.id, p)} onFlag={() => toggleFlag(q.id)} />
      </Card>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
          <Icon name="chevron-left" /> Sebelumnya
        </Button>
        <Button variant="ghost" onClick={() => setShowNav(true)}>
          <Icon name="list" /> Daftar ({Object.keys(answers).filter((k) => answers[k].payload != null).length}/{questions.length})
        </Button>
        <Button variant="ghost" disabled={idx === questions.length - 1} onClick={() => setIdx(idx + 1)}>
          Berikutnya <Icon name="chevron-right" />
        </Button>
        <Button style={{ marginLeft: 'auto' }} onClick={() => nav(`/attempt/${id}/review`)}>
          <Icon name="check" /> Selesai
        </Button>
      </div>

      <BottomSheet open={showNav} onClose={() => setShowNav(false)} title="Daftar Soal">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 9 }}>
          {questions.map((qq, i) => {
            const a = answers[qq.id];
            const answered = a?.payload != null;
            return (
              <button
                key={qq.id}
                onClick={() => { setIdx(i); setShowNav(false); }}
                className={'q-nav' + (answered ? ' answered' : '') + (a?.flagged ? ' flagged' : '') + (i === idx ? ' current' : '')}
                aria-label={`Soal ${i + 1}${answered ? ', sudah dijawab' : ''}${a?.flagged ? ', ditandai ragu-ragu' : ''}`}
                aria-current={i === idx}
              >
                {i + 1}
                {a?.flagged && <span className="st-ic" aria-hidden="true"><Icon name="flag" size={10} /></span>}
                {!a?.flagged && answered && <svg className="svg-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 12.5 5 5 10-11" /></svg>}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12.5, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--ok-bg)', border: '1.5px solid var(--ok)', display: 'inline-block' }} /> Terjawab</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--surface)', border: '1.5px solid var(--muted-2)', display: 'inline-block' }} /> Kosong</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--warn-bg)', border: '1.5px solid var(--warn)', display: 'inline-block' }} /> Ragu-ragu</span>
        </div>
      </BottomSheet>
    </div>
  );
}

// ---- Input jawaban per tipe soal (FR-4.3) ----
function QuestionInput({ q, value, flagged, onAnswer, onFlag }: { q: Question; value: any; flagged?: boolean; onAnswer: (p: any) => void; onFlag: () => void }) {
  switch (q.type) {
    case 'mcq': {
      const opts = q.options_json as { id: string; html: string }[];
      return (
        <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
          {opts.map((o) => (
            <button
              key={o.id}
              onClick={() => onAnswer({ selected: o.id })}
              className={'q-opt' + (value?.selected === o.id ? ' selected' : '')}
              aria-pressed={value?.selected === o.id}
            >
              <span className="opt-key" aria-hidden="true">{o.id}</span>
              <span dangerouslySetInnerHTML={{ __html: o.html }} />
            </button>
          ))}
          <FlagButton flagged={flagged} onFlag={onFlag} />
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
            <button key={o.id} onClick={() => toggle(o.id)} className={'q-opt' + (sel.includes(o.id) ? ' selected' : '')} aria-pressed={sel.includes(o.id)}>
              <span className="opt-key" aria-hidden="true">{sel.includes(o.id) ? <Icon name="check" size={14} /> : '\u00A0'}</span>
              <span dangerouslySetInnerHTML={{ __html: o.html }} />
            </button>
          ))}
          <FlagButton flagged={flagged} onFlag={onFlag} />
        </div>
      );
    }
    case 'matching':
      // komponen terpisah agar hook (useState) tidak dipanggil kondisional di switch
      return <MatchingInput q={q} value={value} flagged={flagged} onAnswer={onAnswer} onFlag={onFlag} />;
    case 'short_answer':
      return (
        <div style={{ marginTop: 12 }}>
          <DebouncedTextField placeholder="Ketik jawaban singkat…" value={value} onCommit={onAnswer} />
          <FlagButton flagged={flagged} onFlag={onFlag} />
        </div>
      );
    case 'essay':
      return (
        <div style={{ marginTop: 12 }}>
          <DebouncedTextField placeholder="Tulis jawaban uraian…" value={value} onCommit={onAnswer} multiline />
          <FlagButton flagged={flagged} onFlag={onFlag} />
        </div>
      );
  }
}

// Matching (FR-11): tap kiri lalu tap kanan untuk memasangkan. Tap kanan yang sudah
// berpasangan (atau tap kiri yang sama dua kali) melepas pasangan (unpair).
function MatchingInput({ q, value, flagged, onAnswer, onFlag }: { q: Question; value: any; flagged?: boolean; onAnswer: (p: any) => void; onFlag: () => void }) {
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        <div style={{ display: 'grid', gap: 9 }}>
          {opts.left.map((l) => {
            const pr = pairedLeft.get(l.id);
            return (
              <button key={l.id} onClick={() => tapLeft(l.id)} aria-pressed={picked === l.id} aria-label={pr ? 'item kiri, sudah berpasangan; ketuk untuk melepas' : 'item kiri'} className={'q-opt' + (picked === l.id ? ' flagged' : '') + (pr ? ' selected' : '')}>
                <div>
                  <span dangerouslySetInnerHTML={{ __html: l.html }} />
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
              aria-label="item kanan"
              className={'q-opt' + (pairedRight.has(r.id) ? ' selected' : '')}
            >
              <span dangerouslySetInnerHTML={{ __html: r.html }} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 9 }}>
        Pilih item di kiri, lalu pasangannya di kanan. Ketuk item yang sudah berpasangan untuk melepasnya.
      </div>
      <FlagButton flagged={flagged} onFlag={onFlag} />
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

function FlagButton({ flagged, onFlag }: { flagged?: boolean; onFlag: () => void }) {
  return (
    <button onClick={onFlag} className="q-opt" style={{ marginTop: 10, justifyContent: 'center', minHeight: 46, ...(flagged ? { borderColor: 'var(--warn)', background: 'var(--warn-bg)', color: 'var(--warn-text)' } : {}) }} aria-pressed={!!flagged}>
      <Icon name="flag" size={15} />
      {flagged ? 'Tandai ragu-ragu — ketuk untuk batal' : 'Tandai soal ini ragu-ragu'}
    </button>
  );
}
