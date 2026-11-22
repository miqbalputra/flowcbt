// HALAMAN TERPENTING: buat/edit paket soal AKM (FR-4.3..4.7).
// Teks soal = kotak teks BERFORMAT gaya Google Form (RichEditor): tebal, miring,
// garis bawah, daftar, pangkat — guru tidak pernah melihat tag HTML. Daftar &
// huruf kapital otomatis tetap jalan. Render aman via renderRich()/renderInline()
// dari @/lib/sanitize. Pratinjau tampilan siswa via modal.
// v3 "Portal Ujian": kepala halaman + aksi, panel info/wacana/publikasi, daftar soal
//     yang bisa diurutkan (seret pegangan atau tombol naik/turun), tiap soal = panel
//     editor dengan field berlabel + chip tipe soal.
import { useMemo, useState, type ChangeEvent } from 'react'
import { flushSync } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import {
  Callout, EmptyState, ErrorBox, PageHeader, Panel, ProgressBar, SectionHeading, SkeletonRows,
  StatCard, StatusBadge,
} from '../ui'
import { QuestionPreview } from './preview'
import {
  LETTERS, SCHOOL_LEVELS, QTYPES, asDict, asList, errMessage, qtypeIco, qtypeLabel,
  unwrap, type Dict, type QType,
} from '../types'
import { autoCapitalize, escapeHtml, htmlToText, renderInline, renderRich } from '@/lib/sanitize'
import { RichEditor } from '@/components/RichEditor'
import {
  IconBank, IconBook, IconCheck, IconChevronDown, IconChevronUp, IconClipboard, IconCopy, IconEye,
  IconMenu, IconPlus, IconTrash, IconWarn, IconX,
} from '@/components/icons'

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
    base.pairs = [{ left: '', right: '' }, { left: '', right: '' }]
    base.scoring = 'all'
  } else if (type === 'isian') {
    base.keys = ['']
  } else {
    base.rubric = ''
  }
  return base
}

// Backend memakai tipe kanonik (mcq, mcq_complex, matching, short_answer, essay)
// dan menyimpan kunci pada answer_key. Editor memakai nama ramah (pg, isian, …).
const FROM_SERVER: Record<string, QType> = {
  mcq: 'pg',
  mcq_complex: 'pg_kompleks',
  matching: 'menjodohkan',
  short_answer: 'isian',
  essay: 'uraian',
  pg: 'pg',
  pg_kompleks: 'pg_kompleks',
  menjodohkan: 'menjodohkan',
  isian: 'isian',
  uraian: 'uraian',
}
const TO_SERVER: Record<string, string> = {
  pg: 'mcq',
  pg_kompleks: 'mcq_complex',
  menjodohkan: 'matching',
  isian: 'short_answer',
  uraian: 'essay',
}

/** Array skalar (string/angka) → string; objek {value|text|label} juga didukung. */
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map(x => {
      if (typeof x === 'string' || typeof x === 'number') return String(x)
      const o = asDict(x)
      return String(o.value ?? o.text ?? o.label ?? o.id ?? '')
    })
    .filter(Boolean)
}

