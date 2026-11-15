package platform

import (
	"context"
	"fmt"
	"log/slog"
	"net/smtp"
)

type Mail struct {
	To      string
	Subject string
	Body    string // plain text
	HTML    string
}

type Mailer interface {
	Send(ctx context.Context, m Mail) error
}

// LogMailer menulis email ke log (dev/sandbox, kompatibel Mailpit via SMTP jika di-set).
type LogMailer struct{ Log *slog.Logger }

func (l LogMailer) Send(ctx context.Context, m Mail) error {
	l.Log.Info("email", "to", m.To, "subject", m.Subject, "body", m.Body)
	return nil
}

type SMTPMailer struct {
	Host string
	Port int
	User string
	Pass string
	From string
}

func (s SMTPMailer) Send(ctx context.Context, m Mail) error {
	addr := fmt.Sprintf("%s:%d", s.Host, s.Port)
	auth := smtp.PlainAuth("", s.User, s.Pass, s.Host)
	msg := []byte(fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s",
		s.From, m.To, m.Subject, m.Body))
	return smtp.SendMail(addr, auth, s.From, []string{m.To}, msg)
}

func NewMailer(cfg Config, log *slog.Logger) Mailer {
	if cfg.MailerKind == "smtp" && cfg.SMTPHost != "" {
		return SMTPMailer{Host: cfg.SMTPHost, Port: cfg.SMTPPort, User: cfg.SMTPUser, Pass: cfg.SMTPPass, From: cfg.SMTPFrom}
	}
	return LogMailer{Log: log}
}
