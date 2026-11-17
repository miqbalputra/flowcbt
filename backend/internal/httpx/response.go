package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

type envelope struct {
	Data  any       `json:"data,omitempty"`
	Error *AppError `json:"error,omitempty"`
	Meta  any       `json:"meta,omitempty"`
}

type PageMeta struct {
	Limit  int    `json:"limit"`
	Cursor string `json:"cursor,omitempty"`
	Next   string `json:"next_cursor,omitempty"`
	Total  *int64 `json:"total,omitempty"`
}

func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Data: data})
}

func WriteError(w http.ResponseWriter, err error) {
	ae := AsAppError(err)
	var orig *AppError
	if !errors.As(err, &orig) {
		slog.Error("unhandled error", "err", err, "rid", w.Header().Get("X-Request-ID"))
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(ae.HTTPStatus)
	_ = json.NewEncoder(w).Encode(envelope{Error: ae})
}

func WritePaged(w http.ResponseWriter, data any, meta PageMeta) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(envelope{Data: data, Meta: meta})
}

// maxBodyBytes mencegah payload json.RawMessage besar membebani server (X-03/B-08).
const maxBodyBytes = 1 << 20 // 1 MB

func DecodeJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return BadRequest(CodeValidation, "format JSON tidak valid: "+err.Error())
	}
	return nil
}
