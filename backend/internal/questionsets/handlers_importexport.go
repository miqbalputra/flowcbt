package questionsets

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/xuri/excelize/v2"
)

// Kolom template import/export soal (PRD §18.2 + stimulus & scoring_mode):
// tipe, pertanyaan, stimulus, opsi_A..opsi_E, kunci, poin, scoring_mode, pembahasan.
var templateHeader = []string{
	"tipe", "pertanyaan", "stimulus", "opsi_A", "opsi_B", "opsi_C",
	"opsi_D", "opsi_E", "kunci", "poin", "scoring_mode", "pembahasan",
}

// alias tipe template (§18.2) ↔ tipe internal DB.
var typeFromTemplate = map[string]string{
	"pg": "mcq", "mcq": "mcq",
	"pg_kompleks": "mcq_complex", "mcq_complex": "mcq_complex",
	"menjodohkan": "matching", "matching": "matching",
	"isian": "short_answer", "short_answer": "short_answer",
	"uraian": "essay", "essay": "essay",
}

var typeToTemplate = map[string]string{
	"mcq": "pg", "mcq_complex": "pg_kompleks", "matching": "menjodohkan",
	"short_answer": "isian", "essay": "uraian",
}

// pasangan menjodohkan diekspor ke kolom kunci sebagai "kiri|kanan;kiri|kanan";
// opsi_A hanya penanda format (sesuai §18.2) dan diabaikan saat import.
const matchingOpsiADesc = "pasangan kiri|kanan; dipisah ';'"

type templateRow struct {
	Line        int    // nomor baris xlsx (header = 1)
	Type        string // tipe internal (mcq/mcq_complex/...)
	Pertanyaan  string
	Stimulus    string
	Opts        map[string]string // opsi_A..opsi_E (huruf besar)
	Kunci       string
	Points      float64
	ScoringMode string
	Pembahasan  string
}

type templateFile struct {
	File     multipart.File
	Filename string
	Rows     [][]string
}

// GET /question-sets/import/template — xlsx header + baris contoh 5 tipe.
func (m *Module) importTemplate(w http.ResponseWriter, _ *http.Request) {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	cell := func(row, col int, val string) {
		name, _ := excelize.ColumnNumberToName(col)
		_ = f.SetCellValue(sheet, name+strconv.Itoa(row), val)
	}
	for i, h := range templateHeader {
		cell(1, i+1, h)
	}
	examples := [][]string{
		{"pg", "Ibu kota Indonesia?", "", "Jakarta", "Bandung", "Medan", "Surabaya", "", "A", "2", "", "—"},
		{"pg_kompleks", "Pilih bilangan prima", "", "2", "4", "5", "9", "", "A,C", "3", "", "—"},
		{"menjodohkan", "Pasangkan negara–ibu kota", "", matchingOpsiADesc, "", "", "",
			"Indonesia|Jakarta;Jepang|Tokyo", "4", "", "—"},
		{"isian", "7 + 8 = …", "", "", "", "", "", "", "15;15.0", "2", "", "—"},
		{"uraian", "Jelaskan proses fotosintesis", "", "", "", "", "", "",
			"Jelaskan tahapan reaksi terang dan gelap (rubrik)", "10", "", "—"},
	}
	for i, row := range examples {
		for j, v := range row {
			cell(i+2, j+1, v)
		}
	}
	_ = f.SetColWidth(sheet, "A", "L", 26)
	writeXLSX(w, f, "template-import-soal.xlsx")
}

