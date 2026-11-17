// A-08: sanitasi ringan untuk HTML soal/opsi sebelum dangerouslySetInnerHTML.
// Konten berasal dari guru/import/xlsx dan paket share antar-tenant, jadi tidak bisa
// diasumsikan bersih. Allowlist sengaja sempit: hanya markup teks yang dipakai soal.

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI',
  'SUB', 'SUP', 'CODE', 'SPAN', 'DIV', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4',
]);

const ALLOWED_ATTRS = new Set(['class', 'title']);

/** Buang script/event handler/skema berbahaya. Teks dan tag yang diizinkan tetap dipertahankan. */
export function sanitizeHtml(input: unknown): string {
  let html = typeof input === 'string' ? input : '';
  // Komentar & elemen berbahaya dihapus seluruhnya (termasuk isinya).
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|svg|math|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|svg|math|form)\b[^>]*\/?>/gi, '');

  // Buang semua atribut (termasuk on*=, src= javascript:, srcdoc, href=javascript:),
  // lalu izinkan hanya atribut netral pada tag yang diperbolehkan.
  html = html.replace(/<\s*(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (_m, slash: string, tag: string, attrs: string) => {
    const name = tag.toUpperCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (slash) return `</${name}>`;
    const kept: string[] = [];
    const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"|([a-zA-Z-]+)\s*=\s*'([^']*)'/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrs))) {
      const key = (m[1] || m[3]).toLowerCase();
      const value = m[2] || m[4];
      if (!ALLOWED_ATTRS.has(key)) continue;
      if (/javascript:|data:text\/html|on[a-z]+/i.test(value)) continue;
      kept.push(`${key}="${value.replace(/"/g, '&quot;')}"`);
    }
    const selfClose = /\/\s*$/.test(attrs) || name === 'BR';
    return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}${selfClose ? ' /' : ''}>`;
  });

  // Protokol berbahaya di dalam atribut yang tersisa (jaga-jaga).
  html = html.replace(/javascript:/gi, '');
  return html;
}

/** Teks polos untuk aria-label (menghapus tag HTML). */
export function stripHtml(input: unknown): string {
  return sanitizeHtml(input).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
