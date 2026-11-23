package exams

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"testing"
)

func testKey(t *testing.T) string {
	t.Helper()
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(raw)
}

func TestEncryptDecryptRoundtrip(t *testing.T) {
	key := testKey(t)
	plain := []byte("\xFF\xD8\xFFfoto-proktor-jpeg-bytes")
	enc, err := encryptSnapshot(key, plain)
	if err != nil {
		t.Fatalf("enkripsi gagal: %v", err)
	}
	if bytes.HasPrefix(enc, plain) || bytes.Equal(enc, plain) {
		t.Fatal("ciphertext sama dengan plaintext")
	}
	if !bytes.HasPrefix(enc, []byte(snapshotMagic)) {
		t.Fatal("ciphertext harus diawali magic FCBTE1")
	}
	got, err := decryptSnapshotIfEncrypted(key, enc)
	if err != nil {
		t.Fatalf("dekripsi gagal: %v", err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatal("roundtrip mengembalikan data berbeda")
	}
}

func TestDecryptLegacyPassthrough(t *testing.T) {
	plain := []byte("\xFF\xD8\xFFlegacy-jpeg-tanpa-encrypt")
	got, err := decryptSnapshotIfEncrypted(testKey(t), plain)
	if err != nil {
		t.Fatalf("berkas legacy harus diteruskan: %v", err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatal("berkas legacy tidak boleh berubah")
	}
	// key kosong pun tetap aman untuk berkas legacy
	got, err = decryptSnapshotIfEncrypted("", plain)
	if err != nil || !bytes.Equal(got, plain) {
		t.Fatal("passthrough legacy dengan key kosong harus jalan")
	}
}

func TestDecryptTamperedFails(t *testing.T) {
	key := testKey(t)
	enc, err := encryptSnapshot(key, []byte("foto-rahasia"))
	if err != nil {
		t.Fatal(err)
	}
	enc[len(enc)-1] ^= 0xFF // rusak 1 byte ciphertext
	if _, err := decryptSnapshotIfEncrypted(key, enc); err == nil {
		t.Fatal("ciphertext yang dirusak harus gagal GCM (integritas)")
	}
}

func TestDecryptEncryptedWithoutKeyFails(t *testing.T) {
	enc, err := encryptSnapshot(testKey(t), []byte("foto"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = decryptSnapshotIfEncrypted("", enc)
	if err == nil {
		t.Fatal("snapshot terenkripsi tanpa key harus error, bukan dikembalikan mentah")
	}
	if !strings.Contains(err.Error(), "SNAPSHOT_ENCRYPTION_KEY") {
		t.Fatalf("pesan error harus menyebut key: %v", err)
	}
}

func TestInvalidKeyRejected(t *testing.T) {
	for _, bad := range []string{"abc", "zz", strings.Repeat("41", 31)} {
		if _, err := encryptSnapshot(bad, []byte("x")); err == nil {
			t.Fatalf("key tidak valid harus ditolak: %q", bad)
		}
	}
}
