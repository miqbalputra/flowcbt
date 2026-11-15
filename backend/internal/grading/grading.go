// Package grading adalah mesin penilaian MURNI tanpa akses DB (PRD 18.7):
// semua tipe soal, rumus parsial FR-8.1b, normalisasi isian, dan penalti FR-5.8.
package grading

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// Question merepresentasikan soal untuk dinilai (answer key TIDAK pernah dikirim ke klien siswa).
type Question struct {
	Type                string          `json:"type"` // mcq | mcq_complex | matching | short_answer | essay
	OptionsJSON         json.RawMessage `json:"options_json"`
	AnswerKeyJSON       json.RawMessage `json:"answer_key_json"`
	Points              float64         `json:"points"`
	ScoringMode         string          `json:"scoring_mode"` // all_or_nothing | partial
	PartialWrongPenalty bool            `json:"partial_wrong_penalty"`
}

// ScoreResult hasil penilaian satu soal.
type ScoreResult struct {
	Score     float64 `json:"score"`
	IsCorrect bool    `json:"is_correct"`
	MaxPoints float64 `json:"max_points"`
}

// Score menilai satu jawaban terhadap soal. Mengembalikan skor dalam satuan poin soal.
func Score(q Question, answer json.RawMessage) ScoreResult {
	res := ScoreResult{MaxPoints: q.Points}
	switch q.Type {
	case "mcq":
		var key struct {
			Correct string `json:"correct"`
		}
		_ = json.Unmarshal(q.AnswerKeyJSON, &key)
		var ans struct {
			Selected string `json:"selected"`
		}
		_ = json.Unmarshal(answer, &ans)
		if ans.Selected != "" && strings.EqualFold(ans.Selected, key.Correct) {
			res.Score = q.Points
			res.IsCorrect = true
		}
	case "mcq_complex":
		var key struct {
			Correct []string `json:"correct"`
		}
		_ = json.Unmarshal(q.AnswerKeyJSON, &key)
		var ans struct {
			Selected []string `json:"selected"`
		}
		_ = json.Unmarshal(answer, &ans)
		res = scoreSet(ans.Selected, key.Correct, q.Points, q.ScoringMode, q.PartialWrongPenalty)
	case "matching":
		var key struct {
			Pairs map[string]string `json:"pairs"`
		}
		_ = json.Unmarshal(q.AnswerKeyJSON, &key)
		var ans struct {
			Pairs map[string]string `json:"pairs"`
		}
		_ = json.Unmarshal(answer, &ans)
		res = scoreMatching(ans.Pairs, key.Pairs, q.Points, q.ScoringMode)
	case "short_answer":
		var key struct {
			Accepted []string `json:"accepted"`
		}
		_ = json.Unmarshal(q.AnswerKeyJSON, &key)
		var ans struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal(answer, &ans)
		if matchShortAnswer(ans.Text, key.Accepted) {
			res.Score = q.Points
			res.IsCorrect = true
		}
	case "essay":
		// dinilai manual oleh guru; auto = 0 (status menunggu penilaian)
	}
	return res
}

// scoreSet untuk PG kompleks (FR-8.1b): skor = poin × max(0, (benar − salah) / jumlah kunci).
func scoreSet(selected, correct []string, points float64, mode string, wrongPenalty bool) ScoreResult {
	res := ScoreResult{MaxPoints: points}
	sel := toSet(selected)
	cor := toSet(correct)
	if mode == "partial" {
		benar := 0
		salah := 0
		for s := range sel {
			if cor[s] {
				benar++
			} else {
				salah++
			}
		}
		n := len(cor)
		if n == 0 {
			return res
		}
		num := float64(benar)
		if wrongPenalty {
			num -= float64(salah)
		}
		ratio := num / float64(n)
		if ratio < 0 {
			ratio = 0
		}
		res.Score = round2(points * ratio)
		res.IsCorrect = ratio >= 1
		return res
	}
	// all_or_nothing
	if len(sel) == len(cor) {
		all := true
		for s := range sel {
			if !cor[s] {
				all = false
			}
		}
		if all {
			res.Score = points
			res.IsCorrect = true
		}
	}
	return res
}

// scoreMatching (FR-8.1b): parsial = poin × (pasangan benar / total pasangan).
func scoreMatching(ans, key map[string]string, points float64, mode string) ScoreResult {
	res := ScoreResult{MaxPoints: points}
	total := len(key)
	if total == 0 {
		return res
	}
	benar := 0
	for l, r := range ans {
		if key[l] == r {
			benar++
		}
	}
	if mode == "partial" {
		res.Score = round2(points * float64(benar) / float64(total))
		res.IsCorrect = benar == total
		return res
	}
	if benar == total && len(ans) == total {
		res.Score = points
		res.IsCorrect = true
	}
	return res
}

// NormalizeShortAnswer: trim, lowercase, hapus spasi ganda (FR-8.1).
func NormalizeShortAnswer(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevSpace := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			if !prevSpace {
				b.WriteRune(' ')
			}
			prevSpace = true
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// matchShortAnswer: cocok bila setelah normalisasi sama, ATAU keduanya angka
// dengan toleransi format desimal (`,` vs `.`) — mis. "15" cocok "15,0" / "15.00".
func matchShortAnswer(answer string, accepted []string) bool {
	a := NormalizeShortAnswer(answer)
	if a == "" {
		return false
	}
	af, aIsNum := parseNumber(a)
	for _, acc := range accepted {
		n := NormalizeShortAnswer(acc)
		if n == a {
			return true
		}
		nf, nIsNum := parseNumber(n)
		if aIsNum && nIsNum && math.Abs(af-nf) < 1e-9 {
			return true
		}
	}
	return false
}

// parseNumber: terima format desimal dengan `,` atau `.` sebagai pemisah desimal.
func parseNumber(s string) (float64, bool) {
	t := strings.ReplaceAll(s, ",", ".")
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

func toSet(in []string) map[string]bool {
	m := map[string]bool{}
	for _, s := range in {
		s = strings.ToUpper(strings.TrimSpace(s))
		if s != "" {
			m[s] = true
		}
	}
	return m
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// FinalScore menghitung nilai akhir skala 100 (FR-8.2): (raw/max)×100 − penalti, dibulatkan & di-clamp [0,100].
func FinalScore(rawScore, maxScore, penalty float64, decimals int) float64 {
	var nilai float64
	if maxScore > 0 {
		nilai = rawScore / maxScore * 100
	}
	nilai -= penalty
	if nilai < 0 {
		nilai = 0
	}
	if nilai > 100 {
		nilai = 100
	}
	p := math.Pow(10, float64(decimals))
	return math.Round(nilai*p) / p
}

// Penalty menghitung total penalti pelanggaran (FR-5.8A) dalam skala 100, dibatasi penalty_max.
func Penalty(count int, mode string, value, max float64) float64 {
	if count <= 0 || mode == "none" {
		return 0
	}
	var p float64
	switch mode {
	case "points":
		p = value * float64(count)
	case "percent":
		p = value * float64(count) // persen dari skala 100
	}
	if p > max {
		p = max
	}
	if p < 0 {
		p = 0
	}
	return round2(p)
}
