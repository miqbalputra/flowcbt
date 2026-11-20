package auth

import (
	"strconv"
	"testing"
	"time"
)

// TestRateLimiterBlocksAfterMax — Allow memblokir setelah kuota token
// habis (basis rate limit endpoint auth, #5).
func TestRateLimiterBlocksAfterMax(t *testing.T) {
	r := NewRateLimiter()
	allowed := 0
	for i := 0; i < 10; i++ {
		if r.Allow("t:satu", 5) {
			allowed++
		}
	}
	if allowed != 5 {
		t.Errorf("Allow 5/menit: diizinkan %d kali, seharusnya 5", allowed)
	}
}

// TestRateLimiterIndependentKeys — kunci berbeda tak saling memengaruhi.
func TestRateLimiterIndependentKeys(t *testing.T) {
	r := NewRateLimiter()
	for i := 0; i < 5; i++ {
		r.Allow("k:a", 5) // habiskan a
	}
	if r.Allow("k:a", 5) {
		t.Error("k:a seharusnya diblokir")
	}
	if !r.Allow("k:b", 5) {
		t.Error("k:b seharusnya masih diizinkan")
	}
}

// TestRateLimiterEvictsStaleBuckets — eviksi (#5/#12): saat map melewati
// ambang, entri usang (> rateBucketTTL) dihapus, entri segar dipertahankan,
// dan limiter tetap berfungsi.
func TestRateLimiterEvictsStaleBuckets(t *testing.T) {
	r := NewRateLimiter()
	now := time.Now()
	// satu bucket usang (tidak aktif > 1 jam) + banyak bucket segar
	r.mu.Lock()
	r.buckets["stale:1"] = &bucket{tokens: 1, last: now.Add(-2 * time.Hour)}
	r.buckets["stale:2"] = &bucket{tokens: 1, last: now.Add(-90 * time.Minute)}
	for i := 0; i < maxRateBuckets; i++ {
		r.buckets[freshKey(i)] = &bucket{tokens: 5, last: now}
	}
	total := len(r.buckets)
	r.mu.Unlock()

	if total <= maxRateBuckets {
		t.Fatalf("persiapan test salah: total bucket %d", total)
	}
	// Ambil 1 token → karena len > maxRateBuckets, eviksi harus berjalan
	// dan menghapus bucket usang.
	if !r.Allow("fresh:x", 5) {
		t.Fatal("Allow setelah eviksi seharusnya berhasil")
	}
	r.mu.Lock()
	_, adaStale1 := r.buckets["stale:1"]
	_, adaStale2 := r.buckets["stale:2"]
	_, adaFresh := r.buckets[freshKey(0)]
	r.mu.Unlock()
	if adaStale1 || adaStale2 {
		t.Error("bucket usang seharusnya terhapus oleh eviksi")
	}
	if !adaFresh {
		t.Error("bucket segar seharusnya dipertahankan")
	}
}

func freshKey(i int) string {
	// kunci segar deterministik (bukan acak) agar assertions stabil.
	return "fresh:" + strconv.Itoa(i)
}

// TestRateLimiterRefill — token terisi ulang mengikuti waktu (unit dasar).
func TestRateLimiterRefill(t *testing.T) {
	r := NewRateLimiter()
	if !r.Allow("refill:1", 6) {
		t.Fatal("panggilan pertama harus diizinkan")
	}
	r.mu.Lock()
	b := r.buckets["refill:1"]
	// simulasikan waktu berlalu: mundurkan last 12 detik (refill 6/menit
	// = 0.1 token/detik → +1.2 token).
	b.last = b.last.Add(-12 * time.Second)
	r.mu.Unlock()
	if !r.Allow("refill:1", 6) {
		t.Error("setelah 12 detik token terisi ulang, seharusnya diizinkan")
	}
}
