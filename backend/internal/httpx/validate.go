package httpx

import (
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

// B-08: validator ringan untuk subset tag `validate:` yang dipakai di codebase.
// Tag sebelumnya hanya dekoratif — nilai invalid (mis. level salah) jatuh ke CHECK DB
// dan tampil sebagai 500. Sekarang ditolak di batas sistem sebagai 400 + details/field.
var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// Validate memeriksa struct sesuai tag validate. Mengembalikan *AppError VALIDATION_ERROR.
func Validate(v any) error {
	rv := reflect.ValueOf(v)
	for rv.Kind() == reflect.Ptr {
		if rv.IsNil() {
			return BadRequest(CodeValidation, "body tidak valid")
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		return nil
	}
	rt := rv.Type()
	details := map[string]string{}
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		tag := f.Tag.Get("validate")
		if tag == "" || f.PkgPath != "" { // skip unexported
			continue
		}
		value := rv.Field(i)
		if value.Kind() == reflect.Ptr {
			if value.IsNil() {
				if hasRule(tag, "required") {
					details[fieldName(f)] = "wajib diisi"
				}
				continue
			}
			value = value.Elem()
		}
		s := fmt.Sprint(value.Interface())
		for _, rule := range strings.Split(tag, ",") {
			parts := strings.SplitN(rule, "=", 2)
			name := parts[0]
			arg := ""
			if len(parts) == 2 {
				arg = parts[1]
			}
			switch name {
			case "required":
				if strings.TrimSpace(s) == "" {
					details[fieldName(f)] = "wajib diisi"
				}
			case "min":
				if n, err := strconv.Atoi(arg); err == nil && len([]rune(s)) < n && s != "" {
					details[fieldName(f)] = fmt.Sprintf("minimal %d karakter", n)
				}
			case "max":
				if n, err := strconv.Atoi(arg); err == nil && len([]rune(s)) > n {
					details[fieldName(f)] = fmt.Sprintf("maksimal %d karakter", n)
				}
			case "email":
				if s != "" && !emailRe.MatchString(s) {
					details[fieldName(f)] = "format email tidak valid"
				}
			case "oneof":
				if s != "" && !containsWord(arg, s) {
					details[fieldName(f)] = "nilai tidak diizinkan: " + s
				}
			case "omitempty":
				// ditangani implisit: aturan lain dilewati bila kosong
				if s == "" {
					delete(details, fieldName(f))
				}
			}
		}
	}
	if len(details) > 0 {
		return ErrDetails(CodeValidation, "validasi gagal", http.StatusBadRequest, map[string]any{"fields": details})
	}
	return nil
}

// ValidateJSON = DecodeJSON + Validate dalam satu pemanggilan.
func ValidateJSON(r *http.Request, v any) error {
	if err := DecodeJSON(r, v); err != nil {
		return err
	}
	return Validate(v)
}

func hasRule(tag, name string) bool {
	for _, r := range strings.Split(tag, ",") {
		if strings.SplitN(r, "=", 2)[0] == name {
			return true
		}
	}
	return false
}

func containsWord(list, word string) bool {
	for _, w := range strings.Fields(list) {
		if w == word {
			return true
		}
	}
	return false
}

func fieldName(f reflect.StructField) string {
	if j := strings.Split(f.Tag.Get("json"), ",")[0]; j != "" && j != "-" {
		return j
	}
	return f.Name
}
