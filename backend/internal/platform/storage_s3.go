package platform

import (
	"context"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3Storage struct {
	client *minio.Client
	bucket string
	endpoint string
}

func NewS3Storage(cfg Config) (*S3Storage, error) {
	cli, err := minio.New(cfg.S3Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: false,
		Region: cfg.S3Region,
	})
	if err != nil {
		return nil, err
	}
	return &S3Storage{client: cli, bucket: cfg.S3Bucket, endpoint: cfg.S3Endpoint}, nil
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
	return "http://" + s.endpoint + "/" + s.bucket + "/" + key
}
