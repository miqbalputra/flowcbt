// Package grading — mesin penilaian otomatis (server-side).
// PRD FR-8.1 & FR-8.1b: PG, PG Kompleks, Menjodohkan, Isian Singkat, Uraian.
// Paket ini MURNI (tanpa DB) agar mudah di-unit-test (PRD 14.1).
package grading

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
)

// Question adalah tampilan soal untuk penilaian (dari DB, tanpa data siswa lain).
type Question struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"` // mcq|mcq_complex|matching|short_answer|essay
	Points      float64         `json:"points"`
	ScoringMode string          `json:"scoring_mode"` // all_or_nothing|partial
	AnswerKey   json.RawMessage `json:"answer_key"`
	Options     json.RawMessage `json:"options"` // untuk mengetahui jumlah distraktor (mcq_complex)
}

// Result hasil penilaian satu soal.
type Result struct {
	Score   float64 `json:"score"`   // 0..Points
	Correct bool    `json:"correct"` // true hanya jika skor penuh
	Status  string  `json:"status"`  // auto|pending_manual
}

const (
	StatusAuto          = "auto"
	StatusPendingManual = "pending_manual"
)

// Grade menilai satu jawaban siswa terhadap kunci.
func Grade(q *Question, rawAnswer any) Result {
	if q.Points <= 0 {
		q.Points = 1
	}
	// Bila jawaban datang sebagai raw JSON dari DB (json.RawMessage/[]byte),
	// parse dulu ke bentuk generik agar semua grader bekerja konsisten.
	switch b := rawAnswer.(type) {
	case json.RawMessage:
		var v any
		if err := json.Unmarshal(b, &v); err == nil {
			rawAnswer = v
		}
	case []byte:
		var v any
		if err := json.Unmarshal(b, &v); err == nil {
			rawAnswer = v
		}
	}
	switch q.Type {
	case "mcq":
		return gradeMCQ(q, rawAnswer)
	case "mcq_complex":
		return gradeMCQComplex(q, rawAnswer)
	case "matching":
		return gradeMatching(q, rawAnswer)
	case "short_answer":
		return gradeShortAnswer(q, rawAnswer)
	case "essay":
		return Result{Score: 0, Correct: false, Status: StatusPendingManual}
	default:
		return Result{Score: 0, Correct: false, Status: StatusAuto}
	}
}

// ---- Pilih satu jawaban benar (PG) ----
// answer_key: {"correct": "A"} atau {"correct": 2} (index)
func gradeMCQ(q *Question, ans any) Result {
	key := map[string]json.RawMessage{}
	if err := json.Unmarshal(q.AnswerKey, &key); err != nil {
		return miss(q)
	}
	pick := normalizePick(ans)
	var correctAny any
	_ = json.Unmarshal(key["correct"], &correctAny)
	correct := normalizePick(correctAny)
	if pick != "" && correct != "" && pick == correct {
		return hit(q)
	}
	return miss(q)
}

// ---- PG Kompleks (FR-8.1b) ----
// answer_key: {"correct": ["A","C"]}
// scoring_mode partial: skor = poin × max(0, (benarDipilih − salahDipilih) ÷ jumlahKunciBenar)
func gradeMCQComplex(q *Question, ans any) Result {
	var keys []string
	key := map[string]json.RawMessage{}
	if err := json.Unmarshal(q.AnswerKey, &key); err != nil {
		return miss(q)
	}
	if err := json.Unmarshal(key["correct"], &keys); err != nil {
		return miss(q)
	}
	picked := picksList(ans)
	if len(keys) == 0 {
		return miss(q)
	}
	keySet := map[string]bool{}
	for _, k := range keys {
		keySet[strings.ToUpper(strings.TrimSpace(k))] = true
	}
	correctPicked, wrongPicked := 0, 0
	for _, p := range picked {
		pu := strings.ToUpper(strings.TrimSpace(p))
		if keySet[pu] {
			correctPicked++
		} else {
			wrongPicked++
		}
	}
	if len(picked) == 0 {
		return miss(q)
	}
	if q.ScoringMode == "partial" {
		ratio := (float64(correctPicked) - float64(wrongPicked)) / float64(len(keys))
		if ratio <= 0 {
			return miss(q)
		}
		score := round2(q.Points * ratio)
		return Result{Score: score, Correct: score == q.Points, Status: StatusAuto}
	}
	// all_or_nothing: semua kunci tepat dipilih dan tidak ada salah
	if correctPicked == len(keys) && wrongPicked == 0 {
		return hit(q)
	}
	return miss(q)
}

