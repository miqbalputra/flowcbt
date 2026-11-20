package billing

import (
	"math"
	"testing"
	"time"
)

// TestProrataUpgradeEnds — logika pembagian (prorata) akhir masa berlaku.
func TestProrataUpgradeEnds(t *testing.T) {
	skrg := time.Date(2025, 6, 15, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		oldEnds   time.Time
		hargaLama int
		hargaBaru int
		durHari   int
		// ekstra yang diharapkan (hari, frac)
		wantHari float64
	}{
		{
			name:      "upgrade dgn sisa 10 hari, rasio 50/70",
			oldEnds:   skrg.Add(10 * 24 * time.Hour),
			hargaLama: 50000, hargaBaru: 70000, durHari: 30,
			wantHari: 30 + 10*(50000.0/70000.0),
		},
		{
			name:      "lama sudah habis → tanpa ekstra",
			oldEnds:   skrg.Add(-2 * 24 * time.Hour),
			hargaLama: 50000, hargaBaru: 70000, durHari: 30,
			wantHari: 30,
		},
		{
			name:      "harga sama rata → sisa prorata penuh",
			oldEnds:   skrg.Add(10 * 24 * time.Hour),
			hargaLama: 70000, hargaBaru: 70000, durHari: 30,
			wantHari: 40,
		},
	}

	for _, tt := range tests {
		dapat := ProrataUpgradeEnds(skrg, tt.oldEnds, tt.durHari, tt.hargaLama, tt.hargaBaru)
		hari := dapat.Sub(skrg).Hours() / 24
		if math.Abs(hari-tt.wantHari) > 0.01 {
			t.Errorf("%s: dapat %f hari, ingin %f", tt.name, hari, tt.wantHari)
		}
	}
}
