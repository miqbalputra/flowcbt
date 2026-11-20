package grading

// FinalScore menghitung nilai akhir skala 0..100 (FR-8.2).
// Poin yang diproses: per-soal sudah dibulatkan 2 desimal (prorata di caller).
func FinalScore(obtained, maxPoints, penaltyPoints float64) float64 {
	if maxPoints <= 0 {
		return 0
	}
	s := (obtained / maxPoints) * 100
	s -= penaltyPoints
	if s < 0 {
		return 0
	}
	return round2(s)
}

// ApplyPenalty menetapkan penalti yang tidak melebihi batas maksimum (FR-5.8).
// penaltyPerViolation ≥ 0; maxPenalty ≤ 0 berarti tanpa batas.
func ApplyPenalty(current, perViolation float64, violations int, maxPenalty float64) float64 {
	total := current + perViolation*float64(violations)
	if maxPenalty >= 0 && total > maxPenalty {
		total = maxPenalty
	}
	return total
}

// NormalizeAnswerString normalisasi teks jawaban siswa untk penyimpanan konsisten.
func NormalizeAnswerString(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r != '\u200b' && r != '\ufeff' {
			out = append(out, r)
		}
	}
	return string(out)
}
