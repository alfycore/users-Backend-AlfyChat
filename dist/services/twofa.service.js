"use strict";
// ==========================================
// ALFYCHAT - SERVICE 2FA (TOTP)
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.twoFactorService = exports.TwoFactorService = void 0;
const otplib_1 = require("otplib");
const qrcode_1 = __importDefault(require("qrcode"));
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../database");
const redis_1 = require("../redis");
const logger_1 = require("../utils/logger");
const APP_NAME = 'AlfyChat';
class TwoFactorService {
    get db() {
        return (0, database_1.getDatabaseClient)();
    }
    get redis() {
        return (0, redis_1.getRedisClient)();
    }
    // Générer un secret TOTP et retourner l'URL otpauth + QR code
    async generateSecret(userId, userEmail) {
        const secret = (0, otplib_1.generateSecret)();
        const otpauthUrl = (0, otplib_1.generateURI)({
            issuer: APP_NAME,
            label: userEmail,
            secret,
        });
        const qrCodeDataUrl = await qrcode_1.default.toDataURL(otpauthUrl);
        // Stocker le secret temporaire (pas encore activé) dans Redis, expire dans 10 minutes
        await this.redis.set(`2fa:pending:${userId}`, secret, 10 * 60);
        return { secret, otpauthUrl, qrCodeDataUrl };
    }
    // Activer le 2FA après vérification du code OTP
    async enable(userId, totpCode) {
        const pendingSecret = await this.redis.get(`2fa:pending:${userId}`);
        if (!pendingSecret) {
            return { success: false, error: 'Session expirée. Veuillez recommencer la configuration.' };
        }
        const result = await (0, otplib_1.verify)({ secret: pendingSecret, token: totpCode });
        if (!result.valid) {
            return { success: false, error: 'Code invalide. Vérifiez votre application d\'authentification.' };
        }
        // Générer les codes de secours
        const backupCodes = this.generateBackupCodes();
        const backupCodesHash = JSON.stringify(backupCodes);
        // Sauvegarder le secret en base
        await this.db.execute(`UPDATE users SET totp_secret = ?, totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?`, [pendingSecret, backupCodesHash, userId]);
        // Supprimer le secret temporaire
        await this.redis.del(`2fa:pending:${userId}`);
        logger_1.logger.info(`2FA activé pour l'utilisateur ${userId}`);
        return { success: true, backupCodes };
    }
    // Désactiver le 2FA
    async disable(userId, totpCode) {
        const [rows] = await this.db.query('SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = TRUE', [userId]);
        const user = rows[0];
        if (!user) {
            return { success: false, error: '2FA non activé sur ce compte.' };
        }
        const result2 = await (0, otplib_1.verify)({ secret: user.totp_secret, token: totpCode });
        if (!result2.valid) {
            return { success: false, error: 'Code invalide.' };
        }
        await this.db.execute('UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = ?', [userId]);
        logger_1.logger.info(`2FA désactivé pour l'utilisateur ${userId}`);
        return { success: true };
    }
    // Vérifier un code TOTP lors de la connexion
    async verify(userId, totpCode) {
        const [rows] = await this.db.query('SELECT totp_secret, totp_backup_codes FROM users WHERE id = ? AND totp_enabled = TRUE', [userId]);
        const user = rows[0];
        if (!user)
            return false;
        // Vérifier le code TOTP normal (avec tolérance ±1 step)
        const result = await (0, otplib_1.verify)({ secret: user.totp_secret, token: totpCode, epochTolerance: 30 });
        if (result.valid)
            return true;
        // Vérifier les codes de secours
        if (user.totp_backup_codes) {
            const backupCodes = JSON.parse(user.totp_backup_codes);
            const normalizedCode = totpCode.trim().toUpperCase();
            const idx = backupCodes.indexOf(normalizedCode);
            if (idx !== -1) {
                // Consommer le code de secours (usage unique)
                backupCodes.splice(idx, 1);
                await this.db.execute('UPDATE users SET totp_backup_codes = ? WHERE id = ?', [JSON.stringify(backupCodes), userId]);
                logger_1.logger.info(`Code de secours 2FA utilisé pour ${userId}`);
                return true;
            }
        }
        return false;
    }
    // Vérifier si l'utilisateur a le 2FA activé
    async isEnabled(userId) {
        const [rows] = await this.db.query('SELECT totp_enabled FROM users WHERE id = ?', [userId]);
        const user = rows[0];
        return user?.totp_enabled === 1 || user?.totp_enabled === true;
    }
    // Créer un token de connexion intermédiaire (attend le code 2FA)
    async createPendingSession(userId) {
        const token = crypto_1.default.randomBytes(32).toString('hex');
        await this.redis.set(`2fa:session:${token}`, userId, 5 * 60);
        return token;
    }
    // Résoudre le token de session en attente
    async resolvePendingSession(token) {
        const userId = await this.redis.get(`2fa:session:${token}`);
        if (!userId)
            return null;
        await this.redis.del(`2fa:session:${token}`);
        return userId;
    }
    // Générer des codes de secours
    generateBackupCodes(count = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from({ length: count }, () => Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''));
    }
}
exports.TwoFactorService = TwoFactorService;
exports.twoFactorService = new TwoFactorService();
//# sourceMappingURL=twofa.service.js.map