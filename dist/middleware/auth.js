"use strict";
// ==========================================
// ALFYCHAT - MIDDLEWARE D'AUTHENTIFICATION
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const redis_1 = require("../redis");
function safeCompare(a, b) {
    if (!a || !b)
        return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(bufA, bufB);
}
async function authMiddleware(req, res, next) {
    const JWT_SECRET = process.env.JWT_SECRET;
    const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
    if (!JWT_SECRET || !INTERNAL_SECRET) {
        res.status(500).json({ error: 'Server misconfiguration: missing secrets' });
        return;
    }
    try {
        // Bypass interne : requêtes provenant du gateway (x-internal-secret + x-user-id)
        const internalSecret = req.headers['x-internal-secret'];
        if (internalSecret && safeCompare(internalSecret, INTERNAL_SECRET)) {
            const xUserId = req.headers['x-user-id'];
            if (xUserId) {
                req.userId = xUserId;
                return next();
            }
        }
        // x-user-id sans secret valide est IGNORÉ — pas de fallback silencieux
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Token d\'authentification requis' });
            return;
        }
        const token = authHeader.replace('Bearer ', '');
        // Vérifier si le token est blacklisté
        const redis = (0, redis_1.getRedisClient)();
        const isBlacklisted = await redis.get(`blacklist:${token}`);
        if (isBlacklisted) {
            res.status(401).json({ error: 'Token invalide' });
            return;
        }
        // Vérifier le token
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // Ajouter l'userId à la requête
        req.userId = decoded.userId;
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            res.status(401).json({ error: 'Token expiré' });
            return;
        }
        res.status(401).json({ error: 'Token invalide' });
    }
}
//# sourceMappingURL=auth.js.map