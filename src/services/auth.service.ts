// ==========================================
// ALFYCHAT - SERVICE AUTHENTIFICATION
// ==========================================

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { UserService } from './users.service';
import { emailService } from './email.service';
import { twoFactorService } from './twofa.service';
import { User } from '../types/user';

const userService = new UserService();

interface TokenPayload {
  userId: string;
  type: 'access' | 'refresh';
}

interface AuthResult {
  success: boolean;
  error?: string;
  user?: User;
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    sessionId: string;
  };
  twoFactorRequired?: boolean;
  twoFactorToken?: string;
  keySalt?: string;
  encryptedPrivateKey?: string;
  emailNotVerified?: boolean;
  keyMissing?: boolean;
}

export class AuthService {
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'alfychat-super-secret-key-dev-2026';
  private readonly ACCESS_TOKEN_EXPIRY = '15m';
  private readonly REFRESH_TOKEN_EXPIRY = '365d';
  private readonly ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;

  private get db() {
    return getDatabaseClient();
  }

  private get redis() {
    return getRedisClient();
  }

  // Inscription
  async register(data: {
    email: string;
    username: string;
    password: string;
    displayName: string;
    publicKey?: string;
    encryptedPrivateKey?: string;
    keySalt?: string;
  }, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
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
    const passwordHash = await bcrypt.hash(data.password, 12);

    // Créer l'utilisateur
    const userId = uuidv4();
    const user = await userService.create({
      id: userId,
      email: data.email,
      username: data.username,
      displayName: data.displayName,
      passwordHash,
    });

    // Stocker les clés E2EE si fournies
    if (data.publicKey && data.encryptedPrivateKey && data.keySalt) {
      await this.db.execute(
        'UPDATE users SET public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?',
        [data.publicKey, data.encryptedPrivateKey, data.keySalt, userId]
      );
    }

    // Créer les consentements RGPD par défaut
    await this.createDefaultConsents(userId);

    // Envoyer l'email de vérification (non bloquant)
    this.sendEmailVerification(userId, data.email, data.username || data.displayName).catch(() => {});

    // Générer les tokens
    const tokens = await this.generateTokens(userId, ipAddress, userAgent);

    return {
      success: true,
      user,
      tokens,
    };
  }

  // Connexion
  async login(email: string, password: string, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
    // Chercher l'utilisateur
    const [rows] = await this.db.query(
      'SELECT id, email, username, display_name, avatar_url, status, password_hash, totp_enabled, email_verified, key_salt, encrypted_private_key, public_key FROM users WHERE email = ?',
      [email]
    );

    const users = rows as any[];
    if (users.length === 0) {
      return { success: false, error: 'Email ou mot de passe incorrect' };
    }

    const dbUser = users[0];

    // Vérifier le mot de passe
    const isValid = await bcrypt.compare(password, dbUser.password_hash);
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
      const twoFactorToken = await twoFactorService.createPendingSession(dbUser.id);
      return {
        success: true,
        twoFactorRequired: true,
        twoFactorToken,
      };
    }

    // Mettre à jour le statut
    await userService.updateStatus(dbUser.id, 'online');

    // Générer les tokens
    const tokens = await this.generateTokens(dbUser.id, ipAddress, userAgent);

