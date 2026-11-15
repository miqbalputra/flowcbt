package platform

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Storage adalah antarmuka object storage (S3/MinIO di produksi; local dir untuk dev/sandbox).
type Storage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, mime string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	URL(key string) string
}

type LocalStorage struct{ Dir string }

func NewLocalStorage(dir string) (*LocalStorage, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &LocalStorage{Dir: dir}, nil
}

func (s *LocalStorage) path(key string) string {
	return filepath.Join(s.Dir, filepath.FromSlash(key))
}

func (s *LocalStorage) Put(ctx context.Context, key string, r io.Reader, size int64, mime string) error {
	p := s.path(key)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	f, err := os.Create(p)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func (s *LocalStorage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	return os.Open(s.path(key))
}

func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	err := os.Remove(s.path(key))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *LocalStorage) URL(key string) string { return "/media/" + key }

func NewStorage(cfg Config) (Storage, error) {
	if cfg.StorageKind == "s3" {
		return NewS3Storage(cfg)
	}
	return NewLocalStorage(cfg.StorageDir)
}

// TenantKey membuat object key yang unik per tenant.
func TenantKey(tenantID, prefix, name string) string {
	return fmt.Sprintf("%s/%s/%s-%s", tenantID, prefix, NewIDString(), name)
}
