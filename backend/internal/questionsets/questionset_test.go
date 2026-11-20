package questionsets

import "testing"

func TestSanitizeHTML(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"tag allowlist lolos",
			`<p>Soal <b>tegas</b><br/>baris</p>`, "<p>Soal <b>tegas</b><br>baris</p>"},
		{"script dibuang beserta isi",
			`<p>awal</p><script>alert(1)</script><p>akhir</p>`, "<p>awal</p><p>akhir</p>"},
		{"style dibuang beserta isi",
			`<p>a</p><style>*{}</style><p>b</p>`, "<p>a</p><p>b</p>"},
		{"atribut on* dibuang",
			`<p onclick="x()">teks</p>`, "<p>teks</p>"},
		{"img dari media internal lolos",
			`<img src="/api/v1/media/t1/a.png" onerror="x()">`, `<img src="/api/v1/media/t1/a.png">`},
		{"img data URI lolos",
			`<img src="data:image/png;base64,AAA">`, `<img src="data:image/png;base64,AAA">`},
		{"img src asing dibuang",
			`<p>x</p><img src="https://evil/a.png">`, "<p>x</p>"},
		{"tag asing dibuang",
			`<a href="x">k</a><iframe src="y"></iframe>z`, "kz"},
		{"td colspan/rowspan dipertahankan",
			`<td colspan="2" rowspan="3">c</td>`, `<td colspan="2" rowspan="3">c</td>`},
		{"tag hancur dibuang",
			`<p>ok <span>a</span></p>`, "<p>ok a</p>"},
		{"komentar dibuang",
			`<p>a</p><!-- k --> <p>b</p>`, "<p>a</p> <p>b</p>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sanitizeHTML(tc.in); got != tc.want {
				t.Errorf("sanitizeHTML(%q) = %q, ingin %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestValidateQuestionOK(t *testing.T) {
	opts := `[{"id":"A","text":"1"},{"id":"B","text":"2"},{"id":"C","text":"3"}]`
	ok := []struct {
		name, typ, opt, key, mode string
	}{
		{"mcq", "mcq", opts, `{"correct":"B"}`, modeAllOrNothing},
		{"mcq_complex partial", "mcq_complex", opts, `{"correct":["A","C"]}`, modePartial},
		{"matching 4 pasangan", "matching",
			`{"left":["Ada","B","C","D"],"right":["1","2","3","4"]}`,
			`{"pairs":[{"left":"Ada","right":"1"},{"left":"B","right":"2"},{"left":"C","right":"3"},{"left":"D","right":"4"}]}`,
			modePartial},
		{"isian multi variasi", "short_answer", `null`, `{"answers":[" 15","15.0"]}`, modeAllOrNothing},
		{"essay tanpa rubric", "essay", `null`, `{"rubric":""}`, modeAllOrNothing},
	}
	for _, tc := range ok {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := validateQuestion(tc.typ, tc.opt, tc.key, 1, tc.mode); err != nil {
				t.Errorf("%s harus lolos: %v", tc.typ, err)
			}
		})
	}
}

func TestValidateQuestionBad(t *testing.T) {
	opts := `[{"id":"A","text":"1"},{"id":"B","text":"2"},{"id":"C","text":"3"}]`
	bad := []struct {
		name, typ, opt, key string
		points              float64
		mode                string
	}{
		{"mcq partial ditolak", "mcq", opts, `{"correct":"A"}`, 1, modePartial},
		{"mcq kunci di luar opsi", "mcq", `[{"id":"A","text":"1"}]`, `{"correct":"E"}`, 1, modeAllOrNothing},
		{"mcq_complex mode asing ditolak", "mcq_complex", opts, `{"correct":["A","B"]}`, 1, "semua"},
		{"options 1 (min 2)", "mcq", `[{"id":"A","text":"1"}]`, `{"correct":"A"}`, 1, modeAllOrNothing},
		{"poin 0 ditolak", "mcq", opts, `{"correct":"A"}`, 0, modeAllOrNothing},
		{"isian tanpa variasi", "short_answer", `null`, `{"answers":[]}`, 1, modeAllOrNothing},
		{"matching 1 pasangan", "matching",
			`{"left":["A","B","C","D"],"right":["1","2","3","4"]}`,
			`{"pairs":[{"left":"A","right":"1"}]}`, 1, modeAllOrNothing},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := validateQuestion(tc.typ, tc.opt, tc.key, tc.points, tc.mode); err == nil {
				t.Errorf("%s harus ditolak", tc.name)
			}
		})
	}
}
