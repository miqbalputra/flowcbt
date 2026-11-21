// RichEditor — kotak teks soal bergaya Google Form (WYSIWYG ringan, tanpa dependensi).
//
// Guru tidak pernah melihat tag: tombol B / I / U / daftar / pangkat bekerja
// pada teks yang dipilih, persis seperti Google Form. Isi kotak disimpan
// sebagai HTML aman (allowlist di `lib/sanitize`).
//
// Keputusan teknis:
//  • contentEditable "tidak dikontrol" — innerHTML hanya ditulis ulang dari
//    luar saat soal lain dimuat, supaya kursor tidak melompat tiap ketikan.
//  • Format teks memakai document.execCommand dengan styleWithCSS=false agar
//    menghasilkan <b>/<i>/<u>, bukan <span style>.
//  • DAFTAR dibuat sendiri lewat DOM, bukan execCommand: di Chromium
//    insertOrderedList menyisipkan <ol> DI DALAM <p> (HTML tidak sah) —
//    ditemukan saat uji Playwright.
//  • Tempel (paste) selalu teks biasa → kapital otomatis + daftar otomatis,
//    jadi konten dari Word/Google Docs tidak membawa gaya asing.
//  • Enter pada baris yang diawali "1. " atau "- " langsung jadi daftar
//    sungguhan; butir berikutnya mengalir sendiri (perilaku bawaan browser).
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ClipboardEvent, type FormEvent, type KeyboardEvent,
} from 'react'
import { autoCapitalize, renderText, sanitizeRich } from '@/lib/sanitize'
import { IconEraser } from '@/components/icons'

type Cmd = 'bold' | 'italic' | 'underline' | 'superscript' | 'subscript'
type ListKind = 'ol' | 'ul'

const TEXT_TOOLS: Array<{ cmd: Cmd; glyph: string; label: string; hint: string; cls?: string }> = [
  { cmd: 'bold', glyph: 'B', label: 'Tebal', hint: 'Tebal (Ctrl+B)', cls: 'font-bold' },
  { cmd: 'italic', glyph: 'I', label: 'Miring', hint: 'Miring (Ctrl+I)', cls: 'font-serif italic' },
  { cmd: 'underline', glyph: 'U', label: 'Garis bawah', hint: 'Garis bawah (Ctrl+U)', cls: 'underline' },
]

const LIST_TOOLS: Array<{ kind: ListKind; glyph: string; label: string; hint: string }> = [
  { kind: 'ul', glyph: '•', label: 'Daftar butir', hint: 'Daftar butir' },
  { kind: 'ol', glyph: '1.', label: 'Daftar bernomor', hint: 'Daftar bernomor' },
]

const SCRIPT_TOOLS: Array<{ cmd: Cmd; glyph: string; label: string; hint: string }> = [
  { cmd: 'superscript', glyph: 'x²', label: 'Pangkat atas', hint: 'Pangkat atas (mis. m²)' },
  { cmd: 'subscript', glyph: 'x₂', label: 'Pangkat bawah', hint: 'Pangkat bawah (mis. H₂O)' },
]

const EMPTY_BLOCK = '<p><br></p>'

/* ----------------------------- bantuan DOM ----------------------------- */

/** Elemen blok terdekat (p/div/li) dari posisi kursor, dibatasi di dalam root. */
function blockOf(node: Node | null, root: HTMLElement): HTMLElement {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null)
  while (el && el !== root) {
    const tag = el.tagName
    if (tag === 'P' || tag === 'DIV' || tag === 'LI' || tag === 'BLOCKQUOTE') return el as HTMLElement
    el = el.parentElement
  }
  return root
}

function closestLi(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  return (el?.closest('li') as HTMLElement | null) ?? null
}

/** Buang n karakter pertama dari teks blok (penanda daftar "1. " / "- "). */
function stripPrefix(block: HTMLElement, n: number) {
  let left = n
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const t of nodes) {
    if (left <= 0) break
    const take = Math.min(left, t.data.length)
    t.data = t.data.slice(take)
    left -= take
  }
}

