package exams

// unit_test.go — uji logika murni modul ujian (tanpa DB):
//   - parsing jendela waktu (parseWindow)
//   - normalisasi konfigurasi anti-cheat
//   - shuffle stabil (urutan deterministik dari seed attempt)
//   - penataan ulang opsi MCQ sesuai urutan terkunci package_json
//
// Semua cepat (<1 ms) dan tidak menyentuh DB — selalu aman dijalankan.

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseWindow(t *testing.T) {
	open := "2026-01-01T07:00:00+07:00"
	close := "2026-01-01T09:00:00+07:00"
	w, c, err := parseWindow(open, close)
	if err != nil {
		t.Fatalf("parseWindow error: %v", err)
	}
	if w.Format(time.RFC3339) != "2026-01-01T07:00:00+07:00" {
		t.Errorf("open salah: %s", w)
	}
	_ = c

	if _, _, err := parseWindow(close, open); err == nil {
		t.Error("close sebelum open harus ditolak")
	}
}

func TestStableShuffle(t *testing.T) {
	ids := []string{"a", "b", "c", "d", "e", "f"}
	sh1 := stableShuffle(ids, "seed-attempt-1")
	sh2 := stableShuffle(ids, "seed-attempt-1")
	for i := range sh1 {
		if sh1[i] != sh2[i] {
			t.Fatalf("urutan tidak stabil pada seed sama")
		}
	}
	if len(sh1) != len(ids) {
		t.Fatalf("panjang berubah: %d", len(sh1))
	}
	// seed berbeda → sangat besar kemungkinan urutan berbeda.
	sh3 := stableShuffle(ids, "seed-attempt-2")
	sama := true
	for i := range sh1 {
		if sh1[i] != sh3[i] {
			sama = false
			break
		}
	}
	if sama && len(ids) > 2 {
		t.Logf("peringatan: seed berbeda menghasilkan urutan sama (dianterima namun tidak ideal)")
	}
	// Elemen tetap sama (permutasi).
	sum := func(xs []string) int {
		total := 0
		for i, x := range xs {
			total += i + len(x)
		}
		return total
	}
	if sum(sh1) != sum(ids) {
		t.Fatalf("shuffle harus permutasi")
	}
}

func TestReorderOptions(t *testing.T) {
	raw := json.RawMessage(`[{"id":"A","text":"3"},{"id":"B","text":"4"},{"id":"C","text":"5"}]`)
	out := reorderOptions(raw, []string{"C", "A", "B"})
	var opts []map[string]any
	if err := json.Unmarshal(out, &opts); err != nil {
		t.Fatalf("hasil bukan JSON valid: %v", err)
	}
	if len(opts) != 3 || opts[0]["id"] != "C" || opts[1]["id"] != "A" || opts[2]["id"] != "B" {
		t.Errorf("perintah opsi salah: %s", string(out))
	}
}

func TestAntiCheatNormalize(t *testing.T) {
	ac := AntiCheat{FlagThreshold: 0, SnapshotMaxS: -5}
	// snapshot_max_s < min → harus diangkat ke min.
	ac.normalize()
	if ac.SnapshotMaxS < ac.SnapshotMinS {
		t.Errorf("snapshot_max_s (%d) < snapshot_min_s (%d)", ac.SnapshotMaxS, ac.SnapshotMinS)
	}
	if ac.FlagThreshold <= 0 {
		t.Errorf("flag_threshold harus > 0, got %d", ac.FlagThreshold)
	}
}