// POST /question-sets/import (multipart: file; fields: subject_name, title,
// exam_code?) — parse → validasi → buat set draft + soal draft (data dirapi)
// → 201 {data:{set_id, questions_created, errors_per_line?[]}}.
func (m *Module) importSets(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	tf, err := readTemplateFile(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	defer tf.File.Close()
	var req struct {
		SubjectName string `form:"subject_name" validate:"required,min=2"`
		Title       string `form:"title" validate:"required,min=3"`
		ExamCode    string `form:"exam_code" validate:"omitempty,max=40"`
	}
	req.SubjectName = strings.TrimSpace(r.FormValue("subject_name"))
	req.Title = strings.TrimSpace(r.FormValue("title"))
	req.ExamCode = strings.TrimSpace(r.FormValue("exam_code"))
	if err := m.a.V.Struct(req); err != nil {
		httpx.Error(w, &httpx.APIError{Status: http.StatusBadRequest, Code: "VALIDATION",
			Message: "Validasi gagal", Details: validationDetails(err)})
		return
	}
	parsed, lineErrs := parseTemplateRows(tf.Rows)
	valid := []templateRow{}
	for _, tr := range parsed {
		if _, _, _, _, _, _, verr := tr.toQuestion(); verr != nil {
			lineErrs = appendLineErr(lineErrs, tr.Line, verr.Error())
			continue
		}
		valid = append(valid, tr)
	}
	if len(valid) == 0 {
		httpx.Error(w, &httpx.APIError{Status: http.StatusBadRequest, Code: "VALIDATION",
			Message: "Tidak ada baris soal yang valid (perbaiki lalu unggah ulang)",
			Details: map[string]any{"errors_per_line": lineErrs}})
		return
	}
	c := ctxinfo.Claims(r.Context())
	var setID, code string
	created := 0
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if req.ExamCode != "" {
			var dupe int
			if err := tx.QueryRow(r.Context(),
				`SELECT COUNT(1) FROM question_sets WHERE tenant_id=$1 AND exam_code=$2`,
				tenantID, req.ExamCode).Scan(&dupe); err != nil {
				return err
			}
			if dupe > 0 {
				return httpx.NewErr(http.StatusConflict, "EXAM_CODE_TAKEN", "Kode ujian sudah dipakai paket lain")
			}
		}
		var lastErr error
		for attempt := 0; attempt < 8; attempt++ {
			if req.ExamCode == "" {
				tok, gerr := generateExamCode()
				if gerr != nil {
					return gerr
				}
				code = tok
			} else {
				code = req.ExamCode
			}
			err := tx.QueryRow(r.Context(), `
				INSERT INTO question_sets(tenant_id, subject_name, title, exam_code, status, created_by)
				VALUES ($1,$2,$3,$4,'draft',$5) RETURNING id`,
				tenantID, req.SubjectName, req.Title, code, c.UserID).Scan(&setID)
			if err == nil {
				break
			}
			var pgErr *pgconn.PgError
			if req.ExamCode != "" || !errors.As(err, &pgErr) || pgErr.Code != "23505" {
				return err
			}
			lastErr = err // tabrakan kode otomatis: coba kode lain
		}
		if lastErr != nil {
			return lastErr
		}
		// kolom 'stimulus' = title stimulus; dipakai bila sudah ada, dibuat bila belum.
		stimByTitle := map[string]string{}
		stimRows, err := tx.Query(r.Context(),
			`SELECT title, id::text FROM stimuli WHERE question_set_id=$1`, setID)
		if err != nil {
			return err
		}
		for stimRows.Next() {
			var title, sid string
			if err := stimRows.Scan(&title, &sid); err != nil {
				stimRows.Close()
				return err
			}
			stimByTitle[strings.ToLower(title)] = sid
		}
		if err := stimRows.Err(); err != nil {
			return err
		}
		stimRows.Close()
		for i, tr := range valid {
			typ, optionsRaw, keyRaw, points, scoringMode, stimTitle, verr := tr.toQuestion()
			if verr != nil { // sudah lolos validasi di atas; jaga-jaga saja
				lineErrs = appendLineErr(lineErrs, tr.Line, verr.Error())
				continue
			}
			var stimulusID *string
			if stimTitle != "" {
				sid, found := stimByTitle[strings.ToLower(stimTitle)]
				if !found {
					var sidNew string
					if err := tx.QueryRow(r.Context(), `
						INSERT INTO stimuli(tenant_id, question_set_id, title)
						VALUES ($1,$2,$3) RETURNING id::text`,
						tenantID, setID, stimTitle).Scan(&sidNew); err != nil {
						return err
					}
					stimByTitle[strings.ToLower(stimTitle)] = sidNew
					sid = sidNew
				}
				stimulusID = &sid
			}
			if _, err := tx.Exec(r.Context(), `
				INSERT INTO questions(tenant_id, question_set_id, order_no, type, stimulus_id, body,
					options, answer_key, points, scoring_mode, explanation, shuffle_options)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)`,
				tenantID, setID, i+1, typ, stimulusID, sanitizeVar(tr.Pertanyaan),
				optionsRaw, keyRaw, points, scoringMode,
				sanitizeVar(tr.Pembahasan)); err != nil {
				return err
			}
			created++
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.Created(w, map[string]any{"data": map[string]any{
		"set_id": setID, "exam_code": code, "questions_created": created,
		"file": tf.Filename, "errors_per_line": lineErrs}})
}

// readTemplateFile membaca multipart "file" (xlsx, ≤20MB) → baris sheet pertama.
func readTemplateFile(r *http.Request) (*templateFile, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, 21<<20)
	if err := r.ParseMultipartForm(21 << 20); err != nil {
		return nil, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Form-data unggahan terlalu besar / tidak valid")
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return nil, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Berkas 'file' tidak ada pada form-data")
	}
	fx, err := excelize.OpenReader(file)
	if err != nil {
		file.Close()
		return nil, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Bukan berkas .xlsx yang valid")
	}
	sheet := "Sheet1"
	if names := fx.GetSheetList(); len(names) > 0 {
		sheet = names[0]
	}
	rows, err := fx.GetRows(sheet)
	if err != nil {
		file.Close()
		return nil, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Sheet pertama tidak bisa dibaca")
	}
	name := "import.xlsx"
	if header != nil && header.Filename != "" {
		name = header.Filename
	}
	return &templateFile{File: file, Filename: name, Rows: rows}, nil
}

// parseTemplateRows membaca baris data template. Header divalidasi sekali;
// baris rusak dilaporkan per-baris (errors_per_line, line = nomor baris).
func parseTemplateRows(rows [][]string) (out []templateRow, lineErrs []map[string]string) {
	if len(rows) == 0 {
		return nil, appendLineErr(nil, 1, "file kosong / sheet pertama tidak berisi data")
	}
	idx := map[string]int{}
	for j, h := range rows[0] {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			idx[h] = j
		}
	}
	for _, h := range templateHeader {
		if _, ok := idx[h]; !ok {
			return nil, appendLineErr(nil, 1, "kolom '"+h+"' tidak ada — gunakan template apa adanya")
		}
	}
	for i, row := range rows[1:] {
		line := i + 2
		blank := true
		for _, c := range row {
			if strings.TrimSpace(c) != "" {
				blank = false
				break
			}
		}
		if blank {
			continue
		}
		tt := strings.ToLower(cellOf(row, idx, "tipe"))
		typ, ok := typeFromTemplate[tt]
		if !ok {
			lineErrs = appendLineErr(lineErrs, line, "tipe tidak dikenal: "+tt)
			continue
		}
		pertanyaan := cellOf(row, idx, "pertanyaan")
		if pertanyaan == "" {
			lineErrs = appendLineErr(lineErrs, line, "pertanyaan kosong")
			continue
		}
		kunci := cellOf(row, idx, "kunci")
		points := 1.0
		if s := cellOf(row, idx, "poin"); s != "" {
			v, err := strconv.ParseFloat(s, 64)
			if err != nil || v <= 0 {
				lineErrs = appendLineErr(lineErrs, line, "poin tidak valid: "+s)
				continue
			}
			points = v
		}
		out = append(out, templateRow{
			Line: line, Type: typ, Pertanyaan: pertanyaan,
			Stimulus:    cellOf(row, idx, "stimulus"),
			Opts:        opsiRow(row, idx),
			Kunci:       kunci,
			Points:      points,
			ScoringMode: strings.ToLower(cellOf(row, idx, "scoring_mode")),
			Pembahasan:  cellOf(row, idx, "pembahasan"),
		})
	}
	return out, lineErrs
}

