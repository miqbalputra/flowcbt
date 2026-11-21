package cards

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------------- tipe data ----------------

// schoolProfile identitas sekolah untuk kepala kartu & tanda tangan.
type schoolProfile struct {
	Name          string `json:"name"`
	Address       string `json:"address"`
	City          string `json:"city"`
	PrincipalName string `json:"principal_name"`
	PrincipalNIP  string `json:"principal_nip"`
	RegionCode    string `json:"region_code"`
	SchoolCode    string `json:"school_code"`
	Timezone      string `json:"-"`
}

// examMeta data ujian yang tercetak di kartu & pesan WhatsApp.
type examMeta struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	SubjectName string    `json:"subject_name"`
	ExamCode    string    `json:"exam_code"`
	Token       string    `json:"token"`
	Status      string    `json:"status"`
	OpenAt      time.Time `json:"open_at"`
	CloseAt     time.Time `json:"close_at"`
	Duration    int       `json:"duration_minutes"`
}

// cardRow satu peserta + nomor peserta + teks WhatsApp.
type cardRow struct {
	StudentID   string `json:"student_id"`
	StudentCode string `json:"student_code"`
	NIS         string `json:"nis"`
	Name        string `json:"name"`
	ClassName   string `json:"class_name"`
	BirthPlace  string `json:"birth_place"`
	BirthDate   string `json:"birth_date"` // YYYY-MM-DD / kosong
	School      string `json:"school"`
	Phone       string `json:"phone"`
	PhotoURL    string `json:"photo_url"`
	Number      string `json:"number"`
	WhatsApp    string `json:"whatsapp"`
}

// ---------------- query ----------------

const examMetaSQL = `
SELECT e.id::text, e.name, e.subject_name, e.exam_code, e.token, e.status,
       e.open_at, e.close_at, e.duration_minutes
FROM exams e WHERE e.id = $1`

