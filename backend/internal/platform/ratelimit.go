package platform

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// RateLimiter membatasi percobaan per kunci (login/token) — FR-1.2, anti brute-force (Bagian 12).
// Implementasi default in-memory; dengan REDIS_URL tersedia, bisa diganti impl Redis.
type RateLimiter interface {
	// Allow mengembalikan true bila masih dalam batas; mengembalikan retryAfter bila ditolak.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (allowed bool, retryAfter time.Duration)
}

type MemLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func NewMemLimiter() *MemLimiter {
	return &MemLimiter{hits: map[string][]time.Time{}}
}

func (m *MemLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-window)
	var kept []time.Time
	for _, t := range m.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= limit {
		retry := kept[0].Add(window).Sub(now)
		if retry < 0 {
			retry = 0
		}
		m.hits[key] = kept
		return false, retry
	}
	m.hits[key] = append(kept, now)
	return true, 0
}

// RedisLimiter menggunakan Redis (SLIDING window sederhana via INCR+EXPIRE).
type RedisLimiter struct {
	Do func(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error)
}

func (r RedisLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration) {
	ok, retry, err := r.Do(ctx, key, limit, window)
	if err != nil {
		// fail-open agar gangguan Redis tidak mengunci semua login
		return true, 0
	}
	return ok, retry
}

func NewRateLimiter(redisURL string) RateLimiter {
	if redisURL != "" {
		return &RedisLimiter{Do: redisAllowFactory(redisURL)}
	}
	return NewMemLimiter()
}

func redisAllowFactory(redisURL string) func(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error) {
	return func(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error) {
		rdb := getRedisClient(redisURL)
		k := fmt.Sprintf("rl:%s", key)
		n, err := rdb.Incr(ctx, k).Result()
		if err != nil {
			return true, 0, err
		}
		if n == 1 {
			rdb.Expire(ctx, k, window)
		}
		if int(n) > limit {
			ttl, _ := rdb.TTL(ctx, k).Result()
			return false, ttl, nil
		}
		return true, 0, nil
	}
}