func appendLineErr(into []map[string]string, line int, msg string) []map[string]string {
	if into == nil {
		into = []map[string]string{}
	}
	return append(into, map[string]string{"line": strconv.Itoa(line), "message": msg})
}

// cellOf mengambil nilai kolom bernama dari baris template.
func cellOf(row []string, idx map[string]int, name string) string {
	if j, ok := idx[name]; ok && j < len(row) {
		return strings.TrimSpace(row[j])
	}
	return ""
}

// opsiRow mengambil opsi_A..opsi_E dari baris.
func opsiRow(row []string, idx map[string]int) map[string]string {
	opts := map[string]string{}
	for _, letter := range []string{"A", "B", "C", "D", "E"} {
		if v := cellOf(row, idx, "opsi_"+strings.ToLower(letter)); v != "" {
			opts[letter] = v
		}
	}
	return opts
}

// toQuestion mengubah baris template menjadi (type, options, answer_key,
// points, scoring_mode, stimulus_title, err) siap validasi.
func (tr templateRow) toQuestion() (typ, optionsRaw, keyRaw string, points float64,
	scoringMode, stimTitle string, err error) {
	points = tr.Points
	scoringMode = tr.ScoringMode
	if scoringMode != modePartial {
		scoringMode = modeAllOrNothing
	}
	stimTitle = tr.Stimulus
	trimSlash := func(s string) string { return strings.TrimSpace(strings.Trim(s, `"'`)) }
	switch tr.Type {
	case "mcq", "mcq_complex":
		options := []questionOption{}
		for _, letter := range []string{"A", "B", "C", "D", "E"} {
			if txt, ok := tr.Opts[letter]; ok {
				options = append(options, questionOption{ID: letter, Text: txt})
			}
		}
		if b, jerr := json.Marshal(options); jerr == nil {
			optionsRaw = string(b)
		}
		if tr.Type == "mcq" {
			key := strings.ToUpper(trimSlash(tr.Kunci))
			if len(key) != 1 || key < "A" || key > "E" {
				return "", "", "", 0, "", "", fmt.Errorf("kunci %q harus satu huruf A-E untuk pg", tr.Kunci)
			}
			b, _ := json.Marshal(map[string]string{"correct": key})
			keyRaw = string(b)
			scoringMode = modeAllOrNothing
			break
		}
		correct := []string{}
		for _, s := range strings.Split(tr.Kunci, ",") {
			if s = trimSlash(s); s != "" {
				correct = append(correct, s)
			}
		}
		if len(correct) == 0 {
			return "", "", "", 0, "", "", errors.New("kunci kosong; isikan huruf dipisah koma, mis. A,C")
		}
		b, _ := json.Marshal(map[string][]string{"correct": correct})
		keyRaw = string(b)
	case "matching":
		// pasangan hanya dari kolom kunci: "kiri|kanan;kiri|kanan" (4-6 pasangan).
		type pairRaw struct{ left, right string }
		var pairs []pairRaw
		for _, chunk := range strings.Split(trimSlash(tr.Kunci), ";") {
			kv := strings.SplitN(chunk, "|", 2)
			if len(kv) != 2 || strings.TrimSpace(kv[0]) == "" || strings.TrimSpace(kv[1]) == "" {
				return "", "", "", 0, "", "", errors.New(
					"kunci menjodohkan harus 'kiri|kanan' dipisah ';' (4-6 pasangan)")
			}
			pairs = append(pairs, pairRaw{left: strings.TrimSpace(kv[0]), right: strings.TrimSpace(kv[1])})
		}
		left, right := []string{}, []string{}
		seenL, seenR := map[string]bool{}, map[string]bool{}
		pairsOut := []pair{}
		seenPair := map[string]bool{}
		for _, pr := range pairs {
			if !seenL[pr.left] {
				left = append(left, pr.left)
				seenL[pr.left] = true
			}
			if !seenR[pr.right] {
				right = append(right, pr.right)
				seenR[pr.right] = true
			}
			if seenPair[pr.left] {
				return "", "", "", 0, "", "", fmt.Errorf("kiri %q dipasangkan dua kali", pr.left)
			}
			seenPair[pr.left] = true
			pairsOut = append(pairsOut, pair{Left: pr.left, Right: pr.right})
		}
		ob, _ := json.Marshal(matchOptions{Left: left, Right: right})
		kb, _ := json.Marshal(map[string]any{"pairs": pairsOut})
		optionsRaw, keyRaw = string(ob), string(kb)
	case "short_answer":
		answers := []string{}
		for _, v := range strings.Split(tr.Kunci, ";") {
			if v = trimSlash(v); v != "" {
				answers = append(answers, v)
			}
		}
		if len(answers) == 0 {
			return "", "", "", 0, "", "", errors.New("kunci kosong; isikan variasi jawaban dipisah ';'")
		}
		b, _ := json.Marshal(map[string][]string{"answers": answers})
		keyRaw = string(b)
		scoringMode = modeAllOrNothing
	default: // essay
		b, _ := json.Marshal(map[string]string{"rubric": trimSlash(tr.Kunci)})
		keyRaw = string(b)
		scoringMode = modeAllOrNothing
	}
	return tr.Type, optionsRaw, keyRaw, points, scoringMode, stimTitle, nil
}

