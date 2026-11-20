package billing

// prorata.go — logika prorata upgrade/persiapan langganan (fungsi murni,
// mudah di-uji; tanpa DB). PRD: upgrade bulanan "membayar selisih harga
// dengan prorata sisa hari".
//
// Penyederhanaan v1 (dicatat sesuai instruksi tugas): sisa hari langganan
// lama dikonversi ke hari paket baru berdasarkan rasio harga, lalu
// ditambahkan ke durasi penuh paket baru. Contoh: sisa 10 hari pada paket
// 50rb, pindah ke paket 70rb (30 hari) → ekstra = 10 × 50/70 ≈ 7,14 hari
// → total ≈ 37 hari.

import (
	"time"
)

// ProrataUpgradeEnds menghitung ends_at langganan hasil upgrade:
//
//	ends_at = now + durasi_paket_baru + (sisa_hari × harga_lama / harga_baru)
//
// Sisa hari lama dihargai proporsional (rasio harga lama terhadap baru)
// sehingga tenant tidak dirugikan saat pindah ke paket lebih mahal, dan
// tidak mendapatkan durasi berlebih saat pindah ke paket lebih murah.
func ProrataUpgradeEnds(now time.Time, oldEnds time.Time, durHariBaru, hargaLama, hargaBaru int) time.Time {
	// Batalkan langganan aktif lama; hitung sisa harinya.
	sisa := time.Duration(0)
	if oldEnds.After(now) {
		sisa = oldEnds.Sub(now)
	}
	// durasi paket baru dgn tambahan sisa prorata (rasio harga).
	if hargaLama <= 0 || hargaBaru <= 0 {
		hargaLama, hargaBaru = 1, 1 // hindari pembagian nol; tanpa ekstra
	}
	extra := time.Duration(float64(sisa) * (float64(hargaLama) / float64(hargaBaru)))
	return now.Add(time.Duration(durHariBaru) * 24 * time.Hour).Add(extra)
}
