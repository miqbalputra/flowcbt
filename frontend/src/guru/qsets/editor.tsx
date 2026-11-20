// HALAMAN TERPENTING: buat/edit paket soal AKM (FR-4.3..4.7).
// v1: teks soal = textarea menerima HTML sederhana + hint, tanpa editor berat;
//     sanitize whitelist tag saat render (renderSimpleHtml). Pratinjau siswa via modal.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, StatusBadge } from '../ui'
import { QuestionPreview } from './preview'
import {
  LETTERS, SCHOOL_LEVELS, QTYPES, asDict, asList, errMessage, qtypeIcon, qtypeLabel,
  renderSimpleHtml, unwrap, type Dict, type QType,
} from '../types'

let uid = 0
function newQuestion(type: QType): Dict {
  uid += 1
  const base: Dict = { _uid: `q${uid}`, type, body: '', points: 1 }
  if (type === 'pg') {
    base.options = LETTERS.slice(0, 5).map(l => ({ label: l, text: '' }))
    base.key = ''
    base.shuffle_options = false
  } else if (type === 'pg_kompleks') {
    base.options = LETTERS.slice(0, 4).map(l => ({ label: l, text: '' }))
    base.correct = [] as string[]
    base.scoring = 'all'
    base.shuffle_options = false
  } else if (type === 'menjodohkan') {
    base.pairs = [{ left: '', right: '' }]
    base.scoring = 'all'
  } else if (type === 'isian') {
    base.keys = ['']
  } else {
    base.rubric = ''
  }
  return base
}