func chiSetID(r *http.Request) string { return chi.URLParam(r, "setID") }

// exportQuestion adalah baris soal kerja untuk file ekspor xlsx.
type exportQuestion struct {
	typ, body, options, key, scoring, explanation string
	points                                        float64
	stimID                                        *string
}

// GET /question-sets/{id}/export — xlsx terisi (format = template) + kunci.
func (m *Module) exportSet(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := m.tenant(w, r)
	if !ok {
		return
	}
	setID := chiSetID(r)
	var examCode string
	var rows []exportQuestion
	stimTitles := map[string]string{}
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(),
			`SELECT exam_code FROM question_sets WHERE id=$1`, setID).Scan(&examCode); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.ErrNotFound
			}
			return err
		}
		qRows, err := tx.Query(r.Context(), `
			SELECT type, body, options::text, answer_key::text, points, scoring_mode, explanation, stimulus_id
			FROM questions WHERE question_set_id=$1 AND set_version_id IS NULL ORDER BY order_no`, setID)
		if err != nil {
			return err
		}
		defer qRows.Close()
		rows = []exportQuestion{}
		for qRows.Next() {
			var (
				q   exportQuestion
				opt map[string]any
			)
			if err := qRows.Scan(&q.typ, &q.body, &opt, &q.key, &q.points, &q.scoring,
				&q.explanation, &q.stimID); err != nil {
				return err
			}
			q.options = jsonRaw(opt)
			rows = append(rows, q)
		}
		if err := qRows.Err(); err != nil {
			return err
		}
		rows2, err := tx.Query(r.Context(), `SELECT id::text, title FROM stimuli WHERE question_set_id=$1`, setID)
		if err != nil {
			return err
		}
		defer rows2.Close()
		for rows2.Next() {
			var sid, title string
			if err := rows2.Scan(&sid, &title); err != nil {
				return err
			}
			stimTitles[sid] = title
		}
		return rows2.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	for i, h := range templateHeader {
		col, _ := excelize.ColumnNumberToName(i + 1)
		_ = f.SetCellValue(sheet, col+"1", h)
	}
	for i, q := range rows {
		writeQuestionRow(f, sheet, i+2, q, stimTitles)
	}
	_ = f.SetColWidth(sheet, "A", "L", 26)
	writeXLSX(w, f, examCode+".xlsx")
}

