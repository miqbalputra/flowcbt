package exams

// Enkripsi foto proktor at-rest (audit P2 #3). Snapshot berisi wajah siswa —
// data pribadi yang sensitif; file di disk tidak boleh terbaca tanpa kunci.
// Format berkas: "FCBTE1\x00" + nonce(12) + ciphertext AES-256-GCM(+tag).
// Berkas lama tanpa magic prefix diteruskan apa adanya (passthrough legacy)
// sehingga migrasi tidak butuh konversi massal: baca-lama tetap jalan,
// tulis-baru selalu terenkripsi bila key dikonfigurasi.

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

const snapshotMagic = "FCBTE1\x00"

// snapshotAEAD membangun cipher AES-256-GCM dari key hex 64 karakter.
func snapshotAEAD(keyHex string) (cipher.AEAD, error) {
	raw, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, fmt.Errorf("SNAPSHOT_ENCRYPTION_KEY bukan hex valid: %w", err)
	}
	if len(raw) != 32 {
		return nil, errors.New("SNAPSHOT_ENCRYPTION_KEY harus 64 karakter hex (32 byte)")
	}
	block, err := aes.NewCipher(raw)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// encryptSnapshot mengembalikan magic+nonce+ciphertext.
func encryptSnapshot(keyHex string, plain []byte) ([]byte, error) {
	aead, err := snapshotAEAD(keyHex)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	out := make([]byte, 0, len(snapshotMagic)+len(nonce)+len(plain)+aead.Overhead())
	out = append(out, snapshotMagic...)
	out = append(out, nonce...)
	return aead.Seal(out, nonce, plain, nil), nil
}

// decryptSnapshotIfEncrypted mendekripsi bila berkas diawali magic;
// berkas legacy tanpa magic dikembalikan apa adanya.
func decryptSnapshotIfEncrypted(keyHex string, data []byte) ([]byte, error) {
	if !bytes.HasPrefix(data, []byte(snapshotMagic)) {
		return data, nil
	}
	if keyHex == "" {
		return nil, errors.New("berkas snapshot terenkripsi tapi SNAPSHOT_ENCRYPTION_KEY kosong")
	}
	aead, err := snapshotAEAD(keyHex)
	if err != nil {
		return nil, err
	}
	body := data[len(snapshotMagic):]
	ns := aead.NonceSize()
	if len(body) < ns+aead.Overhead() {
		return nil, errors.New("berkas snapshot terenkripsi terlalu pendek (korup?)")
	}
	return aead.Open(nil, body[:ns], body[ns:], nil)
}
