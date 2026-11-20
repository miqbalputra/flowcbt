package reports

import (
	"strings"
	"testing"
	"time"
)

func TestSlug(t *testing.T) {
	cases := map[string]string{
		"Matematika Wajib": "matematika-wajib",
		"Ujian  #12/2025":  "ujian-12-2025",
		"--Fisika--":       "fisika",
	}
	for in, want := range cases {
		if got := slug(in); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDurStr(t *testing.T) {
	cases := map[int64]string{
		0: "0:00", 45: "0:45", 600: "10:00", 4530: "75:30",
	}
	for in, want := range cases {
		if got := durStr(in); got != want {
			t.Errorf("durStr(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestParseLimit(t *testing.T) {
	if got := parseLimit("", 20, 100); got != 20 {
		t.Errorf("parseLimit('') = %d, want 20", got)
	}
	if got := parseLimit("500", 20, 100); got != 100 {
		t.Errorf("parseLimit('500') = %d, want 100 (dibatasi max)", got)
	}
	if got := parseLimit("5", 20, 100); got != 5 {
		t.Errorf("parseLimit('5') = %d, want 5", got)
	}
}

func TestCursorRoundtrip(t *testing.T) {
	at := time.Date(2025, 3, 1, 7, 30, 15, 123456000, time.UTC)
	c := encodeCursor(pageCursor{CloseAt: at, ID: "abc-123"})
	got, err := decodeCursor(c)
	if err != nil {
		t.Fatalf("decodeCursor(%q): %v", c, err)
	}
	if !got.CloseAt.Equal(at) || got.ID != "abc-123" {
		t.Errorf("roundtrip = %+v, want close_at=%v id=abc-123", got, at)
	}
	if _, err := decodeCursor("bukan-cursor"); err == nil {
		t.Error("cursor tidak valid harus error")
	}
}

func TestOptArg(t *testing.T) {
	if got := optArg(" "); got != nil {
		t.Errorf("optArg(spasi) = %v, want nil", got)
	}
	if got := optArg(" x "); got != "x" {
		t.Errorf("optArg(' x ') = %v, want x", got)
	}
}

func TestNilPtr(t *testing.T) {
	if got := nilPtr[int](nil); got != nil {
		t.Errorf("nilPtr(nil) = %v, want nil", got)
	}
	n := 7
	if got := nilPtr(&n); got != n {
		t.Errorf("nilPtr(&n) = %v, want %d", got, n)
	}
}

func TestParticipantsExpr(t *testing.T) {
	expr := participantsExpr("e")
	for _, want := range []string{"exam_assignments", "target_type='student'", "target_type='class'", "e.id"} {
		if !strings.Contains(expr, want) {
			t.Errorf("participantsExpr kurang %q dalam %q", want, expr)
		}
	}
	// paket soal kosong → seluruh siswa aktif tenant
	for _, want := range []string{"students s2", "students s "} {
		if !strings.Contains(expr, want) {
			t.Errorf("participantsExpr kurang %q", want)
		}
	}
}

func TestExportHeaders(t *testing.T) {
	want := []string{"No", "Nama", "Kelas", "Percobaan ke-", "Mulai", "Selesai",
		"Durasi (m:ss)", "Nilai (Sementara)", "Penalti", "Nilai Akhir", "Status", "Kecurangan"}
	if len(exportHeaders) != len(want) {
		t.Fatalf("jumlah kolom = %d, want %d", len(exportHeaders), len(want))
	}
	for i := range want {
		if exportHeaders[i] != want[i] {
			t.Errorf("kolom %d = %q, want %q", i, exportHeaders[i], want[i])
		}
	}
}