function caretTo(node: Node, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  r.setStart(node, offset)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** Sisipkan teks biasa di kursor (tanpa execCommand → tidak memicu autocorrect daftar). */
function insertTextAtCaret(text: string) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = range.startContainer
  const offset = range.startOffset
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node as Text
    t.insertData(offset, text)
    caretTo(t, offset + text.length)
    return
  }
  const t = document.createTextNode(text)
  range.insertNode(t)
  caretTo(t, text.length)
}

function caretToEnd(node: Node) {
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  r.selectNodeContents(node)
  r.collapse(false)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** Blok tingkat atas yang tersentuh seleksi (atau blok tempat kursor). */
function blocksInRange(root: HTMLElement, range: Range): HTMLElement[] {
  return Array.from(root.children).filter(
    c => c.nodeType === 1 && range.intersectsNode(c),
  ) as HTMLElement[]
}

/**
 * Ubah blok satu-baris jadi daftar <ol>/<ul> berisi satu butir.
 * Menggantikan posisi blok; isi blok (termasuk tebal/miring) dipindah apa adanya.
 */
function blockToList(block: HTMLElement, kind: ListKind): HTMLElement {
  const list = document.createElement(kind)
  const li = document.createElement('li')
  while (block.firstChild) li.appendChild(block.firstChild)
  if (!li.firstChild) li.appendChild(document.createElement('br'))
  list.appendChild(li)
  block.replaceWith(list)
  return list
}

/** Baris kursor diawali penanda daftar teks ("1. ", "- ")? */
const MARKER_RE = /^([ \t\u00a0]*)(?:(\d{1,3})[.)]|([-*•·]))([ \t\u00a0]+)(.*)$/

/**
 * Panjang penanda di awal baris ("1. " / "- ") — dihitung dari sisa teks
 * (grup 5), bukan m[0].length yang mencakup seluruh baris.
 */
function markerLen(m: RegExpExecArray): number {
  return m[0].length - (m[5] ?? '').length
}

/**
 * Di dalam <li>: buang penanda teks yang meniru nomor butir (mis. guru
 * mengetik ulang "1. abc" di butir pertama, atau sisa butir kosong setelah
 * Ctrl+A + Delete). Penanda hanya dibuang bila cocok dengan posisi butir agar
 * angka sah seperti "1998. Indonesia merdeka" tidak ikut terpotong.
 */
function stripMarkerInLi(li: HTMLElement): boolean {
  const m = MARKER_RE.exec(li.textContent ?? '')
  if (!m || !(m[5] ?? '').trim()) return false
  const isBullet = Boolean(m[3])
  const siblings = Array.from(li.parentElement?.children ?? [])
  const ordinal = siblings.indexOf(li) + 1
  if (!isBullet && String(Number(m[2])) !== String(ordinal)) return false
  const wasAtEnd = caretAtEndOf(li)
  stripPrefix(li, markerLen(m))
  if (wasAtEnd) caretToEnd(li)
  return true
}

/**
 * Butir daftar yang kosong (hanya <br> pengisi dari browser). Enter di butir
 * seperti ini harus keluar dari daftar seperti Google Docs, bukan menambah
 * butir baru tanpa isi.
 */
function isBlankLi(li: HTMLElement): boolean {
  return !(li.textContent ?? '').trim() && !li.querySelector('b,i,u,s,sup,sub,img')
}

/** Hapus butir kosong; bila butir terakhir, keluar dari daftar ke paragraf baru. */
function leaveEmptyLi(li: HTMLElement): void {
  const list = li.parentElement as HTMLElement | null
  if (!list) return
  const nextItem = li.nextElementSibling as HTMLElement | null
  list.removeChild(li)
  if (nextItem) {
    caretTo(nextItem, 0)
  } else {
    const p = document.createElement('p')
    p.appendChild(document.createElement('br'))
    list.after(p)
    if (!list.children.length) list.remove()
    caretTo(p, 0)
  }
}

/**
 * Chromium mewarisi format (tebal/miring/pangkat) ke baris baru. Untuk paragraf
 * atau butir yang masih kosong setelah Enter, buang pembungkus itu supaya guru
 * mulai baris baru tanpa format — seperti Google Docs/Forms.
 */
function resetBlankBlock(root: HTMLElement): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return
  if (document.activeElement !== root) return
  const block = blockOf(sel.anchorNode, root)
  if (block === root) return
  if ((block.textContent ?? '').trim()) return
  if (block.querySelector('img')) return
  if (!block.querySelector('b,i,u,s,sup,sub,span,font')) return
  block.innerHTML = '<br>'
  caretTo(block, 0)
  clearPendingStyle()
}