func loadExam(ctx context.Context, tx pgx.Tx, examID string) (*examMeta, error) {
	var e examMeta
	err := tx.QueryRow(ctx, examMetaSQL, examID).Scan(&e.ID, &e.Name, &e.SubjectName,
		&e.ExamCode, &e.Token, &e.Status, &e.OpenAt, &e.CloseAt, &e.Duration)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

const schoolProfileSQL = `
SELECT name, address, city, principal_name, principal_nip, region_code, school_code, timezone
FROM tenants WHERE id = $1`

func loadSchoolProfile(ctx context.Context, tx pgx.Tx, tenantID string) (*schoolProfile, error) {
	var p schoolProfile
	err := tx.QueryRow(ctx, schoolProfileSQL, tenantID).Scan(&p.Name, &p.Address, &p.City,
		&p.PrincipalName, &p.PrincipalNIP, &p.RegionCode, &p.SchoolCode, &p.Timezone)
	if err != nil {
		return nil, err
	}
	if p.Timezone == "" {
		p.Timezone = "Asia/Jakarta"
	}
	return &p, nil
}

// participantsSQL — aturan peserta sama dengan modul exams/reports:
// assignment ada → siswa pada kelas/siswa yang ditugaskan; assignment kosong →
// semua siswa aktif tenant.
const participantsSQL = `
SELECT s.id::text, s.student_code, COALESCE(s.nis,''), s.name,
       COALESCE(c.name,''), s.birth_place,
       COALESCE(to_char(s.birth_date,'YYYY-MM-DD'),''),
       COALESCE(s.photo_url,''),
       COALESCE(NULLIF(s.phone,''), COALESCE(s.parent_phone,''))
FROM students s
LEFT JOIN classes c ON c.id = s.class_id
WHERE s.status = 'active' AND s.is_guest = false AND s.merged_into_id IS NULL
  AND (
    NOT EXISTS (SELECT 1 FROM exam_assignments ea0 WHERE ea0.exam_id = $1)
    OR EXISTS (SELECT 1 FROM exam_assignments ea WHERE ea.exam_id = $1 AND ea.target_type='student' AND ea.student_id = s.id)
    OR s.class_id IN (SELECT ea2.class_id FROM exam_assignments ea2 WHERE ea2.exam_id = $1 AND ea2.target_type='class')
  )
ORDER BY COALESCE(c.name,'zzz'), s.name, s.id`

func loadParticipants(ctx context.Context, tx pgx.Tx, tenantID, examID string) ([]cardRow, error) {
	rows, err := tx.Query(ctx, participantsSQL, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cardRow{}
	for rows.Next() {
		var c cardRow
		if err := rows.Scan(&c.StudentID, &c.StudentCode, &c.NIS, &c.Name, &c.ClassName,
			&c.BirthPlace, &c.BirthDate, &c.PhotoURL, &c.Phone); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// timeNow — jam sekarang (variabel agar bisa dipalsukan saat uji).
var timeNow = time.Now

// ---------------- nomor peserta ----------------

// digitsOnly mengambil digit dari string ("03-10" → "0310").
func digitsOnly(s string) string {
	var b strings.Builder
	for _, c := range s {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// luhnDigit menghitung check digit Luhn (0-9) dari deretan angka.
func luhnDigit(digits string) string {
	sum, alt := 0, false
	for i := len(digits) - 1; i >= 0; i-- {
		c := digits[i]
		if c < '0' || c > '9' {
			continue
		}
		d := int(c - '0')
		if alt {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		alt = !alt
	}
	return string(rune('0' + (10-sum%10)%10))
}

// tenantSchoolDigits kode sekolah cadangan (4 digit) dari UUID tenant.
func tenantSchoolDigits(tenantID string) string {
	digits := digitsOnly(strings.ReplaceAll(tenantID, "-", ""))
	if len(digits) < 4 {
		return "0000"
	}
	return digits[len(digits)-4:]
}

// buildNumber menyusun nomor peserta gaya TKA:
// TA-<yy>-<kode wilayah>-<kode sekolah>-<urut 4 digit>-<check digit>.
func buildNumber(p *schoolProfile, tenantID string, year int, seq int) string {
	region := strings.TrimSpace(p.RegionCode)
	if digitsOnly(region) == "" {
		region = "00-00"
	}
	school := strings.TrimSpace(p.SchoolCode)
	if digitsOnly(school) == "" {
		school = tenantSchoolDigits(tenantID)
	}
	base := fmt.Sprintf("TA-%02d-%s-%s-%04d", year%100, region, school, seq)
	return base + "-" + luhnDigit(base)
}

// sequenceOf mengambil nomor urut dari nomor peserta (grup "0001").
func sequenceOf(number string) int {
	parts := strings.Split(number, "-")
	if len(parts) < 2 {
		return 0
	}
	n := 0
	for _, c := range parts[len(parts)-2] {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// ensureNumbers membuat nomor peserta yang belum ada (stabil: yang sudah ada
// tidak diubah) dan mengisi c.Number untuk semua peserta.
func ensureNumbers(ctx context.Context, tx pgx.Tx, tenantID, examID string, meta *examMeta,
	profile *schoolProfile, rows []cardRow, reset bool) error {

	if reset {
		if _, err := tx.Exec(ctx, `DELETE FROM exam_cards WHERE exam_id=$1`, examID); err != nil {
			return err
		}
	}

	existing := map[string]string{}
	nextSeq := 0
	crows, err := tx.Query(ctx, `SELECT student_id::text, number FROM exam_cards WHERE exam_id=$1`, examID)
	if err != nil {
		return err
	}
	for crows.Next() {
		var sid, number string
		if err := crows.Scan(&sid, &number); err != nil {
			crows.Close()
			return err
		}
		existing[sid] = number
		if s := sequenceOf(number); s > nextSeq {
			nextSeq = s
		}
	}
	crows.Close()
	if err := crows.Err(); err != nil {
		return err
	}

	year := meta.OpenAt.Year()
	for i := range rows {
		if n, ok := existing[rows[i].StudentID]; ok {
			rows[i].Number = n
			continue
		}
		for attempt := 0; attempt < 8; attempt++ {
			nextSeq++
			number := buildNumber(profile, tenantID, year, nextSeq)
			_, err := tx.Exec(ctx,
				`INSERT INTO exam_cards(tenant_id, exam_id, student_id, number) VALUES ($1,$2,$3,$4)`,
				tenantID, examID, rows[i].StudentID, number)
			if err == nil {
				rows[i].Number = number
				existing[rows[i].StudentID] = number
				break
			}
			if !isUniqueViolation(err) {
				return err
			}
			// tabrakan nomor (data lama) → lanjut ke urutan berikutnya
		}
		if rows[i].Number == "" {
			return fmt.Errorf("gagal mengalokasikan nomor peserta untuk %s", rows[i].StudentID)
		}
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// ---------------- teks WhatsApp ----------------

// waText menyusun pesan WhatsApp siap kirim (bahasa Indonesia, ringkas).
func waText(meta *examMeta, profile *schoolProfile, c cardRow, baseURL string) string {
	loc := jakartaLocation(profile.Timezone)
	jadwal := fmt.Sprintf("%s – %s WIB",
		meta.OpenAt.In(loc).Format("02 Jan 2006 15:04"),
		meta.CloseAt.In(loc).Format("02 Jan 2006 15:04"))
	ttl := formatBirth(c)
	var b strings.Builder
	b.WriteString("*KARTU PESERTA " + strings.ToUpper(meta.Name) + "*\n")
	b.WriteString(profile.Name + "\n\n")
	b.WriteString("Nama: " + strings.ToUpper(c.Name) + "\n")
	b.WriteString("Nomor Peserta: " + c.Number + "\n")
	if c.ClassName != "" {
		b.WriteString("Kelas: " + c.ClassName + "\n")
	}
	b.WriteString("Tempat/Tgl Lahir: " + ttl + "\n")
	b.WriteString("Ujian: " + meta.Name + "\n")
	b.WriteString("Jadwal: " + jadwal + "\n")
	b.WriteString("Durasi: " + fmt.Sprintf("%d menit", meta.Duration) + "\n")
	if meta.Token != "" {
		b.WriteString("Token: " + meta.Token + "\n")
	}
	if baseURL != "" && c.StudentID != "" {
		b.WriteString("\nUnduh kartu PDF:\n" + strings.TrimRight(baseURL, "/") +
			"/api/v1/exams/" + meta.ID + "/cards/" + c.StudentID + "/pdf\n")
	}
	b.WriteString("\nTunjukkan kartu ini (cetak/digital) saat ujian. Jangan bagikan token ke orang lain.")
	return b.String()
}

func jakartaLocation(tz string) *time.Location {
	if tz == "" {
		tz = "Asia/Jakarta"
	}
	if loc, err := time.LoadLocation(tz); err == nil {
		return loc
	}
	return time.FixedZone("WIB", 7*3600)
}

// formatBirth "PURBALINGGA, 05 Agustus 2013" (bagian kosong → "-").
func formatBirth(c cardRow) string {
	place := strings.ToUpper(strings.TrimSpace(c.BirthPlace))
	date := ""
	if c.BirthDate != "" {
		if t, err := time.Parse("2006-01-02", c.BirthDate); err == nil {
			date = t.Format("02") + " " + bulanID[t.Month()] + " " + t.Format("2006")
		}
	}
	switch {
	case place != "" && date != "":
		return place + ", " + date
	case place != "":
		return place
	case date != "":
		return date
	default:
		return "-"
	}
}

var bulanID = map[time.Month]string{
	time.January: "Januari", time.February: "Februari", time.March: "Maret",
	time.April: "April", time.May: "Mei", time.June: "Juni",
	time.July: "Juli", time.August: "Agustus", time.September: "September",
	time.October: "Oktober", time.November: "November", time.December: "Desember",
}

// contentDisposition header unduhan (nama file aman ASCII).
func contentDisposition(w http.ResponseWriter, filename string) {
	safe := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		case r == '-' || r == '_' || r == '.':
			return r
		default:
			return '-'
		}
	}, filename)
	w.Header().Set("Content-Disposition", `attachment; filename="`+safe+`"`)
}