/** Normalisasi soal dari API ke bentuk editor (options/key/pairs/keys/rubric). */
function fromServerQuestion(raw: Dict): Dict {
  const q = { ...raw }
  const type = FROM_SERVER[String(q.type ?? '')] ?? 'pg'
  const key = asDict(q.answer_key)
  q.type = type
  // Badan soal masuk kotak berformat: teks lama tanpa tag dirapikan jadi
  // paragraf/daftar sungguhan, HTML lama disanitasi (allowlist) — tanpa tag terlihat.
  q.body = renderRich(String(q.body ?? ''))
  q.explanation = htmlToText(String(q.explanation ?? ''))
  if (type === 'pg' || type === 'pg_kompleks') {
    q.options = asList(q.options).map((o, i) => ({
      label: String(o.label ?? o.id ?? LETTERS[i] ?? ''),
      text: htmlToText(String(o.text ?? '')),
    }))
    q.shuffle_options = Boolean(q.shuffle_options)
  }
  if (type === 'pg') q.key = String(key.correct ?? q.key ?? '')
  if (type === 'pg_kompleks') {
    q.correct = strArr(key.correct ?? q.correct)
    q.scoring = String(q.scoring_mode ?? '') === 'partial' ? 'partial' : 'all'
  }
  if (type === 'menjodohkan') {
    q.pairs = asList(key.pairs ?? q.pairs).map(p => ({ left: htmlToText(String(p.left ?? '')), right: htmlToText(String(p.right ?? '')) }))
    q.scoring = String(q.scoring_mode ?? '') === 'partial' ? 'partial' : 'all'
  }
  if (type === 'isian') q.keys = strArr(key.answers ?? q.keys).map(htmlToText)
  if (type === 'uraian') q.rubric = htmlToText(String(key.rubric ?? q.rubric ?? ''))
  return q
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
  // status seret-lepas untuk urutan soal (murni UI, tidak mengubah data)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // panel "Pengaturan lanjutan" per soal (default tertutup → kartu tetap ringkas)
  const [adv, setAdv] = useState<Record<string, boolean>>({})

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
      // backend menyimpan level_tag sebagai satu string dipisah koma
      level_tags: String(d.level_tag ?? '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
      exam_code: String(d.exam_code ?? ''),
      status: String(d.status ?? 'draft'),
      questions: asList(d.questions ?? []).map(q => ({ ...fromServerQuestion(asDict(q)), _uid: `x${String(asDict(q).id ?? '')}` })),
      stimuli: asList(d.stimuli ?? d.stimulus ?? []).map(s => ({
        ...asDict(s),
        title: htmlToText(String(asDict(s).title ?? '')),
        content: renderRich(String(asDict(s).content ?? '')),
      })),
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
  /** Ganti tipe soal di kartu (dropdown gaya Google Form).
   *  Teks, poin, pembahasan, wacana, dan opsi PG dipertahankan. */
  function changeType(i: number, type: QType) {
    setQuestions(qs =>
      qs.map((q, j) => {
        if (j !== i || String(q.type) === type) return q
        const prevType = String(q.type)
        const next: Dict = newQuestion(type)
        const keep: Dict = {
          _uid: q._uid,
          type,
          body: q.body ?? '',
          points: q.points ?? 1,
          explanation: q.explanation ?? '',
        }
        if (q.stimulus_id ?? q.stimuli_id) keep.stimulus_id = q.stimulus_id ?? q.stimuli_id
        if (typeof q.id === 'string' && q.id) keep.id = q.id
        const wasPg = prevType === 'pg' || prevType === 'pg_kompleks'
        if (wasPg && (type === 'pg' || type === 'pg_kompleks') && asList(q.options).length) {
          keep.options = asList(q.options)
        }
        return { ...next, ...keep }
      }),
    )
  }

  function move(i: number, dir: -1 | 1) {
    setQuestions(qs => {
      const j = i + dir
      if (j < 0 || j >= qs.length) return qs
      const copy = [...qs]; const [item] = copy.splice(i, 1); copy.splice(j, 0, item)
      return copy
    })
  }
  /** pindahkan soal dari posisi `from` ke `to` (hasil seret-lepas) */
  function reorder(from: number, to: number) {
    setQuestions(qs => {
      if (from === to || from < 0 || to < 0 || from >= qs.length || to >= qs.length) return qs
      const copy = [...qs]
      const [item] = copy.splice(from, 1)
      copy.splice(to, 0, item)
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
      toast('Wacana ditambahkan', 'success')
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
  /** Opsi terisi saja (baris kosong diabaikan seperti Google Form) + label A-E
   *  dirapatkan. Mengembalikan peta label lama → label baru untuk kunci. */
  function compactOptions(q: Dict): { options: { id: string; text: string }[]; relabel: Record<string, string> } {
    const raw = asList(q.options).map((o, i) => ({
      id: String(o.label ?? LETTERS[i] ?? ''),
      text: String(o.text ?? '').trim(),
    }))
    const kept = raw.filter(o => o.text)
    const relabel: Record<string, string> = {}
    const options = kept.map((o, i) => {
      const id = LETTERS[i] ?? o.id
      relabel[o.id] = id
      return { id, text: o.text }
    })
    return { options, relabel }
  }

  function questionPayload(q: Dict): Dict {
    const type = String(q.type ?? 'pg')
    const key: Dict = {}
    const payload: Dict = {
      type: TO_SERVER[type] ?? 'mcq',
      body: String(q.body ?? ''),
      points: Number(q.points) || 1,
      explanation: String(q.explanation ?? ''),
    }
    if (q.stimulus_id) payload.stimulus_id = q.stimulus_id
    if (type === 'pg' || type === 'pg_kompleks') {
      const { options, relabel } = compactOptions(q)
      payload.options = options
      payload.shuffle_options = Boolean(q.shuffle_options)
      if (type === 'pg') key.correct = relabel[String(q.key ?? '')] ?? ''
      else key.correct = strArr(q.correct).map(l => relabel[l]).filter(Boolean)
    }
    if (type === 'menjodohkan') {
      const pairs = asList(q.pairs)
        .map(pr => ({ left: String(pr.left ?? '').trim(), right: String(pr.right ?? '').trim() }))
        .filter(pr => pr.left && pr.right)
      key.pairs = pairs
      payload.options = {
        left: pairs.map(pr => pr.left),
        right: pairs.map(pr => pr.right),
      }
    }
    if (type === 'isian') key.answers = strArr(q.keys).map(v => v.trim()).filter(Boolean)
    if (type === 'uraian') key.rubric = String(q.rubric ?? '')
    payload.answer_key = key
    payload.scoring_mode = type === 'pg_kompleks' || type === 'menjodohkan'
      ? (String(q.scoring ?? 'all') === 'partial' ? 'partial' : 'all_or_nothing')
      : 'all_or_nothing'
    if (typeof q.id === 'string' && q.id) payload.id = q.id
    return payload
  }

  /** Pesan ramah sebelum kirim ke server: cegah 400 VALIDATION mentah.
   *  Aturan mengikuti validasi backend (2–5 opsi, kunci wajib, ≥2 pasangan). */
  function payloadProblem(q: Dict, index: number): string {
    const n = index + 1
    const type = String(q.type ?? 'pg')
    if (!htmlToText(String(q.body ?? '')).trim()) return `Soal ${n}: teks soal masih kosong.`
    if (type === 'pg' || type === 'pg_kompleks') {
      const filled = asList(q.options).filter(o => String(o.text ?? '').trim()).length
      if (filled < 2) return `Soal ${n}: isi minimal 2 pilihan jawaban.`
      if (type === 'pg' && !String(q.key ?? '')) return `Soal ${n}: pilih kunci jawaban (klik bulatan di kiri opsi).`
      if (type === 'pg_kompleks' && strArr(q.correct).length === 0) return `Soal ${n}: centang minimal satu jawaban benar.`
    }
    if (type === 'menjodohkan') {
      const pairs = asList(q.pairs).filter(pr => String(pr.left ?? '').trim() && String(pr.right ?? '').trim())
      if (pairs.length < 2) return `Soal ${n}: isi minimal 2 pasangan (kiri dan kanan).`
    }
    if (type === 'isian' && strArr(q.keys).filter(k => k.trim()).length === 0) {
      return `Soal ${n}: isi minimal satu kunci jawaban.`
    }
    return ''
  }

  /* ------------------------------------------------------------------
     Bantuan teks: kapital otomatis untuk isian satu baris (opsi, pasangan,
     rubrik, pembahasan). Kotak teks soal sendiri berformat (RichEditor).
     ------------------------------------------------------------------ */

  /** onChange teks satu baris (opsi/pasangan/dll): kapital dirapikan, kursor dijaga. */
  function withAutoCap(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, commit: (v: string) => void) {
    const el = e.currentTarget
    const raw = el.value
    const cap = autoCapitalize(raw)
    if (cap === raw) {
      commit(raw)
      return
    }
    const start = el.selectionStart ?? cap.length
    const end = el.selectionEnd ?? start
    flushSync(() => commit(cap))
    // kapitalisasi tidak mengubah panjang teks → indeks kursor tetap sahih
    try { el.setSelectionRange(start, end) } catch { /* input tanpa seleksi */ }
  }

  // validasi FR-4.7 sebelum publish: tiap soal punya kunci & poin
  function keyProblem(q: Dict): string {
    if (!htmlToText(String(q.body ?? '')).trim()) return 'Teks soal masih kosong'
    if (q.type === 'pg' && !String(q.key ?? '')) return 'Kunci jawaban PG belum dipilih'
    if (q.type === 'pg_kompleks' && strArr(q.correct).length === 0) return 'Minimal satu kunci PG kompleks'
    if (q.type === 'menjodohkan' && asList(q.pairs).filter(p => String(p.left ?? '').trim() && String(p.right ?? '').trim()).length < 1)
      return 'Minimal satu pasangan lengkap (kiri & kanan)'
    if (q.type === 'isian' && strArr(q.keys).length === 0) return 'Minimal satu kunci isian'
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
        description: String(info.description ?? '').trim(),
        level_tag: asList(info.level_tags).map(String).filter(Boolean).join(', '),
      }
      const firstProblem = questions.map((q, i) => payloadProblem(q, i)).find(Boolean)
      if (firstProblem) throw new Error(firstProblem)
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
      toast(vars?.publish ? 'Paket soal dipublish' : 'Draft tersimpan', 'success')
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
        <PageHeader eyebrow="Bank Soal · Editor" title="Editor Paket Soal" icon={<IconBank size={18} />} />
        <Panel title="Memuat paket soal" icon={<IconClipboard size={15} />}>
          <SkeletonRows rows={5} cols={4} />
        </Panel>
      </div>
    )
  }
  if (!isNew && detail.isError) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Bank Soal · Editor" title="Editor Paket Soal" icon={<IconBank size={18} />} />
        <Panel title="Detail paket soal" icon={<IconClipboard size={15} />}>
          <ErrorBox error={detail.error} onRetry={() => detail.refetch()} />
        </Panel>
      </div>
    )
  }

  const stimulusHtmlFor = (sid: unknown) => {
    const s = stimuli.find(x => String(x.id ?? '') === String(sid ?? ''))
    if (!s) return ''
    return `<p><b>${escapeHtml(String(s.title ?? 'Wacana'))}</b></p>${renderRich(String(s.content ?? ''))}`
  }

  /* ---- ringkasan paket (turunan state, tanpa query baru) ---- */
  const problemList = questions
    .map((q, i) => ({ no: i + 1, message: keyProblem(q) }))
    .filter(p => p.message !== '')
  const readyCount = questions.length - problemList.length
  const totalPoints = questions.reduce((n, q) => n + (Number(q.points) || 1), 0)
  const infoWarning = infoProblem()

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={isNew ? 'Bank Soal · Paket Baru' : 'Bank Soal · Editor Paket'}
        title={isNew ? 'Paket Soal Baru' : 'Editor Paket Soal'}
        desc={isNew ? 'Susun soal AKM: PG, PG kompleks, menjodohkan, isian, uraian.' : `Kode ujian: ${existing?.exam_code ?? '—'}`}
        icon={<IconBank size={18} />}
        action={
          <>
            {!isNew && (
              <span className="hidden sm:inline-flex">
                <StatusBadge status={loadedStatus} />
              </span>
            )}
            <button
              type="button" className="btn-ghost hidden sm:inline-flex"
              disabled={busy || detail.isLoading} onClick={() => save.mutate({})}
            >
              {busy ? 'Menyimpan…' : 'Simpan Draft'}
            </button>
            {published ? (
              <button type="button" className="btn-ghost !text-danger hover:!border-danger-line" disabled={busy} onClick={() => void unpublish()}>
                Tarik Terbit
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={busy || detail.isLoading} onClick={() => save.mutate({ publish: true })}>
                Terbitkan
              </button>
            )}
          </>
        }
      />

      {/* ---- KPI paket ---- */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard label="Jumlah soal" value={String(questions.length)} hint="butir dalam paket" tone="primary" icon={<IconClipboard size={14} />} />
        <StatCard label="Total poin" value={String(totalPoints)} hint="bobot seluruh soal" icon={<IconCheck size={14} />} />
        <StatCard label="Wacana" value={String(stimuli.length)} hint="stimulus dibagikan" icon={<IconBook size={14} />} />
        <StatCard
          label="Siap publikasi"
          value={`${readyCount}/${questions.length}`}
          hint={problemList.length === 0 ? 'semua soal lengkap' : `${problemList.length} soal perlu dilengkapi`}
          tone={questions.length > 0 && problemList.length === 0 ? 'success' : 'warn'}
          icon={<IconWarn size={14} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* ---- kolom kiri: info paket + wacana ---- */}
        <div className="min-w-0 space-y-4">
          <Panel
            title="Info paket"
            icon={<IconClipboard size={15} />}
            footer={
              !isNew ? (
                <p className="text-[11px] text-muted">
                  Kode ujian: <b className="mono text-text">{existing?.exam_code || '—'}</b> · dipakai siswa saat masuk ujian.
                </p>
              ) : undefined
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="qs-subject">Mata pelajaran</label>
                  <input
                    id="qs-subject" className="input" required value={String(info.subject_name ?? '')}
                    onChange={e => setInfo(f => ({ ...f, subject_name: e.target.value }))} placeholder="Matematika"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="qs-title">Judul paket</label>
                  <input
                    id="qs-title" className="input" required value={String(info.title ?? '')}
                    onChange={e => setInfo(f => ({ ...f, title: e.target.value }))} placeholder="Latihan AKM Numerasi"
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="qs-desc">
                  Deskripsi <span className="font-normal text-muted">(opsional)</span>
                </label>
                <textarea
                  id="qs-desc" className="input min-h-16" value={String(info.description ?? '')}
                  onChange={e => setInfo(f => ({ ...f, description: e.target.value }))} placeholder="Untuk kelas…"
                />
              </div>
              <div>
                <span className="label">Jenjang (tag)</span>
                <div className="flex flex-wrap gap-1.5">
                  {SCHOOL_LEVELS.map(l => {
                    const active = asList(info.level_tags).map(String).includes(l)
                    return (
                      <button
                        key={l}
                        type="button"
                        aria-pressed={active}
                        className={`min-h-11 rounded-md border px-3 text-[13px] font-semibold transition-colors ${
                          active
                            ? 'border-primary-line bg-primary-soft text-primary'
                            : 'border-border bg-surface text-muted hover:border-border-strong hover:text-text'
                        }`}
                        onClick={() => setInfo(f => ({
                          ...f,
                          level_tags: active ? asList(f.level_tags).map(String).filter(t => t !== l) : [...asList(f.level_tags).map(String), l],
                        }))}
                      >
                        {l}
                      </button>
                    )
                  })}
                </div>
                <p className="hint mt-1">Tag jenjang dipakai untuk menyaring paket saat menyusun ujian.</p>
              </div>
            </div>
          </Panel>

          {/* ---- wacana/stimulus (AKM literasi) ---- */}
          <Panel
            title="Wacana / stimulus"
            icon={<IconBook size={15} />}
            action={
              !isNew ? (
                <button type="button" className="btn-ghost btn-sm" onClick={() => setStimOpen({ title: '', content: '' })}>
                  <IconPlus size={13} /> Wacana
                </button>
              ) : undefined
            }
          >
            {isNew ? (
              <Callout tone="info" title="Simpan draft dulu">
                Wacana baru bisa ditambahkan setelah paket tersimpan sebagai draft.
              </Callout>
            ) : stimuli.length === 0 ? (
              <EmptyState icon={<IconBook size={20} />} title="Belum ada wacana">
                Soal boleh berdiri sendiri — tambahkan wacana untuk soal AKM literasi.
              </EmptyState>
            ) : (
              <div className="space-y-2">
                {stimuli.map((s, i) => (
                  <div key={s.id ?? i} className="flex items-start gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-md border border-border bg-surface p-2.5 text-left transition-colors hover:border-primary-line hover:bg-primary-soft/40"
                      onClick={() => setPreview({ q: { type: 'pg', body: String(s.content ?? ''), points: 0 }, stimulusHtml: '' })}
                    >
                      <div className="truncate text-[13px] font-semibold">{String(s.title ?? 'Wacana')}</div>
                      <div
                        className="mt-0.5 line-clamp-2 text-xs text-muted"
                        dangerouslySetInnerHTML={{ __html: renderInline(String(s.content ?? '')) }}
                      />
                    </button>
                    <button
                      type="button"
                      className="btn-quiet btn-sm shrink-0 text-danger"
                      aria-label={`Hapus wacana ${String(s.title ?? '')}`}
                      onClick={() => setDeletingStimulus(s)}
                    >
                      <IconTrash size={14} /> Hapus
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ---- kolom kanan: publikasi + komposisi ---- */}
        <div className="min-w-0 space-y-4">
          <Panel title="Publikasi" icon={<IconCheck size={15} />}>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted">Kelengkapan soal</span>
                  <span className="mono font-semibold">{readyCount}/{questions.length}</span>
                </div>
                <ProgressBar
                  value={readyCount}
                  max={Math.max(1, questions.length)}
                  tone={questions.length > 0 && problemList.length === 0 ? 'success' : 'warn'}
                  label="Kelengkapan soal"
                />
                <p className="hint mt-1">Soal dihitung lengkap bila teks dan kunci jawabannya terisi.</p>
              </div>

              {infoWarning && (
                <Callout tone="warn" title="Info paket belum lengkap">{infoWarning}</Callout>
              )}

              {problemList.length > 0 ? (
                <Callout tone="warn" title={`${problemList.length} soal belum siap terbit`}>
                  <ul className="mt-1 space-y-0.5">
                    {problemList.slice(0, 3).map(p => (
                      <li key={p.no}>
                        <span className="mono font-semibold">#{p.no}</span> {p.message}
                      </li>
                    ))}
                    {problemList.length > 3 && (
                      <li className="text-muted">dan {problemList.length - 3} soal lainnya…</li>
                    )}
                  </ul>
                </Callout>
              ) : questions.length > 0 ? (
                <Callout tone="success" title="Siap diterbitkan">Semua soal sudah punya teks dan kunci jawaban.</Callout>
              ) : (
                <Callout tone="info" title="Belum ada soal">Tambahkan minimal satu soal sebelum menerbitkan paket.</Callout>
              )}

              <div className="space-y-2">
                <button
                  type="button" className="btn-ghost btn-block" disabled={busy || detail.isLoading}
                  onClick={() => save.mutate({})}
                >
                  {busy ? 'Menyimpan…' : 'Simpan Draft'}
                </button>
                {published ? (
                  <button type="button" className="btn-ghost btn-block" disabled={busy} onClick={() => void unpublish()}>
                    Tarik Terbit
                  </button>
                ) : (
                  <button
                    type="button" className="btn-primary btn-block" disabled={busy || detail.isLoading}
                    onClick={() => save.mutate({ publish: true })}
                  >
                    Publish
                  </button>
                )}
                <p className="hint">Draft bisa disimpan kapan saja; publish memerlukan kunci jawaban lengkap.</p>
              </div>
            </div>
          </Panel>

          <Panel title="Komposisi tipe soal" icon={<IconClipboard size={15} />}>
            <ul className="space-y-1.5">
              {QTYPES.map(t => {
                const n = questions.filter(q => String(q.type) === t.value).length
                return (
                  <li key={t.value} className="flex items-center justify-between gap-2">
                    <span className="chip min-w-0">
                      <t.ico size={12} /> <span className="truncate">{t.label}</span>
                    </span>
                    <span className="mono shrink-0 text-[13px] font-semibold">{n}</span>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>
      </div>

      {/* ---- daftar soal (FR-4.4) ---- */}
      <div className="space-y-3">
        <SectionHeading
          title={`Daftar soal (${questions.length})`}
          desc="Kartu ringkas gaya Google Form — klik pertanyaan untuk menulis, ganti tipe lewat dropdown, seret pegangan kiri untuk mengurutkan."
          icon={<IconClipboard size={15} />}
          action={
            <button type="button" className="btn-primary btn-sm" onClick={() => setAddOpen(true)}>
              <IconPlus size={14} /> Tambah Soal
            </button>
          }
        />

        {questions.map((question, qi) => {
          const type = String(question.type) as QType
          const TypeIco = qtypeIco(type)
          const options = asList(question.options)
          const stimulus = question.stimuli_id ? stimulusHtmlFor(question.stimuli_id) : ''
          const problem = keyProblem(question)
          const dragging = dragFrom === qi
          return (
            <section
              key={String(question._uid ?? qi)}
              aria-label={`Soal ${qi + 1} — ${qtypeLabel(type)}`}
              className={`panel ${dragging ? 'opacity-60' : ''} ${dragOver === qi && dragFrom !== null && dragFrom !== qi ? 'border-primary' : ''}`}
              onDragOver={e => {
                if (dragFrom === null) return
                e.preventDefault()
                if (dragOver !== qi) setDragOver(qi)
              }}
              onDrop={e => {
                e.preventDefault()
                if (dragFrom !== null) reorder(dragFrom, qi)
                setDragFrom(null)
                setDragOver(null)
              }}
            >
              {/* baris atas: pegangan urut, nomor, status, aksi */}
              <div className="flex items-center gap-1.5 px-2.5 pt-2 sm:px-4">
                <button
                  type="button"
                  draggable
                  onDragStart={e => {
                    setDragFrom(qi)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(qi))
                  }}
                  onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                  className="gf-grip -ml-1 rounded p-0.5"
                  title="Geser untuk mengubah urutan"
                  aria-label={`Geser soal ${qi + 1} untuk mengubah urutan`}
                >
                  <IconMenu size={15} />
                </button>
                <span className="mono text-[11px] text-muted">#{qi + 1}</span>
                <span className={`text-[11px] font-semibold ${problem ? 'text-warn' : 'text-success'}`}>
                  {problem ? 'Belum lengkap' : 'Lengkap'}
                </span>

                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button" aria-label={`Naikkan soal ${qi + 1}`} title="Naikkan soal"
                    className="btn-quiet btn-sm !px-1.5" disabled={qi === 0} onClick={() => move(qi, -1)}
                  >
                    <IconChevronUp size={14} />
                  </button>
                  <button
                    type="button" aria-label={`Turunkan soal ${qi + 1}`} title="Turunkan soal"
                    className="btn-quiet btn-sm !px-1.5" disabled={qi === questions.length - 1} onClick={() => move(qi, 1)}
                  >
                    <IconChevronDown size={14} />
                  </button>
                  <button
                    type="button" aria-label={`Duplikat soal ${qi + 1}`} title="Duplikat soal"
                    className="btn-quiet btn-sm !px-1.5" onClick={() => dupQuestion(qi)}
                  >
                    <IconCopy size={14} />
                  </button>
                  <button
                    type="button" aria-label={`Hapus soal ${qi + 1}`} title="Hapus soal"
                    className="btn-quiet btn-sm !px-1.5 text-muted hover:text-danger" onClick={() => setDeleting(question)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>

              {/* isi kartu: pertanyaan → tipe → jawaban → pengaturan */}
              <div className="px-2.5 pb-2 sm:px-4 sm:pb-3">
                {stimulus && (
                  <div
                    className="rich-text mb-2 rounded border border-border bg-canvas px-2 py-1.5 text-[12px] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: stimulus }}
                  />
                )}

                <div className="gf-q">
                  <RichEditor
                    id={`body-${qi}`}
                    value={String(question.body ?? '')}
                    onChange={v => patchQuestion(qi, { body: v })}
                    ariaLabel={`Teks soal ${qi + 1}`}
                    placeholder="Pertanyaan"
                    minHeight={40}
                  />
                </div>

                {/* tipe soal (bisa diganti) + pratinjau */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="gf-type">
                    <TypeIco size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                    <select
                      aria-label={`Tipe soal ${qi + 1}`}
                      value={type}
                      onChange={e => changeType(qi, e.target.value as QType)}
                    >
                      {QTYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <IconChevronDown size={13} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted" />
                  </span>
                  {Boolean(question.body) && (
                    <button
                      type="button" className="gf-add"
                      onClick={() => setPreview({ q: question, stimulusHtml: stimulus })}
                    >
                      <IconEye size={13} /> Pratinjau
                    </button>
                  )}
                  <button
                    type="button" className="gf-more ml-auto"
                    aria-expanded={Boolean(adv[String(question._uid ?? qi)])}
                    onClick={() => setAdv(a => ({ ...a, [String(question._uid ?? qi)]: !a[String(question._uid ?? qi)] }))}
                  >
                    Pengaturan
                    <IconChevronDown
                      size={13}
                      className={`transition-transform ${adv[String(question._uid ?? qi)] ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {/* ---------------- jawaban: pilihan ganda ---------------- */}
                {type === 'pg' && (
                  <div className="mt-1">
                    {options.map((o, oi) => {
                      const active = String(question.key ?? '') === String(o.label)
                      return (
                        <div key={String(o.label ?? oi)} className="gf-opt">
                          <input
                            type="radio" className="shrink-0" aria-label={`Jadikan ${o.label} kunci jawaban`}
                            checked={active} onChange={() => patchQuestion(qi, { key: o.label })}
                          />
                          <input
                            type="text" className="gf-line" aria-label={`Teks pilihan ${o.label}`}
                            value={String(o.text ?? '')} placeholder={`Pilihan ${oi + 1}`}
                            onChange={e => withAutoCap(e, v => patchQuestion(qi, { options: options.map((x, k) => (k === oi ? { ...x, text: v } : x)) }))}
                          />
                          <button
                            type="button" aria-label={`Hapus pilihan ${o.label}`}
                            className="gf-opt-del btn-quiet btn-sm shrink-0 !px-1 text-danger"
                            onClick={() => {
                              const rest = options.filter((_, k) => k !== oi)
                              patchQuestion(qi, {
                                options: rest.map((x, k) => ({ ...x, label: LETTERS[k] ?? x.label })),
                                key: question.key === o.label ? '' : question.key,
                              })
                            }}
                          >
                            <IconX size={14} />
                          </button>
                        </div>
                      )
                    })}
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <button
                        type="button" className="gf-add" disabled={options.length >= 5}
                        onClick={() => patchQuestion(qi, { options: [...options, { label: LETTERS[options.length] ?? '?', text: '' }] })}
                      >
                        <IconPlus size={13} /> Tambah opsi
                      </button>
                      <span className="pr-1 text-[11px] text-muted">Bulatan kiri = kunci jawaban</span>
                    </div>
                  </div>
                )}

                {/* ---------------- jawaban: PG kompleks ---------------- */}
                {type === 'pg_kompleks' && (
                  <div className="mt-1">
                    {options.map((o, oi) => {
                      const active = strArr(question.correct).includes(String(o.label))
                      return (
                        <div key={String(o.label ?? oi)} className="gf-opt">
                          <input
                            type="checkbox" className="shrink-0" aria-label={`Jadikan ${o.label} kunci jawaban`}
                            checked={active}
                            onChange={e => {
                              const cur = strArr(question.correct)
                              patchQuestion(qi, {
                                correct: e.target.checked ? [...cur, String(o.label)] : cur.filter(l => l !== o.label),
                              })
                            }}
                          />
                          <input
                            type="text" className="gf-line" aria-label={`Teks pilihan ${o.label}`}
                            value={String(o.text ?? '')} placeholder={`Pilihan ${oi + 1}`}
                            onChange={e => withAutoCap(e, v => patchQuestion(qi, { options: options.map((x, k) => (k === oi ? { ...x, text: v } : x)) }))}
                          />
                          <button
                            type="button" aria-label={`Hapus pilihan ${o.label}`}
                            className="gf-opt-del btn-quiet btn-sm shrink-0 !px-1 text-danger"
                            onClick={() => {
                              const rest = options.filter((_, k) => k !== oi)
                              patchQuestion(qi, {
                                options: rest.map((x, k) => ({ ...x, label: LETTERS[k] ?? x.label })),
                                correct: strArr(question.correct).filter(l => l !== o.label),
                              })
                            }}
                          >
                            <IconX size={14} />
                          </button>
                        </div>
                      )
                    })}
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <button
                        type="button" className="gf-add" disabled={options.length >= 5}
                        onClick={() => patchQuestion(qi, { options: [...options, { label: LETTERS[options.length] ?? '?', text: '' }] })}
                      >
                        <IconPlus size={13} /> Tambah opsi
                      </button>
                      <span className="pr-1 text-[11px] text-muted">Centang = jawaban benar</span>
                    </div>
                  </div>
                )}

                {/* ---------------- jawaban: menjodohkan ---------------- */}
                {type === 'menjodohkan' && (
                  <div className="mt-1">
                    {asList(question.pairs).map((pr, pi) => (
                      <div key={pi} className="gf-opt gap-2">
                        <input
                          className="gf-line gf-line--ruled" aria-label={`Kiri ${pi + 1}`} placeholder="Kiri"
                          value={String(pr.left ?? '')}
                          onChange={e => withAutoCap(e, v => patchQuestion(qi, { pairs: asList(question.pairs).map((x, k) => (k === pi ? { ...x, left: v } : x)) }))}
                        />
                        <span aria-hidden className="shrink-0 text-muted">↔</span>
                        <input
                          className="gf-line gf-line--ruled" aria-label={`Kanan ${pi + 1}`} placeholder="Kanan"
                          value={String(pr.right ?? '')}
                          onChange={e => withAutoCap(e, v => patchQuestion(qi, { pairs: asList(question.pairs).map((x, k) => (k === pi ? { ...x, right: v } : x)) }))}
                        />
                        <button
                          type="button" aria-label={`Hapus pasangan ${pi + 1}`}
                          className="gf-opt-del btn-quiet btn-sm shrink-0 !px-1 text-danger"
                          onClick={() => patchQuestion(qi, { pairs: asList(question.pairs).filter((_, k) => k !== pi) })}
                        >
                          <IconX size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button" className="gf-add"
                      onClick={() => patchQuestion(qi, { pairs: [...asList(question.pairs), { left: '', right: '' }] })}
                    >
                      <IconPlus size={13} /> Tambah pasangan
                    </button>
                  </div>
                )}

                {/* ---------------- jawaban: isian singkat ---------------- */}
                {type === 'isian' && (
                  <div className="mt-1">
                    {(strArr(question.keys).length ? strArr(question.keys) : ['']).map((k, ki, all) => (
                      <div key={ki} className="gf-opt">
                        <input
                          className="gf-line gf-line--ruled" aria-label={`Kunci ${ki + 1}`} placeholder={`Kunci jawaban ${ki + 1}`}
                          value={String(k ?? '')}
                          onChange={e => patchQuestion(qi, { keys: all.map((x, j) => (j === ki ? e.target.value : x)) })}
                        />
                        <button
                          type="button" aria-label={`Hapus kunci ${ki + 1}`}
                          className="gf-opt-del btn-quiet btn-sm shrink-0 !px-1 text-danger"
                          disabled={all.length <= 1}
                          onClick={() => patchQuestion(qi, { keys: all.filter((_, j) => j !== ki) })}
                        >
                          <IconX size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button" className="gf-add"
                      onClick={() => patchQuestion(qi, { keys: [...(strArr(question.keys).length ? strArr(question.keys) : ['']), ''] })}
                    >
                      <IconPlus size={13} /> Tambah kunci
                    </button>
                  </div>
                )}

                {/* ---------------- jawaban: uraian ---------------- */}
                {type === 'uraian' && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                    Jawaban uraian dinilai manual oleh guru. Rubrik penilaian ada di pengaturan lanjutan.
                  </p>
                )}

                {/* pengaturan lanjutan (tertutup default supaya kartu ringkas) */}
                {Boolean(adv[String(question._uid ?? qi)]) && (
                  <div className="mt-2 grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-2">
                      <div>
                        <label className="label" htmlFor={`pts-${qi}`}>Poin soal</label>
                        <input
                          id={`pts-${qi}`} type="number" min={1} max={100} className="input mono !min-h-9"
                          value={String(question.points ?? 1)}
                          onChange={e => patchQuestion(qi, { points: Number(e.target.value) || 1 })}
                        />
                      </div>
                      {(type === 'pg' || type === 'pg_kompleks' || type === 'isian' || type === 'uraian') && (
                        <div>
                          <label className="label" htmlFor={`expl-${qi}`}>Pembahasan (opsional)</label>
                          <input
                            id={`expl-${qi}`} className="input !min-h-9" value={String(question.explanation ?? '')}
                            onChange={e => withAutoCap(e, v => patchQuestion(qi, { explanation: v }))} placeholder="Penjelasan singkat…"
                          />
                        </div>
                      )}
                      {(type === 'pg' || type === 'pg_kompleks') && (
                        <label className="flex min-h-9 items-center gap-2 text-[13px]">
                          <input
                            type="checkbox" checked={Boolean(question.shuffle_options)}
                            onChange={e => patchQuestion(qi, { shuffle_options: e.target.checked })}
                          />
                          Acak urutan pilihan
                        </label>
                      )}
                      {(type === 'pg_kompleks' || type === 'menjodohkan') && (
                        <div>
                          <label className="label" htmlFor={`score-${qi}`}>Skoring</label>
                          <select
                            id={`score-${qi}`} className="input !min-h-9" value={String(question.scoring ?? 'all')}
                            onChange={e => patchQuestion(qi, { scoring: e.target.value })}
                          >
                            <option value="all">{type === 'menjodohkan' ? 'Semua pasangan benar' : 'Semua-atau-tidak'}</option>
                            <option value="partial">{type === 'menjodohkan' ? 'Parsial per pasangan' : 'Parsial per opsi'}</option>
                          </select>
                        </div>
                      )}
                      {type === 'uraian' && (
                        <div className="sm:col-span-2">
                          <label className="label" htmlFor={`rubric-${qi}`}>Rubrik penilaian uraian</label>
                          <textarea
                            id={`rubric-${qi}`} className="input min-h-16" placeholder="Kriteria jawaban lengkap…"
                            value={String(question.rubric ?? '')}
                            onChange={e => withAutoCap(e, v => patchQuestion(qi, { rubric: v }))}
                          />
                        </div>
                      )}
                  </div>
                )}
              </div>
            </section>
          )
        })}

        {questions.length === 0 ? (
          <div className="panel">
            <EmptyState icon={<IconClipboard size={20} />} title="Belum ada soal">
              {'Klik "Tambah Soal" — pilih salah satu dari 5 tipe soal AKM.'}
            </EmptyState>
          </div>
        ) : (
          <button type="button" className="btn-ghost btn-block" onClick={() => setAddOpen(true)}>
            <IconPlus size={15} /> Tambah soal di akhir daftar
          </button>
        )}
      </div>

      {/* modal tambah soal (pilih tipe) */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Tambah soal — pilih tipe">
        <div className="grid grid-cols-1 gap-2">
          {QTYPES.map(t => (
            <button
              key={t.value} type="button"
              className="flex min-h-11 items-center gap-2.5 rounded-md border border-border bg-surface px-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary-soft"
              onClick={() => { setAddOpen(false); setQuestions(qs => [...qs, newQuestion(t.value)]) }}
            >
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-canvas text-primary">
                <t.ico size={15} />
              </span>
              <span className="font-semibold">{t.label}</span>
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
        <p className="text-sm text-muted">Wacana dipakai bersama beberapa soal (khas AKM literasi). Bisa tebal/miring/daftar seperti teks soal.</p>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="stim-t">Judul wacana</label>
            <input
              id="stim-t" className="input" value={stimOpen?.title ?? ''}
              onChange={e => setStimOpen(s => (s ? { ...s, title: e.target.value } : s))}
            />
          </div>
          <div>
            <label className="label" htmlFor="stim-c">Isi wacana</label>
            <RichEditor
              id="stim-c"
              value={stimOpen?.content ?? ''}
              onChange={v => setStimOpen(s => (s ? { ...s, content: v } : s))}
              ariaLabel="Isi wacana"
              placeholder="Tulis wacana di sini…"
              minHeight={132}
            />
            <p className="hint mt-1">
              Bisa tebal/miring/daftar seperti teks soal. Enter di baris "1." atau "-" jadi daftar otomatis.
            </p>
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
