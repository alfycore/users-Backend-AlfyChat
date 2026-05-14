// ==========================================
// ALFYCHAT - REDIS CLIENT (USERS SERVICE)
// ==========================================

import Redis from 'ioredis';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
}

let client: Redis | null = null;

export function getRedisClient(config?: RedisConfig) {
  if (!client && config) {
    client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 2000, 30000),
    });
    client.on('error', (err) => {
      console.error(`[Redis] Erreur de connexion (${config.host}:${config.port}):`, err.message);
    });
    client.connect().catch((err) => {
      console.error(`[Redis] Connexion initiale échouée:`, err.message);
    });
  }

  if (!client) {
    throw new Error('Redis not initialized');
  }

  return {
    async get(key: string): Promise<string | null> {
      return client!.get(key);
    },

    async set(key: string, value: string, ttl?: number): Promise<void> {
      if (ttl) {
        await client!.setex(key, ttl, value);
      } else {
        await client!.set(key, value);
      }
    },

    async del(key: string): Promise<void> {
      await client!.del(key);
    },
  };
}
