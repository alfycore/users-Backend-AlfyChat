"use strict";
// ==========================================
// ALFYCHAT - SERVICE AUTHENTIFICATION
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../database");
const redis_1 = require("../redis");
const users_service_1 = require("./users.service");
const email_service_1 = require("./email.service");
const twofa_service_1 = require("./twofa.service");
const userService = new users_service_1.UserService();
class AuthService {
    JWT_SECRET;
    JWT_REFRESH_SECRET;
    ACCESS_TOKEN_EXPIRY = '15m';
    REFRESH_TOKEN_EXPIRY = '365d';
    ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;
    constructor() {
        const secret = process.env.JWT_SECRET;
        const refreshSecret = process.env.JWT_REFRESH_SECRET;
        if (!secret)
            throw new Error('JWT_SECRET environment variable is required');
        if (!refreshSecret)
            throw new Error('JWT_REFRESH_SECRET environment variable is required');
        this.JWT_SECRET = secret;
        this.JWT_REFRESH_SECRET = refreshSecret;
    }
    get db() {
        return (0, database_1.getDatabaseClient)();
    }
    get redis() {
        return (0, redis_1.getRedisClient)();
    }
    // Inscription
    async register(data, ipAddress, userAgent) {
        // Vérifier si l'email existe
        const existingEmail = await userService.findByEmail(data.email);
        if (existingEmail) {
            return { success: false, error: 'Cet email est déjà utilisé' };
        }
        // Vérifier si le username existe
        const existingUsername = await userService.findByUsername(data.username);
        if (existingUsername) {
            return { success: false, error: 'Ce nom d\'utilisateur est déjà pris' };
        }
        // Hasher le mot de passe
        const passwordHash = await bcryptjs_1.default.hash(data.password, 12);
        // Créer l'utilisateur
        const userId = (0, uuid_1.v4)();
        const user = await userService.create({
            id: userId,
            email: data.email,
            username: data.username,
            displayName: data.displayName,
            passwordHash,
        });
        // Stocker les clés E2EE si fournies
        if (data.publicKey && data.encryptedPrivateKey && data.keySalt) {
            await this.db.execute('UPDATE users SET public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?', [data.publicKey, data.encryptedPrivateKey, data.keySalt, userId]);
        }
        // Créer les consentements RGPD par défaut
        await this.createDefaultConsents(userId);
        // Envoyer l'email de vérification (non bloquant)
        this.sendEmailVerification(userId, data.email, data.username || data.displayName).catch(() => { });
        // Générer les tokens
        const tokens = await this.generateTokens(userId, ipAddress, userAgent);
        return {
            success: true,
            user,
            tokens,
        };
    }
    // Connexion
    async login(email, password, ipAddress, userAgent) {
        // Chercher l'utilisateur
        const [rows] = await this.db.query('SELECT id, email, username, display_name, avatar_url, status, password_hash, totp_enabled, email_verified, key_salt, encrypted_private_key, public_key FROM users WHERE email = ?', [email]);
        const users = rows;
        if (users.length === 0) {
            return { success: false, error: 'Email ou mot de passe incorrect' };
        }
        const dbUser = users[0];
        // Vérifier le mot de passe
        const isValid = await bcryptjs_1.default.compare(password, dbUser.password_hash);
        if (!isValid) {
            return { success: false, error: 'Email ou mot de passe incorrect' };
        }
        // Email non vérifié
        const isVerified = dbUser.email_verified === 1 || dbUser.email_verified === true;
        if (!isVerified) {
            return { success: false, emailNotVerified: true };
        }
        // 2FA requis ?
        const has2FA = dbUser.totp_enabled === 1 || dbUser.totp_enabled === true;
        if (has2FA) {
            const twoFactorToken = await twofa_service_1.twoFactorService.createPendingSession(dbUser.id);
            return {
                success: true,
                twoFactorRequired: true,
                twoFactorToken,
            };
        }
        // Générer les tokens (le statut de présence est géré par le gateway au moment de la connexion socket)
        const tokens = await this.generateTokens(dbUser.id, ipAddress, userAgent);
        const user = {
            id: dbUser.id,
            email: dbUser.email,
            username: dbUser.username,
            displayName: dbUser.display_name,
            avatarUrl: dbUser.avatar_url,
            status: dbUser.status || 'offline',
            isOnline: true,
        };
        return {
            success: true,
            user,
            tokens,
            ...(dbUser.key_salt && { keySalt: dbUser.key_salt }),
            ...(dbUser.encrypted_private_key && { encryptedPrivateKey: dbUser.encrypted_private_key }),
            ...(!dbUser.public_key && { keyMissing: true }),
        };
    }
    // Finaliser la connexion après validation du 2FA
    async loginWith2FA(twoFactorToken, totpCode, ipAddress, userAgent) {
        const userId = await twofa_service_1.twoFactorService.resolvePendingSession(twoFactorToken);
        if (!userId) {
            return { success: false, error: 'Session expirée. Veuillez vous reconnecter.' };
        }
        const isValid = await twofa_service_1.twoFactorService.verify(userId, totpCode);
        if (!isValid) {
            return { success: false, error: 'Code 2FA invalide.' };
        }
        const [rows] = await this.db.query('SELECT id, email, username, display_name, avatar_url, status, key_salt, encrypted_private_key, public_key FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0) {
            return { success: false, error: 'Utilisateur introuvable.' };
        }
        const dbUser = users[0];
        const tokens = await this.generateTokens(dbUser.id, ipAddress, userAgent);
        const user = {
            id: dbUser.id,
            email: dbUser.email,
            username: dbUser.username,
            displayName: dbUser.display_name,
            avatarUrl: dbUser.avatar_url,
            status: dbUser.status || 'offline',
            isOnline: true,
        };
        return {
            success: true,
            user,
            tokens,
            ...(dbUser.key_salt && { keySalt: dbUser.key_salt }),
            ...(dbUser.encrypted_private_key && { encryptedPrivateKey: dbUser.encrypted_private_key }),
            ...(!dbUser.public_key && { keyMissing: true }),
        };
    }
    // Rafraîchir les tokens
    async refreshTokens(refreshToken) {
        try {
            // Vérifier le token
            const payload = jsonwebtoken_1.default.verify(refreshToken, this.JWT_REFRESH_SECRET);
            if (payload.type !== 'refresh') {
                return { success: false, error: 'Token invalide' };
            }
            // Vérifier que le token n'est pas révoqué
            const isRevoked = await this.redis.get(`revoked:${refreshToken}`);
            if (isRevoked) {
                return { success: false, error: 'Token révoqué' };
            }
            // Vérifier en base de données
            const [rows] = await this.db.query('SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > NOW()', [refreshToken]);
            if (rows.length === 0) {
                return { success: false, error: 'Session expirée' };
            }
            // Récupérer l'IP/UA de l'ancienne session pour les reporter
            const oldSession = rows[0];
            // Révoquer l'ancien token
            await this.redis.set(`revoked:${refreshToken}`, '1', 7 * 24 * 60 * 60);
            // Supprimer l'ancienne session
            await this.db.execute('DELETE FROM sessions WHERE refresh_token = ?', [refreshToken]);
            // Générer de nouveaux tokens (conserver IP/UA de l'ancienne session)
            const tokens = await this.generateTokens(payload.userId, oldSession.ip_address, oldSession.user_agent);
            return {
                success: true,
                tokens,
            };
        }
        catch (error) {
            return { success: false, error: 'Token invalide ou expiré' };
        }
    }
    // Déconnexion
    async logout(refreshToken) {
        // Révoquer le token
        await this.redis.set(`revoked:${refreshToken}`, '1', 365 * 24 * 60 * 60);
        // Supprimer la session
        await this.db.execute('DELETE FROM sessions WHERE refresh_token = ?', [refreshToken]);
    }
    // Déconnexion de toutes les sessions
    async logoutAll(userId) {
        // Récupérer tous les refresh tokens
        const [rows] = await this.db.query('SELECT refresh_token FROM sessions WHERE user_id = ?', [userId]);
        // Révoquer tous les tokens
        for (const row of rows) {
            await this.redis.set(`revoked:${row.refresh_token}`, '1', 365 * 24 * 60 * 60);
        }
        // Supprimer toutes les sessions
        await this.db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
        // Mettre l'utilisateur hors ligne
        await userService.updateStatus(userId, 'offline');
    }
    // Vérifier un token d'accès
    verifyAccessToken(token) {
        try {
            const payload = jsonwebtoken_1.default.verify(token, this.JWT_SECRET);
            if (payload.type !== 'access') {
                return { valid: false };
            }
            return { valid: true, userId: payload.userId };
        }
        catch {
            return { valid: false };
        }
    }
    // Récupérer l'utilisateur courant
    async getCurrentUser(userId) {
        return userService.findById(userId);
    }
    // Générer les tokens
    async generateTokens(userId, ipAddress, userAgent) {
        // Récupérer le rôle pour l'inclure dans le JWT
        let role = 'user';
        try {
            const [rows] = await this.db.query('SELECT role FROM users WHERE id = ?', [userId]);
            if (rows.length > 0)
                role = rows[0].role || 'user';
        }
        catch { /* fallback to 'user' */ }
        const accessToken = jsonwebtoken_1.default.sign({ userId, type: 'access', role }, this.JWT_SECRET, { expiresIn: this.ACCESS_TOKEN_EXPIRY });
        const refreshToken = jsonwebtoken_1.default.sign({ userId, type: 'refresh' }, this.JWT_REFRESH_SECRET, { expiresIn: this.REFRESH_TOKEN_EXPIRY });
        // Sauvegarder la session
        const sessionId = (0, uuid_1.v4)();
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        await this.db.execute(`INSERT INTO sessions (id, user_id, refresh_token, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`, [sessionId, userId, refreshToken, expiresAt, ipAddress ?? null, userAgent ?? null]);
        return {
            accessToken,
            refreshToken,
            expiresIn: this.ACCESS_TOKEN_EXPIRY_SECONDS,
            sessionId,
        };
    }
    // Lister les sessions actives d'un utilisateur
    async getSessions(userId) {
        const [rows] = await this.db.query('SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > NOW() ORDER BY created_at DESC', [userId]);
        return rows.map((r) => ({
            id: r.id,
            userAgent: r.user_agent ?? null,
            ipAddress: r.ip_address ?? null,
            createdAt: r.created_at,
            expiresAt: r.expires_at,
        }));
    }
    // Révoquer une session spécifique
    async revokeSession(userId, sessionId) {
        const [rows] = await this.db.query('SELECT refresh_token FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
        const sessions = rows;
        if (sessions.length === 0) {
            return { success: false, error: 'Session introuvable' };
        }
        const { refresh_token } = sessions[0];
        await this.redis.set(`revoked:${refresh_token}`, '1', 7 * 24 * 60 * 60);
        await this.db.execute('DELETE FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
        return { success: true };
    }
    // Créer les consentements RGPD par défaut
    async createDefaultConsents(userId) {
        const consentTypes = ['necessary', 'analytics', 'marketing'];
        for (const type of consentTypes) {
            await this.db.execute(`INSERT INTO rgpd_consents (id, user_id, consent_type, granted, granted_at)
         VALUES (?, ?, ?, ?, NOW())`, [(0, uuid_1.v4)(), userId, type, type === 'necessary']);
        }
    }
    // Envoyer un email de vérification
    async sendEmailVerification(userId, email, username) {
        const token = crypto_1.default.randomBytes(48).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        // Supprimer les anciens tokens non utilisés pour cet utilisateur
        await this.db.execute('DELETE FROM email_verification_tokens WHERE user_id = ? AND used = FALSE', [userId]);
        await this.db.execute(`INSERT INTO email_verification_tokens (id, user_id, token, expires_at)
       VALUES (?, ?, ?, ?)`, [(0, uuid_1.v4)(), userId, token, expiresAt]);
        return email_service_1.emailService.sendVerificationEmail(email, username, token);
    }
    // Vérifier un token d'email
    async verifyEmail(token) {
        const [rows] = await this.db.query(`SELECT evt.*, u.username FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token = ? AND evt.used = FALSE AND evt.expires_at > NOW()`, [token]);
        const records = rows;
        if (records.length === 0) {
            return { success: false, error: 'Lien de vérification invalide ou expiré.' };
        }
        const record = records[0];
        await this.db.execute('UPDATE email_verification_tokens SET used = TRUE WHERE id = ?', [record.id]);
        await this.db.execute('UPDATE users SET email_verified = TRUE WHERE id = ?', [record.user_id]);
        return { success: true };
    }
    // Renvoyer un email de vérification
    async resendVerificationEmail(userId) {
        const [rows] = await this.db.query('SELECT id, email, username, email_verified FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0) {
            return { success: false, error: 'Utilisateur introuvable.' };
        }
        const user = users[0];
        if (user.email_verified) {
            return { success: false, error: 'Email déjà vérifié.' };
        }
        const sent = await this.sendEmailVerification(userId, user.email, user.username);
        return sent ? { success: true } : { success: false, error: 'Impossible d\'envoyer l\'email.' };
    }
    // Renvoyer l'email de vérification par adresse email (non authentifié)
    async resendVerificationEmailByAddress(email) {
        const [rows] = await this.db.query('SELECT id, email, username, email_verified FROM users WHERE email = ?', [email]);
        const users = rows;
        if (users.length === 0) {
            // Réponse neutre pour éviter l'énumération d'emails
            return { success: true };
        }
        const user = users[0];
        if (user.email_verified === 1 || user.email_verified === true) {
            return { success: true };
        }
        const sent = await this.sendEmailVerification(user.id, user.email, user.username);
        return sent ? { success: true } : { success: false, error: 'Impossible d\'envoyer l\'email.' };
    }
    // Récupérer les clés E2EE de l'utilisateur courant
    async getUserE2EEKeys(userId) {
        const [rows] = await this.db.query('SELECT key_salt, encrypted_private_key, public_key FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0)
            return { keySalt: null, encryptedPrivateKey: null, publicKey: null };
        return {
            keySalt: users[0].key_salt || null,
            encryptedPrivateKey: users[0].encrypted_private_key || null,
            publicKey: users[0].public_key || null,
        };
    }
    // Sauvegarder les clés E2EE pour un utilisateur existant
    async saveUserKeys(userId, publicKey, encryptedPrivateKey, keySalt) {
        await this.db.execute('UPDATE users SET public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?', [publicKey, encryptedPrivateKey, keySalt, userId]);
        return { success: true };
    }
    // Demander une réinitialisation de mot de passe
    async requestPasswordReset(email) {
        // Toujours retourner succès pour éviter l'énumération des emails
        try {
            const [rows] = await this.db.query('SELECT id, username FROM users WHERE email = ?', [email]);
            const users = rows;
            if (users.length === 0)
                return { success: true };
            const user = users[0];
            const token = crypto_1.default.randomBytes(48).toString('hex');
            // Stocker dans Redis avec TTL de 1h
            await this.redis.set(`pwreset:${token}`, user.id, 3600);
            // Envoyer l'email (best-effort)
            await email_service_1.emailService.sendPasswordResetEmail(email, user.username, token);
        }
        catch (err) {
            // Ne pas exposer l'erreur
        }
        return { success: true };
    }
    // Réinitialiser le mot de passe avec un token
    async resetPassword(token, newPassword) {
        const userId = await this.redis.get(`pwreset:${token}`);
        if (!userId) {
            return { success: false, error: 'Lien invalide ou expiré.' };
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 12);
        // Mettre à jour le mot de passe et effacer les clés E2EE
        // (elles seront régénérées avec le nouveau mot de passe à la prochaine connexion)
        await this.db.execute(`UPDATE users SET
         password_hash = ?,
         encrypted_private_key = NULL,
         key_salt = NULL,
         public_key = NULL
       WHERE id = ?`, [passwordHash, userId]);
        // Supprimer le token utilisé
        await this.redis.del(`pwreset:${token}`);
        // Révoquer toutes les sessions existantes par sécurité
        await this.logoutAll(userId);
        return { success: true };
    }
}
exports.AuthService = AuthService;
exports.authService = new AuthService();
//# sourceMappingURL=auth.service.js.map