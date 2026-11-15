package platform

import (
	"sync"

	"github.com/redis/go-redis/v9"
)

var (
	redisMu     sync.Mutex
	redisClient *redis.Client
)

func getRedisClient(url string) *redis.Client {
	redisMu.Lock()
	defer redisMu.Unlock()
	if redisClient == nil {
		redisClient = redis.NewClient(&redis.Options{Addr: url})
	}
	return redisClient
}

// RedisClient mengembalikan client Redis bila REDIS_URL di-set, jika tidak nil.
func RedisClient(cfg Config) *redis.Client {
	if cfg.RedisURL == "" {
		return nil
	}
	return getRedisClient(cfg.RedisURL)
}
