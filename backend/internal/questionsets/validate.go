package questionsets

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"flowcbt/backend/internal/httpx"
)

// Bentuk data soal — kontrak FE (tugas M4):
// mcq:          options [{id,text}] 2-5, answer_key {correct:"A"}
// mcq_complex:  options sama,          answer_key {correct:["A","C"]}
// matching:     options {left,right},  answer_key {pairs:[{left,right}]} 4-6 pasangan
// short_answer: answer_key {answers:["15","15.0"]} multi variasi
// essay:        answer_key {rubric:"..."} (opsional)
// points numeric; scoring_mode: partial hanya untuk mcq_complex & matching.

type questionOption struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type matchOptions struct {
	Left  []string `json:"left"`
	Right []string `json:"right"`
}

type answerMCQ struct {
	Correct string `json:"correct"`
}

type answerMCQMulti struct {
	Correct []string `json:"correct"`
}

type answerPairs struct {
	Pairs []pair `json:"pairs"`
}

type pair struct {
	Left  string `json:"left"`
	Right string `json:"right"`
}

type answerList struct {
	Answers []string `json:"answers"`
}

type answerRubric struct {
	Rubric string `json:"rubric"`
}

// tipe soal yang diizinkan (sesuai CHECK pada tabel questions).
func validType(t string) bool {
	switch t {
	case "mcq", "mcq_complex", "matching", "short_answer", "essay":
		return true
	}
	return false
}

const (
	modeAllOrNothing = "all_or_nothing"
	modePartial      = "partial"
)

type valErr struct {
	field   string
	message string
}

type questionValidator struct {
	errs []valErr
}

func (v *questionValidator) bad(field, format string, args ...any) {
	v.errs = append(v.errs, valErr{field: field, message: fmt.Sprintf(format, args...)})
}

func (v *questionValidator) checkRange(field string, n, min, max int) bool {
	if n < min || n > max {
		v.bad(field, "jumlah %d di luar rentang %d-%d", n, min, max)
		return false
	}
	return true
}

func (v *questionValidator) fail() error {
	if len(v.errs) == 0 {
		return nil
	}
	msgs := make([]string, 0, len(v.errs))
	details := make([]map[string]string, 0, len(v.errs))
	for _, e := range v.errs {
		msgs = append(msgs, e.message)
		details = append(details, map[string]string{"field": e.field, "message": e.message})
	}
	return &httpx.APIError{Status: http.StatusBadRequest, Code: "VALIDATION",
		Message: "Struktur soal tidak valid: " + strings.Join(msgs, "; "), Details: details}
}