/**
 * Chromium menyimpan "typing style" walau DOM sudah diganti: setelah berada di
 * dalam <sup>/<b>, ketikan berikutnya bisa mewarisi format itu. Matikan dengan
 * men-toggle balik setiap perintah yang masih aktif di kursor.
 */
function clearPendingStyle(): void {
  const cmds = ['superscript', 'subscript', 'bold', 'italic', 'underline', 'strikeThrough'] as const
  for (const cmd of cmds) {
    try {
      if (document.queryCommandState(cmd)) document.execCommand(cmd)
    } catch { /* browser tanpa execCommand: abaikan */ }
  }
}

/**
 * Sisipkan HTML berblok (paragraf/daftar) setelah blok tempat kursor, sisa teks
 * di kanan kursor dipindah ke paragraf baru. Hasil selalu HTML sah.
 */
function insertBlocksAfterCaret(root: HTMLElement, html: string): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  const block = blockOf(range.startContainer, root)
  let anchor: Element = block === root ? root.lastElementChild ?? root : block
  if (block !== root) {
    const tail = document.createRange()
    tail.setStart(range.startContainer, range.startOffset)
    tail.setEndAfter(block.lastChild ?? block)
    const rest = tail.extractContents()
    if ((rest.textContent ?? '').trim()) {
      const p = document.createElement('p')
      p.appendChild(rest)
      block.after(p)
      anchor = p
    }
  } else {
    // kursor langsung di akar editor: sisipkan di ujung
    const p = document.createElement('p')
    p.appendChild(document.createElement('br'))
    root.appendChild(p)
    anchor = p
  }
  const holder = document.createElement('div')
  holder.innerHTML = sanitizeRich(html)
  let last: Element | null = null
  for (const node of Array.from(holder.childNodes)) {
    anchor.after(node)
    if (node.nodeType === 1) { anchor = node as Element; last = node as Element }
  }
  if (last) caretToEnd(last)
}

/** Kursor (collapse) berada di ujung isi elemen? */
function caretAtEndOf(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return false
  const caret = document.createRange()
  caret.setStart(sel.anchorNode, sel.anchorOffset)
  caret.collapse(true)
  const tail = document.createRange()
  tail.selectNodeContents(el)
  tail.setStart(caret.startContainer, caret.startOffset)
  return tail.toString() === ''
}

/** Teks sebelum kursor di dalam blok tempat kursor. */
function textBeforeCaret(root: HTMLElement): string | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null
  const block = blockOf(sel.anchorNode, root)
  const r = document.createRange()
  r.selectNodeContents(block)
  try {
    r.setEnd(sel.anchorNode, sel.anchorOffset)
  } catch {
    return block.textContent ?? ''
  }
  return r.toString()
}

/* ------------------------------ komponen ------------------------------ */

