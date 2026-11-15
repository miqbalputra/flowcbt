package auth

import (
	"net"
	"strings"
)

// HostOnly mengupas port dari RemoteAddr untuk kolom inet.
func HostOnly(remoteAddr string) string {
	if h, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return h
	}
	return strings.TrimSpace(remoteAddr)
}