// writeQuestionRow menulis satu soal ke baris xlsx sesuai format template.
func writeQuestionRow(f *excelize.File, sheet string, rowNo int, q exportQuestion, stimTitles map[string]string) {
	cell := func(col int, val string) {
		if val == "" {
			return
		}
		name, _ := excelize.ColumnNumberToName(col)
		_ = f.SetCellValue(sheet, name+strconv.Itoa(rowNo), val)
	}
	cell(1, typeToTemplate[q.typ])
	cell(2, htmlToText(q.body))
	if q.stimID != nil {
		cell(3, stimTitles[*q.stimID])
	}
	var orderOptions []questionOption
	var mcqKey answerMCQ
	var multiKey answerMCQMulti
	var matchOpts matchOptions
	var matchKey answerPairs
	var listKey answerList
	var rubricKey answerRubric
	switch q.typ {
	case "mcq", "mcq_complex":
		if parseJSON(q.options, &orderOptions) == nil {
			for i, o := range orderOptions {
				if i == 5 {
					break
				}
				cell(4+i, o.Text)
			}
		}
		if q.typ == "mcq" {
			if parseJSON(q.key, &mcqKey) == nil {
				cell(9, strings.ToUpper(mcqKey.Correct))
			}
			break
		}
		if parseJSON(q.key, &multiKey) == nil {
			letters := []string{}
			for _, l := range multiKey.Correct {
				letters = append(letters, strings.ToUpper(l))
			}
			cell(9, strings.Join(letters, ","))
		}
	case "matching":
		_ = parseJSON(q.options, &matchOpts)
		if parseJSON(q.key, &matchKey) == nil {
			parts := []string{}
			for _, p := range matchKey.Pairs {
				parts = append(parts, p.Left+"|"+p.Right)
			}
			cell(9, strings.Join(parts, ";"))
		}
		cell(4, matchingOpsiADesc) // penanda format; diabaikan saat import
	case "short_answer":
		if parseJSON(q.key, &listKey) == nil {
			cell(9, strings.Join(listKey.Answers, ";"))
		}
	default: // essay
		if parseJSON(q.key, &rubricKey) == nil {
			cell(9, rubricKey.Rubric)
		}
	}
	if q.scoring == modePartial {
		cell(11, modePartial)
	} else {
		cell(11, "")
	}
	cell(12, htmlToText(q.explanation))
}

