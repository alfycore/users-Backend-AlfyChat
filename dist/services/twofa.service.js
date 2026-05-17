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
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../database");
const redis_1 = require("../redis");
const logger_1 = require("../utils/logger");
const APP_NAME = 'AlfyChat';
// Clé de chiffrement du secret TOTP au repos. Dérivée de TWOFA_ENCRYPTION_KEY
// ou, à défaut, de JWT_SECRET — dans les deux cas on applique un HKDF-like
// SHA-256 pour obtenir une clé 32 octets stable.
function deriveTotpKey() {
    const raw = process.env.TWOFA_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
    if (!raw) {
        throw new Error('TWOFA_ENCRYPTION_KEY ou JWT_SECRET doit être défini pour chiffrer le secret TOTP');
    }
    return crypto_1.default.createHash('sha256').update(`alfychat:totp-key:${raw}`).digest();
}
function encryptTotpSecret(plain) {
    const key = deriveTotpKey();
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Format: v1:base64(iv|tag|ct)
    return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}
function decryptTotpSecret(stored) {
    // Rétro-compatible : si la valeur n'a pas le préfixe v1:, on suppose un secret en clair
    // (migration progressive : sera re-chiffré au prochain cycle d'activation).
    if (!stored.startsWith('v1:'))
        return stored;
    const raw = Buffer.from(stored.slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', deriveTotpKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
class TwoFactorService {
    get db() {
        return (0, database_1.getDatabaseClient)();
    }
    get redis() {
        return (0, redis_1.getRedisClient)();
    }
    // Générer un secret TOTP et retourner l'URL otpauth + QR code
    async generateSecret(userId, userEmail) {
        const secret = otplib_1.authenticator.generateSecret();
        const otpauthUrl = otplib_1.authenticator.keyuri(userEmail, APP_NAME, secret);
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
        const isValid = otplib_1.authenticator.verify({ token: totpCode, secret: pendingSecret });
        if (!isValid) {
            return { success: false, error: 'Code invalide. Vérifiez votre application d\'authentification.' };
        }
        // Générer les codes de secours : retournés une seule fois en clair au client,
        // stockés UNIQUEMENT sous forme de hash bcrypt (jamais en clair ni JSON).
        const backupCodes = this.generateBackupCodes();
        const hashedBackupCodes = await Promise.all(backupCodes.map((c) => bcryptjs_1.default.hash(c, 10)));
        const storedBackupCodes = JSON.stringify(hashedBackupCodes);
        // Chiffrer le secret TOTP avant persistance (AES-256-GCM)
        const encryptedSecret = encryptTotpSecret(pendingSecret);
        await this.db.execute(`UPDATE users SET totp_secret = ?, totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?`, [encryptedSecret, storedBackupCodes, userId]);
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
        const decryptedSecret = decryptTotpSecret(user.totp_secret);
        const isValid2 = otplib_1.authenticator.verify({ token: totpCode, secret: decryptedSecret });
        if (!isValid2) {
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
        otplib_1.authenticator.options = { window: 1 };
        const decryptedSecret = decryptTotpSecret(user.totp_secret);
        const isValidTotp = otplib_1.authenticator.verify({ token: totpCode, secret: decryptedSecret });
        if (isValidTotp)
            return true;
        // Vérifier les codes de secours — comparés en bcrypt (hash à usage unique).
        if (user.totp_backup_codes) {
            let stored;
            try {
                stored = JSON.parse(user.totp_backup_codes);
            }
            catch {
                stored = [];
            }
            const normalizedCode = totpCode.trim().toUpperCase();
            for (let i = 0; i < stored.length; i++) {
                const entry = stored[i];
                // Un hash bcrypt commence par $2a$, $2b$ ou $2y$ — distingue du legacy en clair.
                const isHash = typeof entry === 'string' && /^\$2[aby]\$/.test(entry);
                const match = isHash
                    ? await bcryptjs_1.default.compare(normalizedCode, entry)
                    : entry === normalizedCode;
                if (match) {
                    // Consommer le code (usage unique)
                    stored.splice(i, 1);
                    await this.db.execute('UPDATE users SET totp_backup_codes = ? WHERE id = ?', [JSON.stringify(stored), userId]);
                    logger_1.logger.info(`Code de secours 2FA utilisé pour ${userId}`);
                    return true;
                }
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
    // Générer des codes de secours (RNG cryptographique — jamais Math.random pour un secret)
    generateBackupCodes(count = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const codes = [];
        for (let i = 0; i < count; i++) {
            const bytes = crypto_1.default.randomBytes(8);
            let code = '';
            for (let j = 0; j < 8; j++)
                code += chars[bytes[j] % chars.length];
            codes.push(code);
        }
        return codes;
    }
}
exports.TwoFactorService = TwoFactorService;
exports.twoFactorService = new TwoFactorService();
//# sourceMappingURL=twofa.service.js.map