// validateQuestion menguji bentuk options/answer_key per tipe + points +
// scoring_mode (400 VALIDATION bila hancur). Mengembalikan pasangan
// (options, answer_key) yang sudah dinormalisasi bila lolos.
func validateQuestion(typ, optionsRaw, answerKeyRaw string, points float64, scoringMode string) (string, string, error) {
	v := &questionValidator{}
	switch typ {
	case "mcq", "mcq_complex":
		var options []questionOption
		strictDecode(v, "options", optionsRaw, &options)
		ids := map[string]bool{}
		for i, o := range options {
			id := strings.ToUpper(strings.TrimSpace(o.ID))
			if len(id) != 1 || id < "A" || id > "E" {
				v.bad("options", "opsi ke-%d: id %q harus huruf A-E", i+1, o.ID)
			}
			if ids[id] {
				v.bad("options", "opsi ke-%d: id %q duplikat", i+1, o.ID)
			}
			ids[id] = true
			if strings.TrimSpace(o.Text) == "" {
				v.bad("options", "opsi %s: teks kosong", id)
			}
		}
		v.checkRange("options", len(options), 2, 5)
		validID := func(s string) bool { return ids[strings.ToUpper(strings.TrimSpace(s))] }
		switch typ {
		case "mcq":
			var key answerMCQ
			strictDecode(v, "answer_key", answerKeyRaw, &key)
			c := strings.ToUpper(strings.TrimSpace(key.Correct))
			if c == "" || !validID(c) {
				v.bad("answer_key", "kunci %q bukan id opsi yang ada (A-E)", key.Correct)
			}
			if scoringMode != modeAllOrNothing {
				v.bad("scoring_mode", "mcq hanya boleh all_or_nothing")
			}
		default: // mcq_complex
			var key answerMCQMulti
			strictDecode(v, "answer_key", answerKeyRaw, &key)
			if len(key.Correct) == 0 {
				v.bad("answer_key", "kunci minimal satu jawaban benar")
			}
			seen := map[string]bool{}
			for _, c := range key.Correct {
				c = strings.ToUpper(strings.TrimSpace(c))
				if !validID(c) {
					v.bad("answer_key", "kunci %q bukan id opsi yang ada (A-E)", c)
					continue
				}
				if seen[c] {
					v.bad("answer_key", "kunci %q duplikat", c)
				}
				seen[c] = true
			}
			if scoringMode != modeAllOrNothing && scoringMode != modePartial {
				v.bad("scoring_mode", "mcq_complex boleh all_or_nothing atau partial")
			}
		}
	case "matching":
		var opts matchOptions
		strictDecode(v, "options", optionsRaw, &opts)
		v.checkRange("options.left", len(opts.Left), 2, 10)
		v.checkRange("options.right", len(opts.Right), 2, 10)
		leftSet, rightSet := map[string]bool{}, map[string]bool{}
		for _, l := range opts.Left {
			leftSet[strings.TrimSpace(l)] = true
		}
		for _, r := range opts.Right {
			rightSet[strings.TrimSpace(r)] = true
		}
		for i, s := range opts.Left {
			if strings.TrimSpace(s) == "" {
				v.bad("options.left", "item kiri ke-%d kosong", i+1)
			}
		}
		for i, s := range opts.Right {
			if strings.TrimSpace(s) == "" {
				v.bad("options.right", "item kanan ke-%d kosong", i+1)
			}
		}
		var key answerPairs
		strictDecode(v, "answer_key", answerKeyRaw, &key)
		v.checkRange("answer_key.pairs", len(key.Pairs), 2, 10)
		leftUsed := map[string]bool{}
		for i, p := range key.Pairs {
			l, r := strings.TrimSpace(p.Left), strings.TrimSpace(p.Right)
			if !leftSet[l] {
				v.bad("answer_key", "pasangan ke-%d: kiri %q tidak ada di options.left", i+1, p.Left)
			}
			if !rightSet[r] {
				v.bad("answer_key", "pasangan ke-%d: kanan %q tidak ada di options.right", i+1, p.Right)
			}
			if leftUsed[l] {
				v.bad("answer_key", "pasangan ke-%d: kiri %q dipakai dua kali", i+1, p.Left)
			}
			leftUsed[l] = true
		}
		if scoringMode != modeAllOrNothing && scoringMode != modePartial {
			v.bad("scoring_mode", "matching boleh all_or_nothing atau partial")
		}
	case "short_answer":
		var key answerList
		strictDecode(v, "answer_key", answerKeyRaw, &key)
		if len(key.Answers) == 0 {
			v.bad("answer_key", "kunci minimal satu variasi jawaban")
		}
		for i, a := range key.Answers {
			if strings.TrimSpace(a) == "" {
				v.bad("answer_key", "variasi jawaban ke-%d kosong", i+1)
			}
		}
		if scoringMode != modeAllOrNothing {
			v.bad("scoring_mode", "short_answer hanya boleh all_or_nothing")
		}
	default: // essay
		var key answerRubric
		strictDecode(v, "answer_key", answerKeyRaw, &key)
		if scoringMode != modeAllOrNothing {
			v.bad("scoring_mode", "essay hanya boleh all_or_nothing")
		}
	}
	if points <= 0 {
		v.bad("points", "poin harus > 0 (dapat %v)", points)
	}
	return optionsRaw, answerKeyRaw, v.fail()
}

// strictDecode mem-parsing JSON dengan menolak field tak dikenal;
// kesalahan dicatat ke v tanpa menghentikan pemeriksaan lain.
func strictDecode(v *questionValidator, field, raw string, dst any) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "null"
	}
	dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		v.bad(field, "%s struktur tidak valid: %v", field, err)
	}
}