// ---- Menjodohkan (FR-8.1b) ----
// answer_key: {"pairs": [{"left":"Indonesia","right":"Jakarta"}, ...]}
// jawaban siswa: {"pairs": [{"left":"Indonesia","right":"Jakarta"}...]} — pasangan L→R
// partial: skor = poin × (pasanganBenar / totalPasangan)
func gradeMatching(q *Question, ans any) Result {
	type pair struct {
		Left  string `json:"left"`
		Right string `json:"right"`
	}
	var kp struct {
		Pairs []pair `json:"pairs"`
	}
	if err := json.Unmarshal(q.AnswerKey, &kp); err != nil || len(kp.Pairs) == 0 {
		return miss(q)
	}
	// jawaban siswa bisa {"pairs": [...]} atau map left->right
	rightOf := map[string]string{}
	abs := []byte(mustJSON(ans))
	switch a := ans.(type) {
	case map[string]any:
		// 1) bentuk {"pairs": [...]}
		var ap struct {
			Pairs []pair `json:"pairs"`
		}
		if json.Unmarshal(abs, &ap) == nil && len(ap.Pairs) > 0 {
			for _, p := range ap.Pairs {
				rightOf[strNorm(p.Left)] = p.Right
			}
		} else {
			// 2) bentuk map: {"Indonesia":"Jakarta", ...}
			for k, v := range a {
				switch vv := v.(type) {
				case string:
					rightOf[strNorm(k)] = vv
				default:
					bs, _ := json.Marshal(v)
					var p pair
					if json.Unmarshal(bs, &p) == nil {
						rightOf[strNorm(p.Left)] = p.Right
					}
				}
			}
		}
	default:
		var ap struct {
			Pairs []pair `json:"pairs"`
		}
		if err := json.Unmarshal(abs, &ap); err != nil {
			return miss(q)
		}
		for _, p := range ap.Pairs {
			rightOf[strNorm(p.Left)] = p.Right
		}
	}
	if len(rightOf) == 0 {
		return miss(q)
	}
	total := len(kp.Pairs)
	correctPairs := 0
	for _, p := range kp.Pairs {
		got, ok := rightOf[strNorm(p.Left)]
		if ok && strNorm(got) == strNorm(p.Right) {
			correctPairs++
		}
	}
	if q.ScoringMode == "partial" {
		ratio := float64(correctPairs) / float64(total)
		if ratio <= 0 {
			return miss(q)
		}
		score := round2(q.Points * ratio)
		return Result{Score: score, Correct: score == q.Points, Status: StatusAuto}
	}
	if correctPairs == total {
		return hit(q)
	}
	return miss(q)
}

// ---- Isian Singkat (FR-8.1) ----
// answer_key: {"answers": ["15", "lima belas"]} — multi-variasi,
// case-insensitive, trim, spasi ganda, desimal ',' atau '.'.
func gradeShortAnswer(q *Question, ans any) Result {
	key := map[string]json.RawMessage{}
	if err := json.Unmarshal(q.AnswerKey, &key); err != nil {
		return miss(q)
	}
	var candidates []string
	if err := json.Unmarshal(key["answers"], &candidates); err != nil {
		var single string
		if json.Unmarshal(key["answers"], &single) == nil && single != "" {
			candidates = []string{single}
		}
	}
	given := strNormShort(fmt.Sprintf("%v", ans))
	if given == "" {
		return miss(q)
	}
	for _, c := range candidates {
		if strNormShort(c) == given {
			return hit(q)
		}
		// perbandingan angka (toleransi desimal ,/.)
		if numEq(c, fmt.Sprintf("%v", ans)) {
			return hit(q)
		}
	}
	return miss(q)
}

func strNorm(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

var multiSpace = regexp.MustCompile(`\s+`)

// strNormShort: trim, lowercase, spasi ganda jadi satu
func strNormShort(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, ",", ".")
	return multiSpace.ReplaceAllString(s, " ")
}

func numEq(a, b string) bool {
	fa, erra := parseNum(a)
	fb, errb := parseNum(b)
	if erra != nil || errb != nil {
		return false
	}
	return fa == fb
}

func parseNum(s string) (float64, error) {
	var v float64
	var e error
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", ".")
	// buang unit/teks "15 cm" → 15
	for i := len(s); i > 0; i-- {
		if _, e = fmt.Sscanf(s[:i], "%g", &v); e == nil {
			return v, nil
		}
	}
	return v, e
}

func mustJSON(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func normalizePick(v any) string {
	switch x := v.(type) {
	case json.RawMessage:
		// jawaban siswa dari DB berupa raw JSON — parse dulu
		var any2 any
		if err := json.Unmarshal(x, &any2); err == nil {
			return normalizePick(any2)
		}
		return strings.ToUpper(strings.TrimSpace(string(x)))
	case []byte:
		var any2 any
		if err := json.Unmarshal(x, &any2); err == nil {
			return normalizePick(any2)
		}
		return strings.ToUpper(strings.TrimSpace(string(x)))
	case string:
		s := strings.Trim(x, `"'`)
		return strings.ToUpper(strings.TrimSpace(s))
	case float64:
		if x == math.Trunc(x) {
			return fmt.Sprintf("%d", int(x))
		}
		return fmt.Sprintf("%g", x)
	case json.Number:
		return string(x)
	default:
		s := strings.TrimSpace(fmt.Sprintf("%v", v))
		s = strings.Trim(s, `"'`)
		return strings.ToUpper(s)
	}
}

func picksList(v any) []string {
	switch x := v.(type) {
	case json.RawMessage:
		var any2 any
		if err := json.Unmarshal(x, &any2); err == nil {
			return picksList(any2)
		}
		return nil
	case []byte:
		var any2 any
		if err := json.Unmarshal(x, &any2); err == nil {
			return picksList(any2)
		}
		return nil
	case []any:
		out := []string{}
		for _, it := range x {
			out = append(out, normalizePick(it))
		}
		return out
	case []string:
		out := []string{}
		for _, it := range x {
			out = append(out, normalizePick(it))
		}
		return out
	case string:
		// "A,C" atau "AC"
		s := strings.ToUpper(strings.TrimSpace(x))
		if strings.ContainsAny(s, ",;|") {
			parts := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ';' || r == '|' })
			return parts
		}
		if s != "" {
			// "AC" → ["A","C"]
			return strings.Split(s, "")
		}
		return []string{}
	default:
		return []string{}
	}
}

func hit(q *Question) Result  { return Result{Score: q.Points, Correct: true, Status: StatusAuto} }
func miss(q *Question) Result { return Result{Score: 0, Correct: false, Status: StatusAuto} }

func round2(v float64) float64 { return math.Round(v*100) / 100 }