export function RichEditor({
  id,
  value,
  onChange,
  placeholder = 'Ketik teks…',
  ariaLabel = 'Teks soal',
  minHeight = 104,
  disabled,
}: {
  id?: string
  value: string
  onChange: (html: string) => void
  placeholder?: string
  ariaLabel?: string
  minHeight?: number
  disabled?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const lastEmitted = useRef<string>('')
  const initialised = useRef(false)
  const [pressed, setPressed] = useState<Partial<Record<Cmd | ListKind, boolean>>>({})
  const [isEmpty, setIsEmpty] = useState(!value)

  // hasil <b>/<i>/<u> (bukan <span style>), paragraf = <p>
  useLayoutEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, 'false')
      document.execCommand('defaultParagraphSeparator', false, 'p')
    } catch { /* browser tanpa execCommand: biarkan bawaan */ }
  }, [])

  // muat isi dari luar (ganti soal / reset) — jangan saat kotak sedang difokuskan
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!initialised.current) {
      initialised.current = true
      el.innerHTML = value || EMPTY_BLOCK
      lastEmitted.current = value
      setIsEmpty(!(el.textContent ?? '').trim())
      return
    }
    if (value === lastEmitted.current) return
    if (value === sanitizeRich(el.innerHTML) || (!value && el.textContent === '')) {
      lastEmitted.current = value
      return
    }
    if (document.activeElement === el && el.textContent !== '') return
    el.innerHTML = value || EMPTY_BLOCK
    lastEmitted.current = value
    setIsEmpty(!(el.textContent ?? '').trim())
  }, [value])

  const emit = useCallback(() => {
    const el = ref.current
    if (!el) return
    const kosong = !(el.textContent ?? '').trim()
    setIsEmpty(kosong)
    const html = kosong ? '' : sanitizeRich(el.innerHTML)
    if (html === lastEmitted.current) return
    lastEmitted.current = html
    onChange(html)
  }, [onChange])

  /**
   * Ctrl+A + Delete di dalam daftar menyisakan <ol><li><br></li></ol> yang
   * membuat ketikan berikutnya jadi butir daftar. Bila kotak benar-benar
   * kosong, kembalikan ke satu paragraf bersih.
   */
  const onInput = useCallback(() => {
    const el = ref.current
    if (el && !(el.textContent ?? '').trim() && el.querySelector('ul,ol,table')) {
      el.innerHTML = EMPTY_BLOCK
      const p = el.firstElementChild
      caretTo(p ?? el, 0)
      clearPendingStyle()
    }
    emit()
  }, [emit])


  // status tombol mengikuti posisi kursor
  useEffect(() => {
    const sync = () => {
      const el = ref.current
      if (!el || document.activeElement !== el) return
      const next: Partial<Record<Cmd | ListKind, boolean>> = {}
      for (const t of [...TEXT_TOOLS, ...SCRIPT_TOOLS]) {
        try {
          next[t.cmd] = document.queryCommandState(t.cmd)
        } catch {
          next[t.cmd] = false
        }
      }
      try {
        next.ol = document.queryCommandState('insertOrderedList')
        next.ul = document.queryCommandState('insertUnorderedList')
      } catch {
        next.ol = false
        next.ul = false
      }
      setPressed(next)
    }
    document.addEventListener('selectionchange', sync)
    return () => document.removeEventListener('selectionchange', sync)
  }, [])

  function run(cmd: Cmd) {
    const el = ref.current
    if (!el || disabled) return
    el.focus()
    try {
      document.execCommand(cmd)
    } catch { /* abaikan */ }
    emit()
  }

  /** Tombol daftar: di dalam daftar → ubah/lepas; di luar → bentuk daftar baru. */
  function runList(kind: ListKind) {
    const el = ref.current
    if (!el || disabled) return
    el.focus()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && closestLi(sel.anchorNode)) {
      try {
        document.execCommand(kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList')
      } catch { /* abaikan */ }
      emit()
      return
    }
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    if (!range) return
    const blocks = blocksInRange(el, range).filter(b => b.tagName === 'P' || b.tagName === 'DIV')
    if (blocks.length === 0) return

    const list = document.createElement(kind)
    blocks.forEach((b, i) => {
      const li = document.createElement('li')
      while (b.firstChild) li.appendChild(b.firstChild)
      if (!li.firstChild) li.appendChild(document.createElement('br'))
      list.appendChild(li)
      if (i > 0) b.remove()
    })
    blocks[0].replaceWith(list)
    const last = list.lastElementChild
    if (last) caretToEnd(last)
    emit()
  }

  function clearFormat() {
    const el = ref.current
    if (!el || disabled) return
    el.focus()
    try {
      document.execCommand('removeFormat')
      if (document.queryCommandState('insertUnorderedList')) document.execCommand('insertUnorderedList')
      if (document.queryCommandState('insertOrderedList')) document.execCommand('insertOrderedList')
    } catch { /* abaikan */ }
    emit()
  }

  /** Enter pada baris "1. …" / "- …" → jadikan daftar sungguhan + butir berikutnya. */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return
    const el = ref.current
    if (!el) return
    // baris baru tidak mewarisi format baris sebelumnya (lihat resetBlankBlock);
    // setTimeout agar aksi bawaan Enter (membuat <p>/<li> baru) sudah selesai.
    setTimeout(() => resetBlankBlock(el), 0)
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return
    const inLi = closestLi(sel.anchorNode)
    if (inLi) {
      // sudah di daftar: bawaan browser melanjutkan nomor; buang dulu penanda
      // teks yang meniru nomor butir supaya tidak tampil ganda ("1. 1. abc").
      if (stripMarkerInLi(inLi)) emit()
      if (isBlankLi(inLi)) {
        e.preventDefault()
        leaveEmptyLi(inLi)
        emit()
      }
      return
    }

    const block = blockOf(sel.anchorNode, el)
    if (block === el) return
    const m = MARKER_RE.exec(block.textContent ?? '')
    if (!m || !(m[5] ?? '').trim()) return

    e.preventDefault()
    stripPrefix(block, markerLen(m))
    const list = blockToList(block, m[2] ? 'ol' : 'ul')
    const next = document.createElement('li')
    next.appendChild(document.createElement('br'))
    list.appendChild(next)
    caretTo(next, 0)
    emit()
  }

  /** Kapital otomatis saat mengetik: awal baris & setelah ". " "! " "? ". */
  function onBeforeInput(e: FormEvent<HTMLDivElement>) {
    if (disabled) return
    const ev = e.nativeEvent as InputEvent
    // React memetakan beforeinput lewat polyfill textInput → inputType kadang
    // undefined; cukup saring tipe lain bila ada, lalu andalkan data 1 huruf.
    if ((ev.inputType && ev.inputType !== 'insertText') || !ev.data || ev.isComposing) return
    if (!/^[a-z]$/.test(ev.data)) return
    const el = ref.current
    if (!el) return
    const before = textBeforeCaret(el)
    if (before === null) return
    // uji memakai mesin kapital yang sama dengan render: "…<ketikan>" jadi kapital?
    const probe = autoCapitalize(`${before}a`)
    if (probe.slice(-1) !== 'A') return
    ev.preventDefault()
    insertTextAtCaret(ev.data.toUpperCase())
    emit()
  }

  /**
   * Tempel selalu teks biasa → kapital + daftar otomatis, gaya asing dibuang.
   * Satu baris disisipkan inline; banyak baris jadi blok baru setelah paragraf
   * kursor (insertHTML biasa menaruh <ol>/<p> di dalam <p> → HTML tidak sah).
   */
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (disabled) return
    const el = ref.current
    if (!el) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text.trim()) return
    const html = renderText(text)
    if (!/\n/.test(text.trim())) {
      try {
        document.execCommand('insertHTML', false, html)
      } catch {
        document.execCommand('insertText', false, text)
      }
      emit()
      return
    }
    insertBlocksAfterCaret(el, html)
    emit()
  }

  const btn = (onPick: () => void, glyph: string, label: string, hint: string, isOn: boolean, cls = '') => (
    <button
      key={label}
      type="button"
      className={`rt-btn ${cls}`}
      title={hint}
      aria-label={label}
      aria-pressed={isOn}
      disabled={disabled}
      onMouseDown={e => {
        e.preventDefault() // jaga seleksi di kotak teks
        onPick()
      }}
    >
      {glyph}
    </button>
  )

  return (
    <div className="rt">
      <div className="rt-toolbar" role="toolbar" aria-label={`Format ${ariaLabel}`}>
        {TEXT_TOOLS.map(t => btn(() => run(t.cmd), t.glyph, t.label, t.hint, Boolean(pressed[t.cmd]), t.cls))}
        <span className="rt-sep" aria-hidden />
        {LIST_TOOLS.map(t => btn(() => runList(t.kind), t.glyph, t.label, t.hint, Boolean(pressed[t.kind])))}
        <span className="rt-sep" aria-hidden />
        {SCRIPT_TOOLS.map(t => btn(() => run(t.cmd), t.glyph, t.label, t.hint, Boolean(pressed[t.cmd])))}
        <span className="rt-sep" aria-hidden />
        <button
          type="button"
          className="rt-btn"
          title="Hapus format"
          aria-label="Hapus format"
          disabled={disabled}
          onMouseDown={e => {
            e.preventDefault()
            clearFormat()
          }}
        >
          <IconEraser size={14} />
        </button>
      </div>
      <div
        id={id}
        ref={ref}
        className="rt-editor rich-text"
        style={{ minHeight }}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-empty={isEmpty ? 'true' : 'false'}
        data-placeholder={placeholder}
        onInput={onInput}
        onBeforeInput={onBeforeInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={emit}
        onDrop={e => e.preventDefault()}
      />
    </div>
  )
}
