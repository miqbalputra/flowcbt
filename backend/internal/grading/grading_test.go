package grading

import (
	"encoding/json"
	"testing"
)

func mq(t *testing.T, s string) json.RawMessage {
	t.Helper()
	return json.RawMessage(s)
}

func TestMCQ(t *testing.T) {
	q := &Question{ID: "1", Type: "mcq", Points: 2, AnswerKey: mq(t, `{"correct":"A"}`), ScoringMode: "all_or_nothing"}
	if r := Grade(q, "A"); r.Correct != true || r.Score != 2 {
		t.Fatalf("harus benar poin 2: %+v", r)
	}
	if r := Grade(q, "a"); !r.Correct { // case-insensitive
		t.Fatalf("harus terima huruf kecil: %+v", r)
	}
	if r := Grade(q, "B"); r.Correct || r.Score != 0 {
		t.Fatalf("harus salah: %+v", r)
	}
	if r := Grade(q, nil); r.Correct || r.Score != 0 {
		t.Fatalf("jawaban kosong harus salah: %+v", r)
	}
}

func TestMCQComplexAllOrNothing(t *testing.T) {
	q := &Question{ID: "1", Type: "mcq_complex", Points: 3, AnswerKey: mq(t, `{"correct":["A","C"]}`), ScoringMode: "all_or_nothing"}
	if r := Grade(q, []string{"A", "C"}); !r.Correct || r.Score != 3 {
		t.Fatalf("benar semua: %+v", r)
	}
	if r := Grade(q, []string{"A"}); r.Correct || r.Score != 0 {
		t.Fatalf("sebagian harus salah (all-or-nothing): %+v", r)
	}
	if r := Grade(q, []string{"A", "C", "B"}); r.Correct || r.Score != 0 {
		t.Fatalf("ada salah harus nol: %+v", r)
	}
}

func TestMCQComplexPartial(t *testing.T) {
	q := &Question{ID: "1", Type: "mcq_complex", Points: 3, AnswerKey: mq(t, `{"correct":["A","C"]}`), ScoringMode: "partial"}
	// (2 benar - 0 salah) / 2 kunci = 1.0 → 3
	if r := Grade(q, []string{"A", "C"}); r.Score != 3 {
		t.Fatalf("dapat penuh: %+v", r)
	}
	// (1 - 0) / 2 = 0.5 → 1.5
	if r := Grade(q, []string{"A"}); r.Score != 1.5 {
		t.Fatalf("parsial 1.5: %+v", r)
	}
	// (1 - 1) / 2 = 0 → 0
	if r := Grade(q, []string{"A", "B"}); r.Score != 0 {
		t.Fatalf("parsial minus jadi nol: %+v", r)
	}
	// (2 - 1)/2 = 0.5 → 1.5
	if r := Grade(q, []string{"A", "C", "B"}); r.Score != 1.5 {
		t.Fatalf("parsial 2 benar 1 salah: %+v", r)
	}
}

func TestMatching(t *testing.T) {
	q := &Question{ID: "1", Type: "matching", Points: 4, ScoringMode: "partial",
		AnswerKey: mq(t, `{"pairs":[{"left":"Indonesia","right":"Jakarta"},{"left":"Jepang","right":"Tokyo"}]}`)}
	ans := map[string]any{"Indonesia": "Jakarta", "Jepang": "Tokyo"}
	if r := Grade(q, ans); !r.Correct || r.Score != 4 {
		t.Fatalf("semua pasangan benar: %+v", r)
	}
	ans2 := map[string]any{"Indonesia": "Jakarta", "Jepang": "Osaka"}
	if r := Grade(q, ans2); r.Correct || r.Score != 2 { // 1/2 pasangan
		t.Fatalf("parsial 2.0: %+v", r)
	}
	ans3 := map[string]any{"pairs": []map[string]string{{"left": "Indonesia", "right": "Jakarta"}, {"left": "Jepang", "right": "Tokyo"}}}
	if r := Grade(q, ans3); !r.Correct || r.Score != 4 {
		t.Fatalf("bentuk pairs: %+v", r)
	}
	// all_or_nothing
	q.ScoringMode = "all_or_nothing"
	if r := Grade(q, ans2); r.Correct || r.Score != 0 {
		t.Fatalf("all_or_nothing: %+v", r)
	}
}

func TestShortAnswer(t *testing.T) {
	q := &Question{ID: "1", Type: "short_answer", Points: 2,
		AnswerKey: mq(t, `{"answers":["15","lima belas"]}`)}
	for _, a := range []any{"15", " 15 ", "15,0", "15.0", "15 cm", "  LIMA  BELAS "} {
		if r := Grade(q, a); !r.Correct || r.Score != 2 {
			t.Fatalf("harus terima %v: %+v", a, r)
		}
	}
	for _, a := range []any{"16", "dua puluh", ""} {
		if r := Grade(q, a); r.Correct {
			t.Fatalf("harus salah: %v", a)
		}
	}
}

func TestEssayPending(t *testing.T) {
	q := &Question{ID: "1", Type: "essay", Points: 10, AnswerKey: mq(t, `{"rubric":"..."}`)}
	r := Grade(q, "apapun")
	if r.Status != StatusPendingManual || r.Score != 0 {
		t.Fatalf("uraian menunggu penilaian: %+v", r)
	}
}

// ---- Uji formula nilai akhir (FR-8.2) ----

func TestFinalScore(t *testing.T) {
	cases := []struct {
		obtained, max float64
		want          float64
	}{
		{17.5, 20, 87.5},
		{0, 10, 0},
		{30, 30, 100},
	}
	for _, c := range cases {
		got := FinalScore(c.obtained, c.max, 0)
		if got != c.want {
			t.Fatalf("FinalScore(%v,%v) = %v, want %v", c.obtained, c.max, got, c.want)
		}
	}
	// penalti tidak membuat nilai negatif
	if got := FinalScore(2, 10, 30); got != 0 {
		t.Fatalf("penalti max nolkan nilai: %v", got)
	}
}
