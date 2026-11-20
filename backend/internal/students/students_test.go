package students

import (
	"testing"
)

func TestSlugName(t *testing.T) {
	cases := map[string]string{
		"Budi Santoso":   "budi-santoso",
		"  Ani  ): ":     "ani",
		"D'Artagnan Jr":  "d-artagnan-jr",
		"Siti123":        "siti123",
		"   ":            "",
		"Budi---Santoso": "budi-santoso",
	}
	for in, want := range cases {
		if got := slugName(in); got != want {
			t.Errorf("slugName(%q) = %q, mau %q", in, got, want)
		}
	}
}

func TestNormalizeGender(t *testing.T) {
	valid := map[string]string{
		"L": "L", "l": "L", "P": "P", "p": "P",
		"laki-laki": "L", "LAKI-LAKI": "L", "perempuan": "P", "wanita": "P", "pria": "P",
		" L ": "L",
	}
	for in, want := range valid {
		got, ok := normalizeGender(in)
		if !ok || got != want {
			t.Errorf("normalizeGender(%q) = %q,%v; mau %q,true", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "X", "xyz", "123"} {
		if _, ok := normalizeGender(in); ok {
			t.Errorf("normalizeGender(%q) seharusnya tidak valid", in)
		}
	}
}

func TestRandomPassword(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		p, err := randomPassword()
		if err != nil {
			t.Fatal(err)
		}
		if len(p) != 8 {
			t.Fatalf("panjang password = %d, mau 8", len(p))
		}
		var hasLower, hasUpper, hasDigit bool
		for _, c := range p {
			switch {
			case c >= 'a' && c <= 'z':
				hasLower = true
			case c >= 'A' && c <= 'Z':
				hasUpper = true
			case c >= '0' && c <= '9':
				hasDigit = true
			}
		}
		if !hasLower || !hasUpper || !hasDigit {
			t.Fatalf("password %q tidak memenuhi komposisi", p)
		}
		if seen[p] {
			t.Fatalf("password duplikat (tidak wajar): %q", p)
		}
		seen[p] = true
	}
}

func TestNewStudentCodeAndUsername(t *testing.T) {
	m := &Module{}
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		code, err := m.newStudentCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 8 || code[:2] != "S-" {
			t.Fatalf("kode = %q, mau S-XXXXXX", code)
		}
		if seen[code] {
			t.Fatalf("kode duplikat (tidak wajar): %q", code)
		}
		seen[code] = true
	}
	u, err := m.newUsername("Budi Santoso")
	if err != nil {
		t.Fatal(err)
	}
	if len(u) < 6 || !startsWith(u, "budi-santoso") {
		t.Fatalf("username = %q, harus berbasis slug", u)
	}
	u2, err := m.newUsername("!!!")
	if err != nil || !startsWith(u2, "siswa") {
		t.Fatalf("username kosong harus fallback 'siswa', dapat %q", u2)
	}
}

func startsWith(s, p string) bool { return len(s) >= len(p) && s[:len(p)] == p }

func TestUUIDV4(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		u, err := uuidV4()
		if err != nil {
			t.Fatal(err)
		}
		if len(u) != 36 || u[14] != '4' {
			t.Fatalf("uuid = %q, harus v4 36 char", u)
		}
		if seen[u] {
			t.Fatal("uuid duplikat")
		}
		seen[u] = true
	}
}

func TestParseImportRows(t *testing.T) {
	rows := [][]string{
		{"Nama", "Jenis Kelamin", "Kelas", "NIS"},
		{"Andi Pratama", "L", "X IPA 1", "001"},
		{"Siti", "perempuan", "X IPA 2", ""},
		{"AB", "L", "X IPA 1", ""},           // nama pendek
		{"Bad", "X", "X IPA 1", ""},          // gender salah
		{"No Class", "L", "", ""},            // kelas kosong
		{"Andi Pratama", "L", "X IPA 1", ""}, // duplikat nama+kelas
		{"", "", "", ""},                     // baris kosong -> dilewati
		{"Lain", "L", "X IPA 9", "001"},      // duplikat NIS
	}
	out := parseImportRows(rows)
	if len(out) != 7 {
		t.Fatalf("jumlah baris = %d, mau 7 (baris kosong dilewati): %+v", len(out), out)
	}
	if out[0].Line != 2 || !out[0].OK || out[0].Gender != "L" {
		t.Fatalf("baris pertama salah: %+v", out[0])
	}
	if out[1].Gender != "P" || !out[1].OK {
		t.Fatalf("normalisasi perempuan gagal: %+v", out[1])
	}
	if out[2].OK {
		t.Fatalf("nama pendek harus gagal: %+v", out[2])
	}
	if out[3].OK {
		t.Fatalf("gender salah harus gagal: %+v", out[3])
	}
	if out[4].OK {
		t.Fatalf("kelas kosong harus gagal: %+v", out[4])
	}
	if out[5].OK || !contains(out[5].Errors, "Duplikat nama+kelas dalam berkas") {
		t.Fatalf("duplikat nama+kelas harus terdeteksi: %+v", out[5])
	}
	if out[6].OK || !contains(out[6].Errors, "NIS duplikat dalam berkas") {
		t.Fatalf("duplikat NIS harus terdeteksi: %+v", out[6])
	}
	for _, r := range out {
		if r.OK && len(r.Errors) != 0 {
			t.Fatalf("baris ok tapi ada errors: %+v", r)
		}
	}
}

func TestParseImportRowsNoHeader(t *testing.T) {
	rows := [][]string{
		{"Budi Santoso", "L", "X IPA 1", "001"},
		{"Siti Aminah", "P", "X IPA 2", "002"},
	}
	out := parseImportRows(rows)
	if len(out) != 2 || !out[0].OK || !out[1].OK {
		t.Fatalf("tanpa header semua baris harus data valid: %+v", out)
	}
	if out[0].Line != 1 {
		t.Fatalf("line harus 1 untuk file tanpa header, dapat %d", out[0].Line)
	}
}

func contains(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}

func TestParseIntDefault(t *testing.T) {
	if parseIntDefault("", 30, 1, 200) != 30 {
		t.Fatal("default")
	}
	if parseIntDefault("abc", 30, 1, 200) != 30 {
		t.Fatal("invalid -> default")
	}
	if parseIntDefault("500", 30, 1, 200) != 200 {
		t.Fatal("cap max")
	}
	if parseIntDefault("0", 30, 1, 200) != 1 {
		t.Fatal("cap min")
	}
	if parseIntDefault("7", 30, 1, 200) != 7 {
		t.Fatal("normal")
	}
}

func TestCSVBytes(t *testing.T) {
	body, err := csvBytes([]string{"A", "B"}, [][]string{{"1", "2"}})
	if err != nil {
		t.Fatal(err)
	}
	if !startsWith(string(body), "\xEF\xBB\xBFA;B\n1;2\n") {
		t.Fatalf("csv salah: %q", string(body))
	}
}

func TestLowerKey(t *testing.T) {
	if lowerKey("  X IPA 1 ") != "x ipa 1" {
		t.Fatal("lowerKey")
	}
}
