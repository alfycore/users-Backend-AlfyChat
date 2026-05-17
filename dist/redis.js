"use strict";
// ==========================================
// ALFYCHAT - REDIS CLIENT (USERS SERVICE)
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisClient = getRedisClient;
const ioredis_1 = __importDefault(require("ioredis"));
let client = null;
function getRedisClient(config) {
    if (!client && config) {
        client = new ioredis_1.default({
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
        async get(key) {
            return client.get(key);
        },
        async set(key, value, ttl) {
            if (ttl) {
                await client.setex(key, ttl, value);
            }
            else {
                await client.set(key, value);
            }
        },
        async del(key) {
            await client.del(key);
        },
    };
}
//# sourceMappingURL=redis.js.map