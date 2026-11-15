package questionbank

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
	"github.com/go-chi/chi/v5"
)

// Template import soal (PRD 18.2): tipe, pertanyaan, opsi_A..D, kunci, poin, pembahasan.
var qHeaders = []string{"tipe", "pertanyaan", "opsi_A", "opsi_B", "opsi_C", "opsi_D", "kunci", "poin", "pembahasan"}

func (s *Service) importTemplate(w http.ResponseWriter, r *http.Request) {
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	for i, h := range qHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	examples := [][]string{
		{"pg", "Ibu kota Indonesia?", "Jakarta", "Bandung", "Medan", "Surabaya", "A", "2", ""},
		{"pg_kompleks", "Pilih bilangan prima", "2", "4", "5", "9", "A,C", "3", ""},
		{"menjodohkan", "Pasangkan negara-ibu kota (opsi_A=pasangan kiri\\|kanan; pisah ; )", "Indonesia\\|Jakarta;Jepang\\|Tokyo", "", "", "", "Indonesia\\|Jakarta;Jepang\\|Tokyo", "4", ""},
		{"isian", "7 + 8 = ...", "", "", "", "", "15", "2", ""},
		{"uraian", "Jelaskan proses fotosintesis", "", "", "", "", "(rubrik di kolom ini atau kosong)", "10", ""},
	}
	for ri, row := range examples {
		for ci, v := range row {
			cell, _ := excelize.CoordinatesToCellName(ci+1, ri+2)
			f.SetCellValue(sheet, cell, v)
		}
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="template-import-soal.xlsx"`)
	_ = f.Write(w)
}

type qRow struct {
	Type, Question, OptA, OptB, OptC, OptD, Key, Points, Explanation string
}

// importSet: upload template xlsx -> preview & validasi -> simpan sebagai draft (FR-4.5).
func (s *Service) importSet(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	mr, err := r.MultipartReader()
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "unggah file .xlsx via multipart 'file'"))
		return
	}
	part, err := mr.NextPart()
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "file tidak ditemukan"))
		return
	}
	f, err := excelize.OpenReader(part)
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "file bukan .xlsx valid"))
		return
	}
	all, err := f.GetRows(f.GetSheetName(0))
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, err.Error()))
		return
	}
	type qErr struct {
		Row    int    `json:"row"`
		Reason string `json:"reason"`
	}
	var rows []qRow
	var errs []qErr
	for i, line := range all {
		rowNo := i + 1
		if rowNo == 1 {
			continue
		}
		get := func(j int) string {
			if j < len(line) {
				return strings.TrimSpace(line[j])
			}
			return ""
		}
		q := qRow{Type: strings.ToLower(get(0)), Question: get(1), OptA: get(2), OptB: get(3), OptC: get(4), OptD: get(5), Key: get(6), Points: get(7), Explanation: get(8)}
		if q.Type == "" && q.Question == "" {
			continue
		}
		switch q.Type {
		case "pg", "pilihan_ganda", "mcq":
			q.Type = "mcq"
		case "pg_kompleks", "pgkompleks", "mcq_complex":
			q.Type = "mcq_complex"
		case "menjodohkan", "matching":
			q.Type = "matching"
		case "isian", "short_answer":
			q.Type = "short_answer"
		case "uraian", "essay":
			q.Type = "essay"
		default:
			errs = append(errs, qErr{Row: rowNo, Reason: "tipe tidak dikenal: " + q.Type})
			continue
		}
		if q.Question == "" {
			errs = append(errs, qErr{Row: rowNo, Reason: "pertanyaan kosong"})
			continue
		}
		if q.Points == "" {
			errs = append(errs, qErr{Row: rowNo, Reason: "poin kosong"})
			continue
		}
		rows = append(rows, q)
	}
	if len(rows) == 0 && len(errs) > 0 {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"valid": 0, "errors": errs})
		return
	}
	// simpan sebagai paket draft baru
	var setID, verID string
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		subject := r.URL.Query().Get("subject")
		if subject == "" {
			subject = "Import " + platform.RandomToken(4)
		}
		title := r.URL.Query().Get("title")
		if title == "" {
			title = "Paket import"
		}
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO question_sets (tenant_id, subject_name, title, exam_code, status, created_by) VALUES ($1,$2,$3,$4,'draft',$5) RETURNING id`,
			tid, subject, title, strings.ToUpper(platform.RandomToken(6)), actor).Scan(&setID); err != nil {
			return err
		}
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO question_set_versions (tenant_id, question_set_id, version_no, status) VALUES ($1,$2,1,'draft') RETURNING id`, tid, setID).Scan(&verID); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE question_sets SET draft_version_id=$1 WHERE id=$2`, verID, setID); err != nil {
			return err
		}
		for i, q := range rows {
			qd := qRowToDTO(q)
			if err := validateQuestion(&qd); err != nil {
				errs = append(errs, qErr{Row: i + 2, Reason: err.Error()})
				continue
			}
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO questions (tenant_id, set_version_id, order_no, type, body_html, options_json, answer_key_json, rubric_json, points, scoring_mode, partial_wrong_penalty, shuffle_options, explanation_html, media_ids)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'all_or_nothing',true,true,NULLIF($10,''),'{}')`,
				tid, verID, i+1, qd.Type, httpx.SanitizeHTML(qd.BodyHTML), rawOrEmpty(qd.OptionsJSON), rawOrNull(qd.AnswerKeyJSON), rawOrNull(qd.RubricJSON), qd.Points, qd.ExplanationHTML); err != nil {
				return err
			}
		}
		s.refreshCounts(r.Context(), tx, verID)
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"question_set_id": setID, "imported": len(rows) - len(errs), "errors": errs})
}

func qRowToDTO(q qRow) QuestionDTO {
	points := 0.0
	fmt.Sscanf(q.Points, "%g", &points)
	d := QuestionDTO{Type: q.Type, BodyHTML: q.Question, Points: points, ExplanationHTML: q.Explanation, ScoringMode: "all_or_nothing"}
	opts := []string{q.OptA, q.OptB, q.OptC, q.OptD}
	labels := []string{"A", "B", "C", "D"}
	switch q.Type {
	case "mcq", "mcq_complex":
		var arr []map[string]any
		for i, o := range opts {
			if o != "" {
				arr = append(arr, map[string]any{"id": labels[i], "html": o})
			}
		}
		b, _ := json.Marshal(arr)
		d.OptionsJSON = b
		if q.Type == "mcq" {
			k, _ := json.Marshal(map[string]any{"correct": strings.ToUpper(q.Key)})
			d.AnswerKeyJSON = k
		} else {
			var corr []string
			for _, c := range strings.Split(q.Key, ",") {
				corr = append(corr, strings.ToUpper(strings.TrimSpace(c)))
			}
			k, _ := json.Marshal(map[string]any{"correct": corr})
			d.AnswerKeyJSON = k
		}
	case "matching":
		var left, right []map[string]any
		pairs := map[string]string{}
		for _, p := range strings.Split(q.Key, ";") {
			parts := strings.SplitN(strings.TrimSpace(p), "\\|", 2)
			if len(parts) != 2 {
				continue
			}
			lid := fmt.Sprintf("L%d", len(left)+1)
			rid := fmt.Sprintf("R%d", len(right)+1)
			left = append(left, map[string]any{"id": lid, "html": parts[0]})
			right = append(right, map[string]any{"id": rid, "html": parts[1]})
			pairs[lid] = rid
		}
		ob, _ := json.Marshal(map[string]any{"left": left, "right": right})
		d.OptionsJSON = ob
		kb, _ := json.Marshal(map[string]any{"pairs": pairs})
		d.AnswerKeyJSON = kb
	case "short_answer":
		var acc []string
		for _, a := range strings.Split(q.Key, "|") {
			if a = strings.TrimSpace(a); a != "" {
				acc = append(acc, a)
			}
		}
		if len(acc) == 0 && q.Key != "" {
			acc = []string{q.Key}
		}
		kb, _ := json.Marshal(map[string]any{"accepted": acc})
		d.AnswerKeyJSON = kb
	case "essay":
		rb, _ := json.Marshal(map[string]any{"max_points": points, "criteria": []any{}})
		d.RubricJSON = rb
	}
	return d
}

// exportSet: export paket soal ke .xlsx (format sama dengan template import) — FR-4.6.
func (s *Service) exportSet(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	setID := chi.URLParam(r, "id")
	f := excelize.NewFile()
	sheet := f.GetSheetName(0)
	for i, h := range qHeaders {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		verID, _, err := currentVersionID(r.Context(), tx, tid, setID)
		if err != nil {
			return httpx.NotFound("paket tidak ditemukan")
		}
		rws, err := tx.Query(r.Context(),
			`SELECT type, body_html, options_json, answer_key_json, points, explanation_html FROM questions WHERE set_version_id=$1 ORDER BY order_no`, verID)
		if err != nil {
			return err
		}
		defer rws.Close()
		row := 2
		for rws.Next() {
			var typ, body, opts, key string
			var points float64
			var expl *string
			if err := rws.Scan(&typ, &body, &opts, &key, &points, &expl); err != nil {
				return err
			}
			vals := dtoToRow(typ, body, opts, key, points, expl)
			for ci, v := range vals {
				cell, _ := excelize.CoordinatesToCellName(ci+1, row)
				f.SetCellValue(sheet, cell, v)
			}
			row++
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="paket-soal.xlsx"`)
	_ = f.Write(w)
}

