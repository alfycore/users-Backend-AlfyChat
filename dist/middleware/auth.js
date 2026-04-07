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
const redis_1 = require("../redis");
const JWT_SECRET = process.env.JWT_SECRET || 'alfychat-super-secret-key-dev-2026';
async function authMiddleware(req, res, next) {
    try {
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