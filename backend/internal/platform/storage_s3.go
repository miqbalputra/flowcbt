package platform

import (
	"context"
	"io"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3Storage struct {
	client   *minio.Client
	bucket   string
	endpoint string
	secure   bool
}

func NewS3Storage(cfg Config) (*S3Storage, error) {
	// C-07: jangan hardcode Secure=false — endpoint HTTPS harus memakai TLS.
	secure := isHTTPS(cfg.S3Endpoint) || strings.HasPrefix(strings.ToLower(cfg.S3Endpoint), "https://")
	cli, err := minio.New(cfg.S3Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: secure,
		Region: cfg.S3Region,
	})
	if err != nil {
		return nil, err
	}
	return &S3Storage{client: cli, bucket: cfg.S3Bucket, endpoint: cfg.S3Endpoint, secure: secure}, nil
}

func (s *S3Storage) Put(ctx context.Context, key string, r io.Reader, size int64, mime string) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{ContentType: mime})
	return err
}

func (s *S3Storage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}

func (s *S3Storage) Delete(ctx context.Context, key string) error {
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

func (s *S3Storage) URL(key string) string {
	scheme := "http"
	if s.secure {
		scheme = "https"
	}
	return scheme + "://" + s.endpoint + "/" + s.bucket + "/" + key
}
