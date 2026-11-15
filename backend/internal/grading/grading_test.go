package grading

import (
	"encoding/json"
	"testing"
)

func q(t string, key string, points float64, mode string, wrongPen bool) Question {
	return Question{
		Type: t, AnswerKeyJSON: json.RawMessage(key), Points: points,
		ScoringMode: mode, PartialWrongPenalty: wrongPen,
	}
}

// Tabel-driven: semua tipe soal + rumus parsial FR-8.1b + normalisasi isian (PRD 14.1 unit test).
func TestScore(t *testing.T) {
	cases := []struct {
		name string
		q    Question
		ans  string
		want float64
	}{
		// PG
		{"mcq benar", q("mcq", `{"correct":"A"}`, 2, "all_or_nothing", true), `{"selected":"A"}`, 2},
		{"mcq salah", q("mcq", `{"correct":"A"}`, 2, "all_or_nothing", true), `{"selected":"B"}`, 0},
		{"mcq case-insensitive", q("mcq", `{"correct":"A"}`, 2, "all_or_nothing", true), `{"selected":"a"}`, 2},
		// PG kompleks all-or-nothing
		{"mcqc aon semua benar", q("mcq_complex", `{"correct":["A","C"]}`, 3, "all_or_nothing", true), `{"selected":["A","C"]}`, 3},
		{"mcqc aon kurang", q("mcq_complex", `{"correct":["A","C"]}`, 3, "all_or_nothing", true), `{"selected":["A"]}`, 0},
		{"mcqc aon ada salah", q("mcq_complex", `{"correct":["A","C"]}`, 3, "all_or_nothing", true), `{"selected":["A","B","C"]}`, 0},
		// PG kompleks parsial: poin × max(0,(benar−salah)/kunci)
		{"mcqc parsial 2/3 benar", q("mcq_complex", `{"correct":["A","C","D"]}`, 3, "partial", true), `{"selected":["A","C"]}`, 2},   // (2-0)/3*3 = 2
		{"mcqc parsial 1 benar 1 salah", q("mcq_complex", `{"correct":["A","C","D"]}`, 3, "partial", true), `{"selected":["A","B"]}`, 0}, // (1-1)/3 = 0
		{"mcqc parsial tanpa penalti salah", q("mcq_complex", `{"correct":["A","C","D"]}`, 3, "partial", false), `{"selected":["A","B"]}`, 1}, // 1/3*3 = 1
		// Menjodohkan
		{"matching aon benar", q("matching", `{"pairs":{"L1":"R1","L2":"R2"}}`, 4, "all_or_nothing", true), `{"pairs":{"L1":"R1","L2":"R2"}}`, 4},
		{"matching aon salah satu", q("matching", `{"pairs":{"L1":"R1","L2":"R2"}}`, 4, "all_or_nothing", true), `{"pairs":{"L1":"R1","L2":"R1"}}`, 0},
		{"matching parsial 1/2", q("matching", `{"pairs":{"L1":"R1","L2":"R2"}}`, 4, "partial", true), `{"pairs":{"L1":"R1","L2":"R9"}}`, 2},
		// Isian singkat + normalisasi
		{"isian sama", q("short_answer", `{"accepted":["15"]}`, 2, "all_or_nothing", true), `{"text":"15"}`, 2},
		{"isian spasi & kapital", q("short_answer", `{"accepted":["ibu kota jakarta"]}`, 2, "all_or_nothing", true), `{"text":"  Ibu   Kota   JAKARTA "}`, 2},
		{"isian desimal koma", q("short_answer", `{"accepted":["15,5"]}`, 2, "all_or_nothing", true), `{"text":"15.5"}`, 2},
		{"isian angka bulat vs desimal", q("short_answer", `{"accepted":["15"]}`, 2, "all_or_nothing", true), `{"text":"15,00"}`, 2},
		{"isian salah", q("short_answer", `{"accepted":["15"]}`, 2, "all_or_nothing", true), `{"text":"16"}`, 0},
		{"isian multi variasi", q("short_answer", `{"accepted":["fotosintesis","photosynthesis"]}`, 2, "all_or_nothing", true), `{"text":"Photosynthesis"}`, 2},
		// Uraian: auto 0 (manual)
		{"essay auto nol", q("essay", `null`, 10, "all_or_nothing", true), `{"text":"jawaban panjang"}`, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Score(c.q, json.RawMessage(c.ans))
			if got.Score != c.want {
				t.Fatalf("Score() = %v, want %v", got.Score, c.want)
			}
		})
	}
}

func TestFinalScore(t *testing.T) {
	// FR-8.2: nilai = (raw/max)×100 − penalti, clamp [0,100], 2 desimal
	if got := FinalScore(17, 21, 0, 2); got != 80.95 {
		t.Fatalf("final = %v, want 80.95", got)
	}
	if got := FinalScore(10, 21, 5, 2); got != 42.62 {
		t.Fatalf("final dengan penalti = %v, want 42.62", got)
	}
	if got := FinalScore(1, 21, 30, 2); got != 0 {
		t.Fatalf("clamp bawah = %v, want 0", got)
	}
	if got := FinalScore(21, 21, 0, 0); got != 100 {
		t.Fatalf("penuh = %v, want 100", got)
	}
}

func TestPenalty(t *testing.T) {
	// FR-5.8A: 5 poin per pelanggaran, maks 30 (skala 100)
	if got := Penalty(1, "points", 5, 30); got != 5 {
		t.Fatalf("penalty 1 = %v", got)
	}
	if got := Penalty(10, "points", 5, 30); got != 30 {
		t.Fatalf("penalty dibatasi max = %v, want 30", got)
	}
	if got := Penalty(3, "percent", 10, 30); got != 30 {
		t.Fatalf("penalty persen = %v", got)
	}
	if got := Penalty(3, "none", 10, 30); got != 0 {
		t.Fatalf("mode none = %v", got)
	}
}

func TestNormalizeShortAnswer(t *testing.T) {
	if got := NormalizeShortAnswer("  Budi   Santoso "); got != "budi santoso" {
		t.Fatalf("normalize = %q", got)
	}
}