// formatPoints menampilkan poin tanpa nol desimal berlebih.
func formatPoints(p float64) string {
	if p == float64(int(p)) {
		return strconv.Itoa(int(p))
	}
	return strconv.FormatFloat(p, 'f', -1, 64)
}

// htmlToText mengubah HTML tersanitasi menjadi teks polos utk template
// (baris/pemisah blok jadi baris baru; entitas di-decode).
func htmlToText(s string) string {
	s = sanitizeHTML(s)
	s = blockSeparator.ReplaceAllString(s, "\n")
	return html.UnescapeString(strings.TrimSpace(stripTags.ReplaceAllString(s, "")))
}

// writeXLSX menuliskan workbook ke respons sebagai unduhan .xlsx.
func writeXLSX(w http.ResponseWriter, f *excelize.File, filename string) {
	buf, err := f.WriteToBuffer()
	if err != nil {
		httpx.Error(w, err)
		return
	}
	w.Header().Set("Content-Type",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	_, _ = w.Write(buf.Bytes())
}

// jsonRaw merekam nilai menjadi string JSON utk kolom JSONB (kosong → '{}').
func jsonRaw(val any) string {
	if val == "" {
		return "{}"
	}
	b, err := json.Marshal(val)
	if err != nil {
		return "{}"
	}
	return string(b)
}

var (
	blockSeparator = regexp.MustCompile(`(?is)\s*<(?:br\b|/p|/li|/tr|/table|/thead|/tbody)[^>]*>\s*`)
	stripTags      = regexp.MustCompile(`<[^>]*>`)
)
