package cards

import (
	"regexp"
	"testing"
)

// nomor generasi baru: TS<yy>-XXXX-C, contoh "TS26-7K4Q-9".
var reNewNumber = regexp.MustCompile(`^TS\d{2}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$`)

func TestBuildNumberFormatAndCheck(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		n := buildNumber(&schoolProfile{}, "00000000-0000-0000-0000-000000000000", 2026, 0)
		if !reNewNumber.MatchString(n) {
			t.Fatalf("format salah: %q", n)
		}
		if !ValidateParticipantNumber(n) {
			t.Fatalf("check char tidak valid utk %q", n)
		}
		// tanpa strip juga harus divalidasi (cara siswa mengetik bebas)
		if !ValidateParticipantNumber(rejectDash(n)) {
			t.Fatalf("tanpa strip tidak valid: %q", n)
		}
		if seen[n] {
			// tabrakan 32^4 dalam 2000 sampel sangat jarang; keunikan dijamin
			// constraint DB + retry, bukan tes; jadi hanya catat.
			t.Logf("duplikat dalam sampel (boleh, unik dijamin DB): %q", n)
		}
		seen[n] = true
	}
}

func TestCheckCharDetectsTamper(t *testing.T) {
	n := buildNumber(&schoolProfile{}, "00000000-0000-0000-0000-000000000000", 2026, 0)
	alphabet := "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	bad := 0
	for _, pos := range []int{5, 6, 7, 8} {
		for _, c := range alphabet {
			cb := byte(c)
			b := []byte(n)
			if b[pos] == cb {
				continue
			}
			b[pos] = cb
			if !ValidateParticipantNumber(string(b)) {
				bad++
			} else {
				t.Fatalf("subst %d→%c tidak terdeteksi pada %q", pos, c, n)
			}
		}
	}
	if bad == 0 {
		t.Fatal("tidak ada substitusi yang diuji")
	}
}

func TestLegacyNumberRejectedByNewValidator(t *testing.T) {
	if ValidateParticipantNumber("TA-26-03-10-0028-0001-2") {
		t.Fatal("nomor lama TA-… tidak boleh lolos validator TS")
	}
	if ValidateParticipantNumber("TS26-7K4Q") { // tanpa check char
		t.Fatal("nomor tanpa check char harus ditolak")
	}
}

func rejectDash(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '-' {
			out = append(out, s[i])
		}
	}
	return string(out)
}
