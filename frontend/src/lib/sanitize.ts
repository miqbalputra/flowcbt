// sanitize — TEKS SOAL = TEKS BIASA (tanpa kode HTML).
//
// Keputusan produk: guru TIDAK menulis tag HTML. Semua teks (soal, wacana,
// opsi, pasangan menjodohkan) disimpan apa adanya sebagai teks biasa; FE yang
// mengubahnya menjadi HTML aman saat render:
//
//   • semua teks di-escape lebih dulu → tidak ada tag kiriman pengguna yang
//     lolos, jadi XSS mustahil (PRD §12 tetap terpenuhi, lebih ketat dari
//     whitelist tag versi lama);
//   • DAFTAR OTOMATIS: baris "1. …"/"1) …" → <ol>, "a. …" → <ol type="a">,
//     "- …"/"• …" → <ul>; baris menjorok menyambung butir terakhir;
//   • baris kosong memisahkan paragraf, baris lain disambung dengan <br>;
//   • HURUF KAPITAL OTOMATIS di awal teks, awal tiap baris, dan setelah
//     ".", "!", "?" (tidak menyentuh angka: "5 km" tetap kecil).
//
// Data lama dari masa "boleh HTML sederhana" tidak rusak: htmlToText()
// mengubah <p>/<br>/<li> dsb. menjadi teks biasa lebih dulu.

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
}

/** Escape karakter HTML — satu-satunya jalan keluar teks pengguna ke DOM. */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Ubah entitas HTML (&lt; &amp; &#8217; …) menjadi karakter aslinya (sekali jalan). */
export function decodeEntities(s: string): string {
  return String(s ?? '').replace(/&(#\d{1,6}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (all, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X'
      const n = hex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
    }
    const v = NAMED_ENTITIES[code.toLowerCase()]
    return v === undefined ? all : v
  })
}

/** Teks lama masih memakai HTML sederhana? (hanya untuk kompatibilitas data lama) */
export function looksLikeHtml(s: string): boolean {
  return /<\/?(?:p|br|div|ul|ol|li|b|i|u|em|strong|sub|sup|code|table|thead|tbody|tr|td|th|img|h[1-6])\b[^>]*>/i.test(String(s ?? ''))
}

/**
 * HTML sederhana (data lama / impor CSV) → teks biasa.
 * Aman untuk teks biasa juga: hanya meng-escape-balik entitas.
 */
export function htmlToText(raw: string): string {
  let s = String(raw ?? '')
  if (!s) return ''
  if (looksLikeHtml(s)) {
    s = s
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*(?:hr|img)\b[^>]*>/gi, '')
      .replace(/<\s*li\b[^>]*>/gi, '\n- ') // butir HTML lama → penanda teks biasa
      .replace(/<\s*\/\s*(?:p|div|tr|h[1-6]|blockquote|table|ul|ol)\s*>/gi, '\n')
      .replace(/<\s*(?:p|div|h[1-6]|blockquote|table|ul|ol)\b[^>]*>/gi, '\n')
      .replace(/<\s*\/\s*(?:td|th)\s*>/gi, ' | ') // tabel lama → kolom dipisah " | "
      .replace(/<[^>]*>/g, '') // sisa tag dibuang
    s = decodeEntities(s)
  } else {
    s = decodeEntities(s)
  }
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '') // spasi di ujung baris
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/, '')
}

/**
 * Huruf kapital otomatis: awal teks, awal tiap baris, setelah ".", "!", "?"
 * yang diikuti spasi/baris baru. Penanda daftar ("1. ", "- ") dilewati,
 * dan baris yang dimulai angka dibiarkan ("5 km" tidak jadi "5 Km").
 * Panjang teks TIDAK berubah → posisi kursor aman.
 */
export function autoCapitalize(input: string): string {
  const s = String(input ?? '')
  if (!s) return ''
  let out = ''
  let atStart = true // sedang di posisi awal kalimat/baris?
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\n') {
      out += ch
      atStart = true
      continue
    }
    if (atStart) {
      // spasi/tab di awal baris: tetap menunggu huruf pertama
      if (ch === ' ' || ch === '\t') {
        out += ch
        continue
      }
      // penanda daftar "1. ", "2) ", "a. ", "ii. ", "- ", "• " dilewati utuh
      // (huruf penanda dibiarkan apa adanya, kata sesudahnya tetap dikapitalkan)
      const marker = /^(?:[A-Za-z][.)]|[ivxlc]{2,6}[.)]|\d{1,3}[.)]|[-*•·])[ \t]+/.exec(s.slice(i))
      if (marker) {
        out += marker[0]
        i += marker[0].length - 1
        continue
      }
      if (ch >= 'a' && ch <= 'z') {
        out += ch.toUpperCase()
        atStart = false
        continue
      }
      if (ch >= 'A' && ch <= 'Z') {
        out += ch
        atStart = false
        continue
      }
      if (ch >= '0' && ch <= '9') {
        // baris dimulai angka → jangan kapitalkan kata berikutnya
        out += ch
        atStart = false
        continue
      }
      // tanda kutip/kurung: tetap menunggu huruf pertama
      out += ch
      continue
    }
    out += ch
    if ((ch === '.' || ch === '!' || ch === '?') && /[ \t\n]/.test(s[i + 1] ?? '')) atStart = true
  }
  return out
}

