package httpx

import "github.com/microcosm-cc/bluemonday"

var htmlPolicy = func() *bluemonday.Policy {
	p := bluemonday.NewPolicy()
	p.AllowElements("p", "br", "strong", "b", "em", "i", "u", "s",
		"ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",
		"blockquote", "code", "pre", "span", "div", "h1", "h2", "h3", "h4",
		"img", "audio", "source", "sup", "sub", "a")
	p.AllowAttrs("src").OnElements("img", "audio", "source")
	p.AllowAttrs("href").OnElements("a")
	p.AllowAttrs("class").OnElements("span", "div", "p", "pre", "code")
	p.AllowAttrs("controls").OnElements("audio")
	p.AllowURLSchemes("http", "https", "data")
	return p
}()

// SanitizeHTML membersihkan rich text sesuai allowlist (anti-XSS, Bagian 12).
func SanitizeHTML(s string) string {
	return htmlPolicy.Sanitize(s)
}
