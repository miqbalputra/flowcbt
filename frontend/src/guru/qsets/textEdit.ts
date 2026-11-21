// textEdit — bantuan mengetik TEKS BIASA di kotak teks soal (tanpa HTML).
//
// Fungsi murni (string masuk → string + posisi kursor keluar) supaya perilakunya
// bisa diuji tanpa DOM. Dipakai editor paket soal:
//   • continueList()     — Enter di butir daftar melanjutkan nomor/butir berikutnya,
//                          Enter pada butir kosong mengakhiri daftar;
//   • toggleListMarker() — tombol "1." / "•" memasang atau melepas penanda daftar
//                          di awal baris tempat kursor.
// Auto-kapital ada di `@/lib/sanitize` (autoCapitalize) karena dipakai juga saat render.

/** Pola butir daftar teks biasa: [indent, nomor, butir, spasi, isi] */
const LINE_ITEM_RE = /^([ \t]*)(?:(\d{1,3})[.)]|([-*•·]))([ \t]+)(.*)$/
const LEADING_MARKER_RE = /^[ \t]*(?:\d{1,3}[.)]|[-*•·])[ \t]+/

export interface Edit {
  value: string
  caret: number
}

/**
 * Enter di dalam butir daftar bernomor/berbutir.
 * @returns null bila baris bukan butir daftar (biarkan perilaku bawaan).
 */
export function continueList(value: string, caret: number, selectionEnd = caret): Edit | null {
  if (caret !== selectionEnd) return null
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const line = value.slice(lineStart, caret)
  const m = LINE_ITEM_RE.exec(line)
  if (!m) return null

  const indent = m[1] ?? ''
  const num = m[2] ?? ''
  const bullet = m[3] ?? ''
  const gap = m[4] ?? ' '
  const rest = m[5] ?? ''

  // butir kosong → keluar dari daftar (penanda dihapus, satu baris baru)
  if (!rest.trim()) {
    return { value: `${value.slice(0, lineStart)}\n${value.slice(caret)}`, caret: lineStart + 1 }
  }

  const marker = `${indent}${num ? `${Number(num) + 1}.` : bullet}${gap}`
  const insert = `\n${marker}`
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length }
}

/** Pasang (atau lepas, bila sudah terpasang) penanda daftar di awal baris kursor. */
export function toggleListMarker(value: string, caret: number, marker: string): Edit {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const nl = value.indexOf('\n', caret)
  const lineEnd = nl === -1 ? value.length : nl
  const line = value.slice(lineStart, lineEnd)
  const bare = line.replace(LEADING_MARKER_RE, '')
  const next = line.startsWith(marker) ? bare : marker + bare
  const nextValue = value.slice(0, lineStart) + next + value.slice(lineEnd)
  const delta = next.length - line.length
  return { value: nextValue, caret: Math.min(nextValue.length, Math.max(lineStart, caret + delta)) }
}