/** Satu baris butir daftar: [indent, nomor, butir, huruf, spasi, isi] */
const LIST_ITEM_RE = /^([ \t]*)(?:(\d{1,3})[.)]|([-*•·])|([A-Za-z])[.)])([ \t]+)(.*)$/
const LETTER_ITEM_RE = /^[ \t]*[A-Za-z][.)][ \t]+/

type Block =
  | { t: 'p'; lines: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; start: number; style: '1' | 'a' | 'A'; items: string[] }

/** Pecah teks biasa menjadi blok paragraf + daftar (angka, butir, huruf). */
export function parseBlocks(text: string): Block[] {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] | null = null
  let list: Block | null = null

  const flushPara = () => {
    if (para && para.length) blocks.push({ t: 'p', lines: para })
    para = null
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[ \t]+$/, '')

    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }

    const m = LIST_ITEM_RE.exec(line)
    const alpha = m?.[4] ?? ''
    // daftar huruf hanya dianggap daftar bila baris berikutnya juga butir huruf
    // (atau daftar huruf sedang terbuka — butir terakhir tidak putus)
    const letterList = Boolean(alpha) && (
      LETTER_ITEM_RE.test(lines[i + 1] ?? '') ||
      Boolean(list && list.t === 'ol' && list.style !== '1')
    )

    if (m && (m[2] || m[3] || letterList)) {
      const isNumber = Boolean(m[2])
      const isBullet = Boolean(m[3])
      const style: '1' | 'a' | 'A' = isNumber ? '1' : alpha === alpha.toUpperCase() ? 'A' : 'a'
      const start = isNumber ? Number(m[2]) : alpha.toLowerCase().charCodeAt(0) - 96
      const item = m[6]
      if (list && !isBullet && list.t === 'ol' && list.style === style) {
        list.items.push(item)
      } else if (list && isBullet && list.t === 'ul') {
        list.items.push(item)
      } else {
        flushPara()
        flushList()
        list = isBullet
          ? { t: 'ul', items: [item] }
          : { t: 'ol', start: start || 1, style, items: [item] }
      }
      continue
    }

    // baris menjorok saat daftar terbuka → sambungan butir terakhir
    if (list && /^[ \t]/.test(line)) {
      const idx = list.items.length - 1
      list.items[idx] = `${list.items[idx]}\n${line.trim()}`
      continue
    }

    flushList()
    const plain = line.replace(/^[ \t]+/, '')
    if (para) para.push(plain)
    else para = [plain]
  }

  flushPara()
  flushList()
  return blocks
}

function renderItem(s: string): string {
  return `<li>${escapeHtml(s).replace(/\n/g, '<br>')}</li>`
}

function renderBlocks(blocks: Block[]): string {
  let html = ''
  for (const b of blocks) {
    if (b.t === 'p') {
      html += `<p>${b.lines.map(escapeHtml).join('<br>')}</p>`
    } else if (b.t === 'ul') {
      html += `<ul>${b.items.map(renderItem).join('')}</ul>`
    } else {
      const start = b.start !== 1 ? ` start="${b.start}"` : ''
      // `type` untuk fallback bawaan browser; `data-marker` untuk CSS kita
      // (atribut type cocok case-insensitive, jadi a/A tak bisa dibedakan).
      const type = b.style !== '1' ? ` type="${b.style}" data-marker="${b.style}"` : ''
      html += `<ol${type}${start}>${b.items.map(renderItem).join('')}</ol>`
    }
  }
  return html
}

/**
 * Teks biasa → HTML aman (paragraf + daftar otomatis + kapital otomatis).
 * Dipakai untuk badan soal dan isi wacana.
 */
export function renderText(raw: string): string {
  const text = autoCapitalize(htmlToText(raw))
  if (!text.trim()) return ''
  return renderBlocks(parseBlocks(text))
}

/** Satu baris pendek (opsi jawaban, kolom menjodohkan) → HTML aman tanpa blok. */
export function renderInline(raw: string): string {
  const text = autoCapitalize(htmlToText(raw)).replace(/\s*\n+\s*/g, ' ').trim()
  return escapeHtml(text)
}
