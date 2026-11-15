package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// GoogleTokeninfoVerifier memverifikasi id_token via endpoint tokeninfo Google.
type GoogleTokeninfoVerifier struct {
	ClientID string
	HTTP     *http.Client
}

func (g GoogleTokeninfoVerifier) Verify(ctx context.Context, idToken string) (string, string, error) {
	hc := g.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	url := "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := hc.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("tokeninfo status %d", resp.StatusCode)
	}
	var payload struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Aud   string `json:"aud"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", "", err
	}
	if g.ClientID != "" && !strings.EqualFold(payload.Aud, g.ClientID) {
		return "", "", fmt.Errorf("aud tidak cocok")
	}
	return payload.Sub, payload.Email, nil
}
