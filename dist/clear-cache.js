"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ioredis_1 = __importDefault(require("ioredis"));
(async () => {
    try {
        const redis = new ioredis_1.default({
            host: 'localhost',
            port: 6379,
        });
        // Supprimer tous les caches utilisateurs
        const keys = await redis.keys('user:*');
        console.log(`🔍 Trouvé ${keys.length} clés de cache utilisateur`);
        if (keys.length > 0) {
            await redis.del(...keys);
            console.log(`✅ ${keys.length} clés supprimées`);
        }
        else {
            console.log('✅ Aucune clé à supprimer');
        }
        await redis.quit();
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Erreur:', error);
        process.exit(1);
    }
})();
//# sourceMappingURL=clear-cache.js.map