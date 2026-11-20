package questionsets

import (
	"crypto/rand"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// Batas unggahan media per tenant: 1 GB (PRD 3.2).
const maxUploadBytes = 20 << 20 // 20 MB per berkas

// ekstensi ↔ Content-Type yang diizinkan (jpg/png/gif/webp/mp3/wav/ogg).
var allowedMedia = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".gif": "image/gif", ".webp": "image/webp",
	".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
}

// xlsx tidak; media: POST /media/upload (multipart "file") → validasi tipe &
// size ≤ 20MB; kuota penyimpanan 1GB/tenant via tenants.media_bytes_used
// (update on write; 400 STORAGE_EXCEEDED bila lebih) → simpan ke
// {UPLOAD_DIR}/<tenant_id>/<UUID>.<ext> → 201 {data:{url,...}}.
func (m *Module) uploadMedia(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(maxUploadBytes + (1 << 20)); err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION",
			"Total form-data melebihi 20 MB atau tidak valid"))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Berkas 'file' tidak ada pada form-data"))
		return
	}
	defer file.Close()
	if header.Size > maxUploadBytes {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Ukuran berkas melebihi 20 MB"))
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	contentType, known := allowedMedia[ext]
	if !known {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION",
			"Tipe berkas tidak didukung (jpg/png/gif/webp/mp3/wav/ogg)"))
		return
	}
	// batasi maksimal 20MB + cek tipe asli berkas (bukan sekadar nama).
	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Berkas terlalu besar (batas 20 MB)"))
		return
	}
	if len(data) > maxUploadBytes {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Ukuran berkas melebihi 20 MB"))
		return
	}
	if sniff := http.DetectContentType(data[:512]); sniff != contentType && !compatibleType(sniff, contentType) {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION",
			"Isi berkas tidak sesuai ekstensi (terdeteksi "+sniff+")"))
		return
	}
	var info mediaInfo
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var used int64
		if err := tx.QueryRow(r.Context(), `SELECT media_bytes_used FROM tenants WHERE id=$1 FOR UPDATE`, tenantID).
			Scan(&used); err != nil {
			return err
		}
		if used+int64(len(data)) > m.a.Cfg.StorageMediaPerTenantBytes {
			return httpx.NewErr(http.StatusBadRequest, "STORAGE_EXCEEDED",
				"Penyimpanan media tenant penuh (batas 1 GB)")
		}
		uuid, err := newUUIDv4()
		if err != nil {
			return err
		}
		name := uuid + ext
		dir := filepath.Join(m.a.Cfg.UploadDir, tenantID)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO media(tenant_id, filename, path, size, content_type, created_by)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			tenantID, header.Filename, tenantID+"/"+name, len(data), contentType, ctxinfo.UserID(r.Context())); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `
			UPDATE tenants SET media_bytes_used = media_bytes_used + $2, updated_at=now() WHERE id=$1`,
			tenantID, len(data)); err != nil {
			return err
		}
		info = mediaInfo{
			URL:         "/api/v1/media/" + tenantID + "/" + name,
			Filename:    header.Filename,
			Size:        int64(len(data)),
			ContentType: contentType,
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.Created(w, map[string]any{"data": info})
}

// compatibleType menoleransi variasi sniff (mis. x-wav, "text/plain; charset…" → ogg).
func compatibleType(sniff, declared string) bool {
	sniff = strings.TrimSpace(strings.SplitN(sniff, ";", 2)[0])
	if sniff == declared {
		return true
	}
	switch declared {
	case "audio/wav":
		return sniff == "audio/x-wav" || sniff == "audio/vnd.wave"
	case "audio/ogg":
		return sniff == "application/ogg" || strings.HasPrefix(sniff, "application/ogg")
	case "image/jpeg":
		return sniff == "image/jpg"
	}
	return false
}

// GET /media/* — baca berkas + set Content-Type; berkas di luar UPLOAD_DIR
// dilarang (path traversal di-block), tanpa listing direktori.
func (m *Module) serveMedia(w http.ResponseWriter, r *http.Request) {
	c := ctxinfo.Claims(r.Context())
	rel := r.URL.Path
	if i := strings.Index(rel, "/media/"); i >= 0 {
		rel = rel[i+len("/media/"):]
	}
	clean := path.Clean("/" + rel) // "/<tenant>/<file>"
	if clean == "/" || strings.Contains(clean, "..") {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	tenant := strings.TrimPrefix(clean, "/")
	if i := strings.IndexByte(tenant, '/'); i > 0 {
		tenant = tenant[:i]
	} else {
		httpx.Error(w, httpx.ErrNotFound)
		return
	}
	// segmen tenant harus milik pemanggil (superadmin tanpa tenant tetap boleh).
	if c != nil && c.TenantID != "" && c.TenantID != tenant {
		httpx.Error(w, httpx.ErrForbidden)
		return
	}
	r2 := r.Clone(r.Context())
	r2.URL.Path = clean // FileServer membersihkan ".." sendiri; root terkunci http.Dir.
	http.FileServer(noDir{http.Dir(m.a.Cfg.UploadDir)}).ServeHTTP(w, r2)
}

// noDir membungkus http.Dir agar direktori menghasilkan 404 (tanpa listing).
type noDir struct{ root http.Dir }

func (n noDir) Open(name string) (http.File, error) {
	f, err := n.root.Open(name)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if st.IsDir() {
		f.Close()
		return nil, fs.ErrNotExist
	}
	return f, nil
}

// newUUIDv4 menghasilkan UUID v4 acak (crypto/rand) tanpa dependensi eksternal.
func newUUIDv4() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // versi 4
	b[8] = (b[8] & 0x3f) | 0x80 // varian RFC 4122
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
