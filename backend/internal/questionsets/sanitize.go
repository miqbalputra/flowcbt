package questionsets

import (
	"html"
	"regexp"
	"strings"
)

// Allowlist tag HTML pada body/pembahasan soal (kontrak FE, tugas M4).
// Selain daftar ini tag dibuang; script/style dibuang beserta isinya;
// atribut hanya img[src] dan td/th[colspan,rowspan] yang dipertahankan.
var allowedTags = map[string]bool{
	"p": true, "br": true, "b": true, "i": true, "u": true,
	"em": true, "strong": true, "ul": true, "ol": true, "li": true,
	"table": true, "thead": true, "tbody": true, "tr": true,
	"td": true, "th": true, "img": true, "sub": true, "sup": true,
}

var voidTags = map[string]bool{"br": true, "img": true}

// img src hanya boleh dari media internal atau data URI (datasource inline).
var (
	mediaSrcPrefix = "/api/v1/media/"
	dataSrcPrefix  = "data:"
)

var (
	// reTagName menangkap nama tag LEPAS '<' awal (mis. "<p>...</p>", "</td;").
	reTagName = regexp.MustCompile(`^<\s*/?\s*([a-zA-Z][a-zA-Z0-9]*)`)
	reAttrSrc = regexp.MustCompile(`(?is)src\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))`)
	reSpan    = regexp.MustCompile(`(?i)colspan\s*=\s*["']?([0-9]+)|rowspan\s*=\s*["']?([0-9]+)`)
)

// sanitizeHTML menyaring HTML bebas menjadi HTML aman sesuai allowlist kontrak:
// tag di luar daftar dibuang, <script>/<style> dibuang beserta isinya, atribut
// on* dibuang, img src hanya /api/v1/media/... atau data:..., teks biasa di-escape.
// Pemakaian: body soal, explanation, dan konten stimulus.
func sanitizeHTML(in string) string {
	var b strings.Builder
	i := 0
	for i < len(in) {
		lt := strings.IndexByte(in[i:], '<')
		if lt < 0 {
			b.WriteString(escapeText(in[i:]))
			break
		}
		if lt > 0 {
			b.WriteString(escapeText(in[i : i+lt]))
		}
		i += lt
		// awal tag / komentar / doctype
		switch {
		case strings.HasPrefix(in[i:], "<!--"):
			if end := strings.Index(in[i+4:], "-->"); end >= 0 {
				i += 4 + end + 3
			} else {
				i = len(in)
			}
			continue
		case strings.HasPrefix(in[i:], "<![CDATA["):
			if end := strings.Index(in[i:], "]]>"); end >= 0 {
				b.WriteString(escapeText(in[i+9 : i+end]))
				i += end + 3
			} else {
				i = len(in)
			}
			continue
		case strings.HasPrefix(in[i:], "<!"), strings.HasPrefix(in[i:], "<?"):
			if end := strings.IndexByte(in[i:], '>'); end >= 0 {
				i += end + 1
			} else {
				i = len(in)
			}
			continue
		}
		rest := in[i:]
		m := reTagName.FindStringSubmatch(rest)
		if m == nil {
			// "<" bukan tag (mis. "5 < 10") — escape dan lanjut.
			b.WriteString("&lt;")
			i++
			continue
		}
		tagEnd := strings.IndexByte(rest, '>')
		if tagEnd < 0 {
			// tag tanpa penutup: buang sisanya.
			break
		}
		name := strings.ToLower(m[1])
		closing := strings.HasPrefix(rest, "</")
		if name == "script" || name == "style" {
			// buang tag dan seluruh isi hingga penutupnya.
			if end := indexCloseTag(strings.ToLower(in[i+tagEnd:]), name); end >= 0 {
				i += tagEnd + end
			} else {
				i = len(in)
			}
			continue
		}
		i += tagEnd + 1
		if !allowedTags[name] {
			continue
		}
		if closing && !voidTags[name] {
			b.WriteString("</" + name + ">")
			continue
		}
		b.WriteString(buildOpenTag(name, rest))
	}
	return b.String()
}

// indexCloseTag mencari posisi AKHIR penutup </name ...> (case-insensitive),
// hasil relatif dari awal s.
func indexCloseTag(s, name string) int {
	low := strings.ToLower(s)
	open := "</" + name
	for pos := 0; ; {
		j := strings.Index(low[pos:], open)
		if j < 0 {
			return -1
		}
		at := pos + j + len(open)
		if at >= len(low) {
			return -1
		}
		c := low[at]
		if c == '>' || c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '/' {
			if end := strings.IndexByte(low[at:], '>'); end >= 0 {
				return at + end + 1
			}
			return -1
		}
		pos = at
	}
}

// buildOpenTag membangun ulang tag buka tersanitasi: hanya atribut yang
// diperbolehkan (img src valid, td/th colspan|rowspan numerik) yang dipertahankan.
func buildOpenTag(name, rawTag string) string {
	switch {
	case name == "img":
		if m := reAttrSrc.FindStringSubmatch(rawTag); m != nil {
			src := m[2]
			if src == "" {
				if m[3] != "" {
					src = m[3]
				} else {
					src = m[4]
				}
			}
			src = strings.TrimSpace(html.UnescapeString(src))
			if strings.HasPrefix(src, mediaSrcPrefix) || strings.HasPrefix(src, dataSrcPrefix) {
				return `<img src="` + html.EscapeString(src) + `">`
			}
		}
		return "" // img tanpa src valid dibuang seluruhnya
	case name == "td" || name == "th":
		attrs := ""
		for _, sm := range reSpan.FindAllStringSubmatch(rawTag, 2) {
			v := sm[1]
			if v == "" {
				v = sm[2]
			}
			if strings.HasPrefix(sm[0], "colspan") {
				attrs += ` colspan="` + v + `"`
			} else {
				attrs += ` rowspan="` + v + `"`
			}
		}
		return "<" + name + attrs + ">"
	default:
		return "<" + name + ">"
	}
}

// escapeText meng-escape karakter berbahaya pada teks di antara tag,
// & dibiarkan agar entitas editor (&nbsp; &amp; dsb) tetap utuh.
func escapeText(s string) string {
	if !strings.ContainsAny(s, "<>") {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// sanitizeVar menyaring field HTML opsional (string kosong boleh).
func sanitizeVar(s string) string { return sanitizeHTML(strings.TrimSpace(s)) }