func dtoToRow(typ, body, optsJSON, keyJSON string, points float64, expl *string) []string {
	e := ""
	if expl != nil {
		e = *expl
	}
	p := fmt.Sprintf("%g", points)
	switch typ {
	case "mcq", "mcq_complex":
		label := map[string]string{"mcq": "pg", "mcq_complex": "pg_kompleks"}[typ]
		var opts []map[string]any
		json.Unmarshal([]byte(optsJSON), &opts)
		var key string
		var km map[string]any
		json.Unmarshal([]byte(keyJSON), &km)
		if typ == "mcq" {
			key, _ = km["correct"].(string)
		} else {
			var arr []any
			if v, ok := km["correct"].([]any); ok {
				arr = v
			}
			var parts []string
			for _, x := range arr {
				parts = append(parts, fmt.Sprint(x))
			}
			key = strings.Join(parts, ",")
		}
		cols := []string{label, stripTags(body)}
		for _, l := range []string{"A", "B", "C", "D"} {
			found := ""
			for _, o := range opts {
				if o["id"] == l {
					found = fmt.Sprint(o["html"])
				}
			}
			cols = append(cols, found)
		}
		return append(cols, key, p, e)
	case "matching":
		var opts struct {
			Left  []map[string]any `json:"left"`
			Right []map[string]any `json:"right"`
		}
		json.Unmarshal([]byte(optsJSON), &opts)
		var km map[string]any
		json.Unmarshal([]byte(keyJSON), &km)
		pairs := km["pairs"].(map[string]any)
		rightByID := map[string]string{}
		for _, r := range opts.Right {
			rightByID[fmt.Sprint(r["id"])] = fmt.Sprint(r["html"])
		}
		var pairStrs []string
		for _, l := range opts.Left {
			lid := fmt.Sprint(l["id"])
			if rid, ok := pairs[lid]; ok {
				pairStrs = append(pairStrs, fmt.Sprint(l["html"])+"\\|"+rightByID[fmt.Sprint(rid)])
			}
		}
		return []string{"menjodohkan", stripTags(body), strings.Join(pairStrs, ";"), "", "", "", strings.Join(pairStrs, ";"), p, e}
	case "short_answer":
		var km map[string]any
		json.Unmarshal([]byte(keyJSON), &km)
		var acc []string
		if v, ok := km["accepted"].([]any); ok {
			for _, x := range v {
				acc = append(acc, fmt.Sprint(x))
			}
		}
		return []string{"isian", stripTags(body), "", "", "", "", strings.Join(acc, "|"), p, e}
	case "essay":
		return []string{"uraian", stripTags(body), "", "", "", "", "(rubrik)", p, e}
	}
	return []string{typ, stripTags(body), "", "", "", "", "", p, e}
}
