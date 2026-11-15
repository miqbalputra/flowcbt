package questionbank

import (
	"context"
	"io"
)

// MediaStorage adalah kontrak storage untuk upload media soal.
type MediaStorage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, mime string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	URL(key string) string
}
