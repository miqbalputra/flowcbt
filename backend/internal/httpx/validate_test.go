package httpx

import "testing"

type sampleInput struct {
	Name   string `json:"name" validate:"required,min=2,max=20"`
	Email  string `json:"email" validate:"required,email"`
	Level  string `json:"level" validate:"required,oneof=sd_mi smp_mts"`
	Reason string `json:"reason"`
}

// B-08: tag validate tidak boleh lagi hanya dekoratif.
func TestValidate(t *testing.T) {
	cases := []struct {
		name    string
		in      sampleInput
		wantErr bool
		fields  []string
	}{
		{"valid", sampleInput{Name: "Ibu Sari", Email: "sari@sekolah.sch.id", Level: "sd_mi"}, false, nil},
		{"short name", sampleInput{Name: "A", Email: "a@b.co", Level: "sd_mi"}, true, []string{"name"}},
		{"bad email", sampleInput{Name: "Ibu Sari", Email: "bukan-email", Level: "sd_mi"}, true, []string{"email"}},
		{"bad level", sampleInput{Name: "Ibu Sari", Email: "a@b.co", Level: "perguruan_tinggi"}, true, []string{"level"}},
		{"multiple", sampleInput{Name: "", Email: "x", Level: "?"}, true, []string{"name", "email", "level"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := Validate(c.in)
			if !c.wantErr {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			ae, ok := err.(*AppError)
			if !ok || ae.Code != CodeValidation || ae.HTTPStatus != 400 {
				t.Fatalf("want 400 VALIDATION_ERROR, got %v", err)
			}
			details, ok := ae.Details.(map[string]any)
			if !ok {
				t.Fatalf("details = %T", ae.Details)
			}
			fields, ok := details["fields"].(map[string]string)
			if !ok {
				t.Fatalf("fields = %T", details["fields"])
			}
			for _, f := range c.fields {
				if _, found := fields[f]; !found {
					t.Fatalf("field %q tidak dilaporkan: %v", f, fields)
				}
			}
		})
	}
}
