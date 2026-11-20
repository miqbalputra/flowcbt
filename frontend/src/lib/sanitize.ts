// sanitize — escape HTML mentah lalu kembalikan tag yang diizinkan saja
// (PRD §12: sanitasi rich text untuk mencegah XSS).
//
// Strategi: escape SEMUA karakter < > & terlebih dahulu, lalu kembalikan
// hanya tag allowlist TANPA atribut (atribut = jalur XSS: onerror, style,
// javascript:, srcset…). Tag liar di luar daftar tetap ter-escape sehingga
// tampil sebagai teks, tidak pernah dieksekusi.
export const HTML_TAGS = ['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'sub', 'sup', 'code'] as const

export function renderSimpleHtml(raw: string): string {
  let s = (raw || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  for (const t of HTML_TAGS) {
    s = s.replace(new RegExp(`&lt;(/?)${t}&gt;`, 'gi'), `<$1${t}>`)
  }
  return s
}