    const user: User = {
      id: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
      displayName: dbUser.display_name,
      avatarUrl: dbUser.avatar_url,
      status: 'online',
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
  async loginWith2FA(twoFactorToken: string, totpCode: string, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
    const userId = await twoFactorService.resolvePendingSession(twoFactorToken);
    if (!userId) {
      return { success: false, error: 'Session expirée. Veuillez vous reconnecter.' };
    }

    const isValid = await twoFactorService.verify(userId, totpCode);
    if (!isValid) {
      return { success: false, error: 'Code 2FA invalide.' };
    }

    const [rows] = await this.db.query(
      'SELECT id, email, username, display_name, avatar_url, status, key_salt, encrypted_private_key, public_key FROM users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0) {
      return { success: false, error: 'Utilisateur introuvable.' };
    }

    const dbUser = users[0];
    await userService.updateStatus(dbUser.id, 'online');
    const tokens = await this.generateTokens(dbUser.id, ipAddress, userAgent);

    const user: User = {
      id: dbUser.id,
      email: dbUser.email,
      username: dbUser.username,
      displayName: dbUser.display_name,
      avatarUrl: dbUser.avatar_url,
      status: 'online',
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
  async refreshTokens(refreshToken: string): Promise<AuthResult> {
    try {
      // Vérifier le token
      const payload = jwt.verify(refreshToken, this.JWT_SECRET) as TokenPayload;

      if (payload.type !== 'refresh') {
        return { success: false, error: 'Token invalide' };
      }

      // Vérifier que le token n'est pas révoqué
      const isRevoked = await this.redis.get(`revoked:${refreshToken}`);
      if (isRevoked) {
        return { success: false, error: 'Token révoqué' };
      }

      // Vérifier en base de données
      const [rows] = await this.db.query(
        'SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > NOW()',
        [refreshToken]
      );

      if ((rows as any[]).length === 0) {
        return { success: false, error: 'Session expirée' };
      }

      // Récupérer l'IP/UA de l'ancienne session pour les reporter
      const oldSession = (rows as any[])[0];

      // Révoquer l'ancien token
      await this.redis.set(`revoked:${refreshToken}`, '1', 7 * 24 * 60 * 60);

      // Supprimer l'ancienne session
      await this.db.execute(
        'DELETE FROM sessions WHERE refresh_token = ?',
        [refreshToken]
      );

      // Générer de nouveaux tokens (conserver IP/UA de l'ancienne session)
      const tokens = await this.generateTokens(payload.userId, oldSession.ip_address, oldSession.user_agent);

      return {
        success: true,
        tokens,
      };
    } catch (error) {
      return { success: false, error: 'Token invalide ou expiré' };
    }
  }

  // Déconnexion
  async logout(refreshToken: string): Promise<void> {
    // Révoquer le token
    await this.redis.set(`revoked:${refreshToken}`, '1', 365 * 24 * 60 * 60);

    // Supprimer la session
    await this.db.execute(
      'DELETE FROM sessions WHERE refresh_token = ?',
      [refreshToken]
    );
  }

  // Déconnexion de toutes les sessions
  async logoutAll(userId: string): Promise<void> {
    // Récupérer tous les refresh tokens
    const [rows] = await this.db.query(
      'SELECT refresh_token FROM sessions WHERE user_id = ?',
      [userId]
    );

    // Révoquer tous les tokens
    for (const row of rows as any[]) {
      await this.redis.set(`revoked:${row.refresh_token}`, '1', 365 * 24 * 60 * 60);
    }

    // Supprimer toutes les sessions
    await this.db.execute(
      'DELETE FROM sessions WHERE user_id = ?',
      [userId]
    );

    // Mettre l'utilisateur hors ligne
    await userService.updateStatus(userId, 'offline');
  }

  // Vérifier un token d'accès
  verifyAccessToken(token: string): { valid: boolean; userId?: string } {
    try {
      const payload = jwt.verify(token, this.JWT_SECRET) as TokenPayload;
      
      if (payload.type !== 'access') {
        return { valid: false };
      }

      return { valid: true, userId: payload.userId };
    } catch {
      return { valid: false };
    }
  }

  // Récupérer l'utilisateur courant
  async getCurrentUser(userId: string): Promise<User | null> {
    return userService.findById(userId);
  }

  // Générer les tokens
  private async generateTokens(userId: string, ipAddress?: string | null, userAgent?: string | null) {
    const accessToken = jwt.sign(
      { userId, type: 'access' } as TokenPayload,
      this.JWT_SECRET,
      { expiresIn: this.ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = jwt.sign(
      { userId, type: 'refresh' } as TokenPayload,
      this.JWT_SECRET,
      { expiresIn: this.REFRESH_TOKEN_EXPIRY }
    );

    // Sauvegarder la session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await this.db.execute(
      `INSERT INTO sessions (id, user_id, refresh_token, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, userId, refreshToken, expiresAt, ipAddress ?? null, userAgent ?? null]
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ACCESS_TOKEN_EXPIRY_SECONDS,
      sessionId,
    };
  }

  // Lister les sessions actives d'un utilisateur
  async getSessions(userId: string): Promise<{ id: string; userAgent: string | null; ipAddress: string | null; createdAt: Date; expiresAt: Date }[]> {
    const [rows] = await this.db.query(
      'SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > NOW() ORDER BY created_at DESC',
      [userId]
    );
    return (rows as any[]).map((r) => ({
      id: r.id,
      userAgent: r.user_agent ?? null,
      ipAddress: r.ip_address ?? null,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  }

  // Révoquer une session spécifique
  async revokeSession(userId: string, sessionId: string): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query(
      'SELECT refresh_token FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId]
    );
    const sessions = rows as any[];
    if (sessions.length === 0) {
      return { success: false, error: 'Session introuvable' };
    }
    const { refresh_token } = sessions[0];
    await this.redis.set(`revoked:${refresh_token}`, '1', 7 * 24 * 60 * 60);
    await this.db.execute('DELETE FROM sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
    return { success: true };
  }

  // Créer les consentements RGPD par défaut
  private async createDefaultConsents(userId: string): Promise<void> {
    const consentTypes = ['necessary', 'analytics', 'marketing'];
    
    for (const type of consentTypes) {
      await this.db.execute(
        `INSERT INTO rgpd_consents (id, user_id, consent_type, granted, granted_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [uuidv4(), userId, type, type === 'necessary']
      );
    }
  }

  // Envoyer un email de vérification
  async sendEmailVerification(userId: string, email: string, username: string): Promise<boolean> {
    const token = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Supprimer les anciens tokens non utilisés pour cet utilisateur
    await this.db.execute(
      'DELETE FROM email_verification_tokens WHERE user_id = ? AND used = FALSE',
      [userId]
    );

    await this.db.execute(
      `INSERT INTO email_verification_tokens (id, user_id, token, expires_at)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), userId, token, expiresAt]
    );

    return emailService.sendVerificationEmail(email, username, token);
  }

  // Vérifier un token d'email
  async verifyEmail(token: string): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query(
      `SELECT evt.*, u.username FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token = ? AND evt.used = FALSE AND evt.expires_at > NOW()`,
      [token]
    );

    const records = rows as any[];
    if (records.length === 0) {
      return { success: false, error: 'Lien de vérification invalide ou expiré.' };
    }

    const record = records[0];

    await this.db.execute(
      'UPDATE email_verification_tokens SET used = TRUE WHERE id = ?',
      [record.id]
    );

    await this.db.execute(
      'UPDATE users SET email_verified = TRUE WHERE id = ?',
      [record.user_id]
    );

    return { success: true };
  }

  // Renvoyer un email de vérification
  async resendVerificationEmail(userId: string): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query(
      'SELECT id, email, username, email_verified FROM users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
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
  async resendVerificationEmailByAddress(email: string): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query(
      'SELECT id, email, username, email_verified FROM users WHERE email = ?',
      [email]
    );
    const users = rows as any[];
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

  // Sauvegarder les clés E2EE pour un utilisateur existant
  async saveUserKeys(userId: string, publicKey: string, encryptedPrivateKey: string, keySalt: string): Promise<{ success: boolean; error?: string }> {
    await this.db.execute(
      'UPDATE users SET public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?',
      [publicKey, encryptedPrivateKey, keySalt, userId]
    );
    return { success: true };
  }
}

export const authService = new AuthService();