export default function QsetEditor() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const nav = useNavigate()
  const qc = useQueryClient()

  const [info, setInfo] = useState<Dict>({ subject_name: '', title: '', description: '', level_tags: [] as string[] })
  const [stimuli, setStimuli] = useState<Dict[]>([])
  const [questions, setQuestions] = useState<Dict[]>([])
  const [loadedStatus, setLoadedStatus] = useState('draft')
  const [stimOpen, setStimOpen] = useState<null | { id?: string; title: string; content: string }>(null)
  const [preview, setPreview] = useState<null | { q: Dict; stimulusHtml: string }>(null)
  const [deleting, setDeleting] = useState<Dict | null>(null)
  const [deletingStimulus, setDeletingStimulus] = useState<Dict | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const detail = useQuery({
    queryKey: ['question-set', id],
    queryFn: async () => unwrap(await api(`/question-sets/${id}`)),
    enabled: !isNew,
  })

  const existing = useMemo(() => {
    if (!detail.data) return null
    const d = asDict(detail.data)
    return {
      subject_name: String(d.subject_name ?? d.subject ?? ''),
      title: String(d.title ?? ''),
      description: String(d.description ?? ''),
      level_tags: asList(d.level_tags ?? d.levels ?? []).map(t => String(t)),
      exam_code: String(d.exam_code ?? ''),
      status: String(d.status ?? 'draft'),
      questions: asList(d.questions ?? []).map(q => ({ ...asDict(q), _uid: `x${String(asDict(q).id ?? '')}` })),
      stimuli: asList(d.stimuli ?? d.stimulus ?? []).map(s => asDict(s)),
    }
  }, [detail.data])

  // isi form sekali saat data pertama masuk (tak menimpa editan lokal wajar)
  const [filled, setFilled] = useState(false)
  if (existing && !filled && !isNew) {
    setFilled(true)
    setInfo({
      subject_name: existing.subject_name,
      title: existing.title,
      description: existing.description,
      level_tags: existing.level_tags,
    })
    setStimuli(existing.stimuli)
    setQuestions(existing.questions)
    setLoadedStatus(existing.status)
  }
  if (detail.isError && filled) { /* biarkan ErrorBox tampil */ }

  function patchQuestion(i: number, patch: Dict) {
    setQuestions(qs => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  }
  function move(i: number, dir: -1 | 1) {
    setQuestions(qs => {
      const j = i + dir
      if (j < 0 || j >= qs.length) return qs
      const copy = [...qs]; const [item] = copy.splice(i, 1); copy.splice(j, 0, item)
      return copy
    })
  }
  function dupQuestion(i: number) {
    uid += 1
    setQuestions(qs => [...qs.slice(0, i + 1), { ...qs[i], _uid: `q${uid}`, id: undefined }, ...qs.slice(i + 1)])
  }

  async function addStimulus() {
    if (!stimOpen || isNew) return
    try {
      await send(`/question-sets/${id}/stimuli`, { title: stimOpen.title, content: stimOpen.content }, 'POST')
      toast('Wacana ditambahkan 📖', 'success')
      setStimOpen(null)
      void qc.invalidateQueries({ queryKey: ['question-set', id] })
      if (detail.data) {
        // deretan lokal tetap diperbarui agar instan
        setStimuli(prev => [...prev, { id: `local-${Date.now()}`, title: stimOpen.title, content: stimOpen.content }])
      }
    } catch (err) {
      toast(errMessage(err), 'error')
    }
  }
  async function delStimulus(s: Dict) {
    if (isNew || typeof s.id !== 'string' || s.id.startsWith('local-')) {
      setStimuli(prev => prev.filter(x => x !== s))
      return
    }
    try {
      await api(`/stimuli/${s.id}`, { method: 'DELETE' })
      setStimuli(prev => prev.filter(x => x !== s))
      toast('Wacana dihapus', 'success')
    } catch (err) {
      toast(errMessage(err), 'error')
    }
  }

  const published = loadedStatus === 'published' && !isNew

  // payload soal sesuai kontrak endpoint /question-sets/{id}/questions & /questions/{id}
  function questionPayload(q: Dict): Dict {
    const payload: Dict = {
      type: q.type,
      body: q.body ?? '',
      points: Number(q.points) || 1,
    }
    if (q.stimuli_id) payload.stimuli_id = q.stimuli_id
    if (q.type === 'pg') payload.key = q.key
    if (q.type === 'pg' || q.type === 'pg_kompleks') {
      payload.options = asList(q.options).map(o => ({ label: o.label, text: o.text }))
      payload.shuffle_options = Boolean(q.shuffle_options)
    }
    if (q.type === 'pg_kompleks') { payload.correct = asList(q.correct).map(String); payload.scoring = q.scoring ?? 'all' }
    if (q.type === 'menjodohkan') { payload.pairs = asList(q.pairs); payload.scoring = q.scoring ?? 'all' }
    if (q.type === 'isian') payload.keys = asList(q.keys).map(String).filter(Boolean)
    if (q.type === 'uraian') payload.rubric = q.rubric ?? ''
    if (q.explanation) payload.explanation = q.explanation
    if (typeof q.id === 'string' && q.id) payload.id = q.id
    return payload
  }

  // validasi FR-4.7 sebelum publish: tiap soal punya kunci & poin
  function keyProblem(q: Dict): string {
    if (!String(q.body ?? '').trim()) return 'Teks soal masih kosong'
    if (q.type === 'pg' && !String(q.key ?? '')) return 'Kunci jawaban PG belum dipilih'
    if (q.type === 'pg_kompleks' && asList(q.correct).length === 0) return 'Minimal satu kunci PG kompleks'
    if (q.type === 'menjodohkan' && asList(q.pairs).filter(p => String(p.left ?? '').trim() && String(p.right ?? '').trim()).length < 1)
      return 'Minimal satu pasangan lengkap (kiri & kanan)'
    if (q.type === 'isian' && asList(q.keys).map(String).filter(Boolean).length === 0) return 'Minimal satu kunci isian'
    return ''
  }

  function infoProblem(): string {
    if (!String(info.title ?? '').trim()) return 'Judul paket wajib diisi'
    if (!String(info.subject_name ?? '').trim()) return 'Mata pelajaran wajib diisi'
    return ''
  }

  const save = useMutation({
    mutationFn: async ({ publish }: { publish?: boolean } = {}) => {
      const infoErr = infoProblem()
      if (infoErr) throw new Error(infoErr)
      const meta = {
        subject_name: String(info.subject_name ?? '').trim(),
        title: String(info.title ?? '').trim(),
        description: String(info.description ?? '').trim() || undefined,
        level_tags: asList(info.level_tags).map(String),
      }
      let setId = id ?? ''
      if (isNew) {
        const created = unwrap(await send('/question-sets', meta, 'POST'))
        setId = String(asDict(created).id ?? '')
      } else {
        await send(`/question-sets/${id}`, meta, 'PUT')
      }
      // soal: buat yang belum punya id, perbarui yang sudah ada
      for (const q of questions) {
        const payload = questionPayload(q)
        if (typeof q.id === 'string' && q.id) {
          await send(`/questions/${q.id}`, payload, 'PUT')
        } else {
          const newQ = unwrap(await send(`/question-sets/${setId}/questions`, payload, 'POST'))
          q.id = String(asDict(newQ).id ?? '') // supaya reorder terkirim dengan id router
        }
      }
      if (!isNew && questions.length > 0) {
        await send(`/question-sets/${setId}/reorder`, { order: questions.map(q => q.id).filter(Boolean).map(String) }, 'POST')
      }
      if (publish) {
        const problem = questions.map(q => keyProblem(q)).find(Boolean)
        if (!problem || questions.length === 0) {
          throw new Error(questions.length === 0 ? 'Tambahkan minimal satu soal sebelum publish' : (problem ?? 'Soal belum lengkap'))
        }
        await api(`/question-sets/${setId}/publish`, { method: 'POST' })
      }
      return setId
    },
    onSuccess: (setId, vars) => {
      toast(vars?.publish ? 'Paket soal dipublish! 🎉' : 'Draft tersimpan ✅', 'success')
      void qc.invalidateQueries({ queryKey: ['question-sets'] })
      void qc.invalidateQueries({ queryKey: ['question-set', setId] })
      if (isNew) nav(`/question-sets/${setId}/edit`, { replace: true })
    },
    onError: e => toast(errMessage(e), 'error'),
  })

  async function unpublish() {
    try {
      await api(`/question-sets/${id}/unpublish`, { method: 'POST' })
      toast('Paket kembali ke draft', 'success')
      void qc.invalidateQueries({ queryKey: ['question-set', id] })
      void qc.invalidateQueries({ queryKey: ['question-sets'] })
    } catch (err) {
      toast(errMessage(err), 'error')
    }
  }

  const busy = save.isPending

  if (!isNew && detail.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Editor Paket Soal" />
        <SkeletonRows rows={5} cols={5} />
      </div>
    )
  }
  if (!isNew && detail.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Editor Paket Soal" />
        <ErrorBox error={detail.error} />
      </div>
    )
  }

  const stimulusHtmlFor = (sid: unknown) => {
    const s = stimuli.find(x => String(x.id ?? '') === String(sid ?? ''))
    return s ? renderSimpleHtml(`<b>${s.title ?? 'Wacana'}</b><br/>${s.content ?? ''}`) : ''
  }

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        title={isNew ? 'Paket Soal Baru' : 'Editor Paket Soal'}
        desc={isNew ? 'Susun soal AKM: PG, PG kompleks, menjodohkan, isian, uraian.' : `Kode ujian: ${existing?.exam_code ?? '—'}`}
        action={
          <div className="flex items-center gap-2">
            {!isNew && <StatusBadge status={loadedStatus} />}
          </div>
        }
      />

      {/* ---- info paket (FR-4.1) ---- */}
      <div className="card space-y-3">
        <h3 className="font-semibold">📘 Info paket</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="qs-subject">Mata pelajaran</label>
            <input id="qs-subject" className="input" required value={String(info.subject_name ?? '')}
              onChange={e => setInfo(f => ({ ...f, subject_name: e.target.value }))} placeholder="Matematika" />
          </div>
          <div>
            <label className="label" htmlFor="qs-title">Judul paket</label>
            <input id="qs-title" className="input" required value={String(info.title ?? '')}
              onChange={e => setInfo(f => ({ ...f, title: e.target.value }))} placeholder="Latihan AKM Numerasi" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="qs-desc">Deskripsi <span className="font-normal">(opsional)</span></label>
          <textarea id="qs-desc" className="input min-h-16" value={String(info.description ?? '')}
            onChange={e => setInfo(f => ({ ...f, description: e.target.value }))} placeholder="Untuk kelas…" />
        </div>
        <div>
          <span className="label">Jenjang (tag)</span>
          <div className="flex flex-wrap gap-2">
            {SCHOOL_LEVELS.map(l => {
              const active = asList(info.level_tags).map(String).includes(l)
              return (
                <button key={l} type="button"
                  className={`badge border min-h-[36px] ${active ? 'btn-primary !min-w-0 !px-3' : 'btn-ghost !min-w-0 !px-3'}`}
                  onClick={() => setInfo(f => ({
                    ...f,
                    level_tags: active ? asList(f.level_tags).map(String).filter(t => t !== l) : [...asList(f.level_tags).map(String), l],
                  }))}>
                  {l}
                </button>
              )
            })}
          </div>
        </div>
        {!isNew && (
          <div className="text-sm text-muted">
            Kode ujian: <b className="font-mono">{existing?.exam_code || '—'}</b> (dipakai siswa saat masuk ujian)
          </div>
        )}
      </div>

      {/* ---- wacana/stimulus (AKM literasi) ---- */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">📖 Wacana / stimulus</h3>
          {isNew
            ? <span className="text-xs text-muted">Simpan draft dulu untuk menambah wacana</span>
            : <button type="button" className="btn-ghost text-sm" onClick={() => setStimOpen({ title: '', content: '' })}>＋ Wacana</button>}
        </div>
        {stimuli.length === 0
          ? <p className="text-sm text-muted">Belum ada wacana dibagikan — soal boleh berdiri sendiri.</p>
          : (
            <div className="space-y-2">
              {stimuli.map((s, i) => (
                <div key={s.id ?? i} className="rounded-lg border border-border p-3 flex items-start gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left hover:opacity-80"
                    onClick={() => setPreview({ q: { type: 'pg', body: String(s.content ?? ''), points: 0 }, stimulusHtml: '' })}>
                    <div className="text-sm font-medium truncate">{String(s.title ?? 'Wacana')}</div>
                    <div className="text-xs text-muted line-clamp-2" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(s.content ?? '')) }} />
                  </button>
                  <button type="button" className="btn-danger btn-sm shrink-0" onClick={() => setDeletingStimulus(s)}>Hapus</button>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* ---- daftar soal (FR-4.4) ---- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">❓ Soal ({questions.length})</h3>
          <button type="button" className="btn-primary text-sm" onClick={() => setAddOpen(true)}>＋ Tambah Soal</button>
        </div>

        {questions.map((question, qi) => {
          const type = String(question.type) as QType
          const options = asList(question.options)
          const stimulus = question.stimuli_id ? stimulusHtmlFor(question.stimuli_id) : ''
          return (
            <div key={String(question._uid ?? qi)} className="card space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge bg-primary/10 text-primary">#{qi + 1}</span>
                <span className="badge bg-border/30">{qtypeIcon(type)} {qtypeLabel(type)}</span>
                <div className="ml-auto flex gap-1.5">
                  <button type="button" aria-label="Naikkan soal" className="btn-ghost !min-w-11 w-9 h-11 !p-0 disabled:opacity-40"
                    disabled={qi === 0} onClick={() => move(qi, -1)}>↑</button>
                  <button type="button" aria-label="Turunkan soal" className="btn-ghost !min-w-11 w-9 h-11 !p-0 disabled:opacity-40"
                    disabled={qi === questions.length - 1} onClick={() => move(qi, 1)}>↓</button>
                  <button type="button" aria-label="Duplikat soal" className="btn-ghost w-11 h-11 !p-0" onClick={() => dupQuestion(qi)}>📄</button>
                  <button type="button" aria-label="Hapus soal" className="btn-danger w-11 h-11 !p-0" onClick={() => setDeleting(question)}>🗑</button>
                </div>
              </div>

              {stimulus && (
                <div className="rounded-lg bg-surface border border-border p-3 text-sm" dangerouslySetInnerHTML={{ __html: stimulus }} />
              )}

              <div>
                <label className="label" htmlFor={`body-${qi}`}>Teks soal — boleh HTML sederhana: {'<b> <i> <ul> <li> <table>'}</label>
                <textarea id={`body-${qi}`} className="input min-h-20" value={String(question.body ?? '')}
                  onChange={e => patchQuestion(qi, { body: e.target.value })} placeholder="Ketik soal…" />
                {Boolean(question.body) && (
                  <button type="button" className="btn-ghost text-xs mt-1.5"
                    onClick={() => setPreview({ q: question, stimulusHtml: stimulus })}>
                    👀 Pratinjau tampilan siswa
                  </button>
                )}
              </div>

              {/* input jawaban per tipe */}
              {type === 'pg' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="label !mb-0">Opsi jawaban — pilih radio untuk kunci</span>
                    <button type="button" className="btn-ghost btn-sm"
                      disabled={options.length >= 5}
                      onClick={() => patchQuestion(qi, { options: [...options, { label: LETTERS[options.length] ?? '?', text: '' }] })}>
                      ＋ opsi
                    </button>
                  </div>
                  {options.map((o, oi) => (
                    <div key={o.label ?? oi} className="flex items-center gap-2">
                      <input type="radio" aria-label={`Kunci ${o.label}`} className="shrink-0 w-5 h-5"
                        checked={String(question.key ?? '') === String(o.label)} onChange={() => patchQuestion(qi, { key: o.label })} />
                      <span className="font-bold text-sm shrink-0">{String(o.label)}.</span>
                      <input className="input !min-h-0 flex-1" value={String(o.text ?? '')}
                        onChange={e => patchQuestion(qi, { options: options.map((x, k) => (k === oi ? { ...x, text: e.target.value } : x)) })} />
                      <button type="button" aria-label="Hapus opsi" className="btn-ghost w-9 h-11 !p-0 shrink-0"
                        onClick={() => {
                          const rest = options.filter((_, k) => k !== oi)
                          patchQuestion(qi, { options: rest.map((x, k) => ({ ...x, label: LETTERS[k] ?? x.label })), key: question.key === o.label ? '' : question.key })
                        }}>✕</button>
                    </div>
                  ))}
                  <label className="flex items-center gap-2 text-sm min-h-[44px]">
                    <input type="checkbox" checked={Boolean(question.shuffle_options)}
                      onChange={e => patchQuestion(qi, { shuffle_options: e.target.checked })} />
                    Acak urutan pilihan
                  </label>
                </div>
              )}

              {type === 'pg_kompleks' && (
                <div className="space-y-2">
                  <span className="label !mb-0">Opsi — centang semua jawaban benar</span>
                  {options.map((o, oi) => (
                    <div key={o.label ?? oi} className="flex items-center gap-2">
                      <input type="checkbox" aria-label={`Kunci ${o.label}`} className="shrink-0 w-5 h-5"
                        checked={asList(question.correct).map(String).includes(String(o.label))}
                        onChange={e => {
                          const cur = asList(question.correct).map(String)
                          patchQuestion(qi, { correct: e.target.checked ? [...cur, String(o.label)] : cur.filter(l => l !== o.label) })
                        }} />
                      <span className="font-bold text-sm shrink-0">{String(o.label)}.</span>
                      <input className="input !min-h-0 flex-1" value={String(o.text ?? '')}
                        onChange={e => patchQuestion(qi, { options: options.map((x, k) => (k === oi ? { ...x, text: e.target.value } : x)) })} />
                    </div>
                  ))}
                  <div>
                    <span className="label !mb-0">Skoring benar-atau-tidak / parsial</span>
                    <select className="input" value={String(question.scoring ?? 'all')}
                      onChange={e => patchQuestion(qi, { scoring: e.target.value })}>
                      <option value="all">Semua-atau-tidak</option>
                      <option value="partial">Parsial per opsi</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm min-h-[44px]">
                    <input type="checkbox" checked={Boolean(question.shuffle_options)}
                      onChange={e => patchQuestion(qi, { shuffle_options: e.target.checked })} />
                    Acak urutan pilihan
                  </label>
                </div>
              )}

              {type === 'menjodohkan' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="label !mb-0">Pasangan kiri ↔ kanan</span>
                    <button type="button" className="btn-ghost btn-sm"
                      onClick={() => patchQuestion(qi, { pairs: [...asList(question.pairs), { left: '', right: '' }] })}>＋ pasangan</button>
                  </div>
                  {asList(question.pairs).map((p, pi) => (
                    <div key={pi} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <input className="input !min-h-0" aria-label="Kiri" placeholder="kolom kiri" value={String(p.left ?? '')}
                        onChange={e => patchQuestion(qi, { pairs: asList(question.pairs).map((x, k) => (k === pi ? { ...x, left: e.target.value } : x)) })} />
                      <input className="input !min-h-0" aria-label="Kanan" placeholder="kolom kanan" value={String(p.right ?? '')}
                        onChange={e => patchQuestion(qi, { pairs: asList(question.pairs).map((x, k) => (k === pi ? { ...x, right: e.target.value } : x)) })} />
                      <button type="button" aria-label="Hapus pasangan" className="btn-ghost w-9 h-11 !p-0"
                        onClick={() => patchQuestion(qi, { pairs: asList(question.pairs).filter((_, k) => k !== pi) })}>✕</button>
                    </div>
                  ))}
                  <div>
                    <span className="label !mb-0">Skoring</span>
                    <select className="input" value={String(question.scoring ?? 'all')}
                      onChange={e => patchQuestion(qi, { scoring: e.target.value })}>
                      <option value="all">Semua pasangan benar</option>
                      <option value="partial">Parsial per pasangan</option>
                    </select>
                  </div>
                </div>
              )}

              {type === 'isian' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="label !mb-0">Daftar kunci (case-insensitive)</span>
                    <button type="button" className="btn-ghost btn-sm"
                      onClick={() => patchQuestion(qi, { keys: [...asList(question.keys).map(String), ''] })}>＋ kunci</button>
                  </div>
                  {asList(question.keys).map((k, ki) => (
                    <div key={ki} className="flex gap-2">
                      <input className="input !min-h-0 flex-1" placeholder={`kunci ${ki + 1}`} value={String(k ?? '')}
                        onChange={e => patchQuestion(qi, { keys: asList(question.keys).map((x, j) => (j === ki ? e.target.value : x)) })} />
                      <button type="button" aria-label="Hapus kunci" className="btn-ghost w-9 h-11 !p-0"
                        disabled={asList(question.keys).length <= 1}
                        onClick={() => patchQuestion(qi, { keys: asList(question.keys).filter((_, j) => j !== ki) })}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              {type === 'uraian' && (
                <div>
                  <span className="label !mb-0">Rubrik penilaian uraian</span>
                  <textarea className="input min-h-20" placeholder="Kriteria jawaban lengkap…"
                    value={String(question.rubric ?? '')}
                    onChange={e => patchQuestion(qi, { rubric: e.target.value })} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label !mb-0" htmlFor={`pts-${qi}`}>Poin soal</label>
                  <input id={`pts-${qi}`} type="number" min={1} max={100} className="input" value={String(question.points ?? 1)}
                    onChange={e => patchQuestion(qi, { points: Number(e.target.value) || 1 })} />
                </div>
                {(type === 'pg' || type === 'pg_kompleks' || type === 'isian' || type === 'uraian') && (
                  <div>
                    <label className="label !mb-0" htmlFor={`expl-${qi}`}>Pembahasan <span className="font-normal">(opsional)</span></label>
                    <input id={`expl-${qi}`} className="input" value={String(question.explanation ?? '')}
                      onChange={e => patchQuestion(qi, { explanation: e.target.value })} placeholder="Penjelasan singkat…" />
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {questions.length === 0 && (
          <EmptyState icon="❓" title="Belum ada soal" children="Klik ＋ Tambah Soal — pilih salah satu dari 5 tipe soal AKM." />
        )}
      </div>

      {/* ---- action bar sticky ---- */}
      <div
        className="fixed bottom-14 lg:bottom-4 inset-x-3 sm:inset-x-auto sm:right-4 z-40 max-w-lg sm:ml-auto card !p-2.5 flex flex-wrap gap-2 items-center shadow-lg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <button type="button" className="btn-ghost text-sm flex-1 min-w-28" disabled={busy || detail.isLoading}
          onClick={() => save.mutate({})}>
          {busy ? 'Menyimpan…' : '💾 Simpan Draft'}
        </button>
        {published ? (
          <button type="button" className="btn-ghost text-sm flex-1 min-w-28" disabled={busy} onClick={() => void unpublish()}>
            ↩️ Unpublish
          </button>
        ) : (
          <button type="button" className="btn-primary text-sm flex-1 min-w-28" disabled={busy || detail.isLoading}
            onClick={() => save.mutate({ publish: true })}>
            🚀 Publish
          </button>
        )}
      </div>

      {/* modal tambah soal (pilih tipe) */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Tambah soal — pilih tipe">
        <div className="grid grid-cols-1 gap-2">
          {QTYPES.map(t => (
            <button key={t.value} type="button" className="btn-ghost justify-start"
              onClick={() => { setAddOpen(false); setQuestions(qs => [...qs, newQuestion(t.value)]) }}>
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </Modal>

      {/* modal wacana baru */}
      <Modal
        open={!!stimOpen}
        onClose={() => setStimOpen(null)}
        title="Wacana baru"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setStimOpen(null)}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void addStimulus()} disabled={busy || isNew || !stimOpen?.title.trim()}>
              Tambah wacana
            </button>
          </>
        }
      >
        <p className="text-sm text-muted">Wacana dipakai bersama beberapa soal (khas AKM literasi). Dapat ditulis HTML sederhana.</p>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="stim-t">Judul wacana</label>
            <input id="stim-t" className="input" value={stimOpen?.title ?? ''}
              onChange={e => setStimOpen(s => (s ? { ...s, title: e.target.value } : s))} />
          </div>
          <div>
            <label className="label" htmlFor="stim-c">Isi wacana</label>
            <textarea id="stim-c" className="input min-h-28" value={stimOpen?.content ?? ''} placeholder={'<b>Paragraf 1</b><br/>…'}
              onChange={e => setStimOpen(s => (s ? { ...s, content: e.target.value } : s))} />
          </div>
        </div>
      </Modal>

      {/* pratinjau siswa */}
      <QuestionPreview
        open={!!preview}
        onClose={() => setPreview(null)}
        title={String(info.title ?? 'Paket Soal')}
        stimulusHtml={preview?.stimulusHtml ?? ''}
        q={preview?.q ?? null}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Hapus soal?"
        message="Soal dihapus dari paket ini. Tindakan tidak bisa dibatalkan."
        danger busy={busy}
        onConfirm={() => { setQuestions(qs => qs.filter(q => q !== deleting)); setDeleting(null) }}
        onClose={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={!!deletingStimulus}
        title="Hapus wacana?"
        message={`Hapus wacana "${deletingStimulus?.title ?? ''}"? Tindakan tidak bisa dibatalkan.`}
        danger confirmLabel="Ya, hapus"
        onConfirm={() => { const s = deletingStimulus; setDeletingStimulus(null); if (s) void delStimulus(s) }}
        onClose={() => setDeletingStimulus(null)}
      />
    </div>
  )
}
