// ==========================================
// ALFYCHAT - SERVICE AUTHENTIFICATION
// ==========================================

import { hashPassword, verifyPassword, burnPasswordComparison } from '../utils/password';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { UserService } from './users.service';
import { emailService } from './email.service';
import { twoFactorService } from './twofa.service';
import { checkUsername } from '../utils/username-filter';
import { logger } from '../utils/logger';
import { User } from '../types/user';

const userService = new UserService();

interface TokenPayload {
  userId: string;
  type: 'access' | 'refresh';
  role?: 'user' | 'moderator' | 'admin';
  /** Identifiant de la session (ligne `sessions`) qui a émis ce jeton. */
  sid?: string;
}

/**
 * Les refresh tokens (valables 365 jours) étaient stockés EN CLAIR : une fuite
 * de la table `sessions` donnait un accès durable à tous les comptes. Seule
 * leur empreinte SHA-256 est désormais stockée (et sert de clé de révocation).
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Coupe les connexions temps réel d'un utilisateur (révocation de sessions).
 * Sans cela, une socket ouverte survivait à « déconnecter tous les appareils »
 * et au changement de mot de passe.
 */
export async function disconnectUserSockets(userId: string): Promise<void> {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) return;
  try {
    await fetch(`${process.env.GATEWAY_URL || 'http://localhost:3000'}/internal/users/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    logger.warn(`Gateway injoignable pour couper les sockets de ${userId}`);
  }
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
  banned?: boolean;
}

export class AuthService {
  private readonly JWT_SECRET: string;
  private readonly JWT_REFRESH_SECRET: string;
  private readonly ACCESS_TOKEN_EXPIRY = '15m';
  private readonly REFRESH_TOKEN_EXPIRY = '365d';
  private readonly ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;

  constructor() {
    const secret = process.env.JWT_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!secret) throw new Error('JWT_SECRET environment variable is required');
    if (!refreshSecret) throw new Error('JWT_REFRESH_SECRET environment variable is required');
    this.JWT_SECRET = secret;
    this.JWT_REFRESH_SECRET = refreshSecret;
  }

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
    // Filtrer les pseudos injurieux ou usurpant l'identité du staff
    const usernameCheck = checkUsername(data.username);
    if (!usernameCheck.ok) {
      return { success: false, error: usernameCheck.reason };
    }

    // Le nom affiché est libre en caractères mais soumis au même filtre
    if (data.displayName && data.displayName !== data.username) {
      const displayCheck = checkUsername(data.displayName);
      if (!displayCheck.ok) {
        return { success: false, error: displayCheck.reason };
      }
    }

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
    const passwordHash = await hashPassword(data.password);

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

    // Ne PAS générer de session ici : un compte fraîchement créé n'a jamais son
    // email vérifié (`email_verified` vaut FALSE par défaut en base), donc le
    // délivrer connecté reviendrait à contourner la vérification obligatoire
    // déjà appliquée sur /login. Le frontend retombe sur login(), qui applique
    // exactement le même contrôle `emailNotVerified` que pour une connexion
    // classique.
    return {
      success: true,
      user,
      emailNotVerified: true,
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
      // Consommer le même temps CPU qu'une vérification réelle : sans cela, une
      // adresse inconnue répondait instantanément là où une adresse connue
      // coûtait ~300 ms de bcrypt — un oracle d'existence de compte, malgré le
      // message d'erreur identique.
      await burnPasswordComparison(password);
      return { success: false, error: 'Email ou mot de passe incorrect' };
    }

    const dbUser = users[0];

    // Vérifier le mot de passe
    const isValid = await verifyPassword(password, dbUser.password_hash);
    if (!isValid) {
      return { success: false, error: 'Email ou mot de passe incorrect' };
    }

    // Compte banni — refuser avant toute autre étape
    const ban = await this.checkBan(dbUser.id);
    if (ban) {
      return { success: false, error: ban, banned: true };
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

    // Générer les tokens (le statut de présence est géré par le gateway au moment de la connexion socket)
    const tokens = await this.generateTokens(dbUser.id, ipAddress, userAgent);

    const user: User = {
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

    // Le ban a pu tomber entre la saisie du mot de passe et celle du code 2FA
    const ban = await this.checkBan(dbUser.id);
    if (ban) {
      return { success: false, error: ban, banned: true };
    }

    const tokens = await this.generateTokens(dbUser.id, ipAddress, userAgent);

    const user: User = {
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
  async refreshTokens(refreshToken: string): Promise<AuthResult> {
    try {
      // Vérifier le token
      const payload = jwt.verify(refreshToken, this.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as TokenPayload;

      if (payload.type !== 'refresh') {
        return { success: false, error: 'Token invalide' };
      }

      const tokenHash = hashRefreshToken(refreshToken);

      // Réutilisation d'un refresh token déjà consommé = vol probable (la
      // rotation fait qu'un client légitime ne le présente qu'une fois) : on
      // révoque TOUTES les sessions du compte.
      const isRevoked = await this.redis.get(`revoked:${tokenHash}`);
      if (isRevoked) {
        logger.warn(`Réutilisation d'un refresh token révoqué pour ${payload.userId} — toutes les sessions sont révoquées`);
        await this.logoutAll(payload.userId);
        return { success: false, error: 'Token révoqué' };
      }

      // Vérifier en base de données
      const [rows] = await this.db.query(
        'SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > NOW()',
        [tokenHash]
      );

      if ((rows as any[]).length === 0) {
        return { success: false, error: 'Session expirée' };
      }

      // Récupérer l'IP/UA de l'ancienne session pour les reporter
      const oldSession = (rows as any[])[0];

      // Un compte banni ne renouvelle plus ses jetons.
      const ban = await this.checkBan(payload.userId);
      if (ban) {
        return { success: false, error: ban, banned: true };
      }

      // Révoquer l'ancien token (marqueur conservé assez longtemps pour
      // détecter une réutilisation)
      await this.redis.set(`revoked:${tokenHash}`, '1', 30 * 24 * 60 * 60);

      // Supprimer l'ancienne session
      await this.db.execute(
        'DELETE FROM sessions WHERE refresh_token = ?',
        [tokenHash]
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

  // Déconnexion — uniquement une session de l'appelant.
  async logout(refreshToken: string, userId: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    const [rows] = await this.db.query(
      'SELECT id FROM sessions WHERE refresh_token = ? AND user_id = ?',
      [tokenHash, userId]
    );
    if ((rows as any[]).length === 0) return;

    // Révoquer le token
    await this.redis.set(`revoked:${tokenHash}`, '1', 365 * 24 * 60 * 60);

    // Supprimer la session
    await this.db.execute(
      'DELETE FROM sessions WHERE refresh_token = ? AND user_id = ?',
      [tokenHash, userId]
    );
  }

  /**
   * Révoque toutes les sessions d'un utilisateur, sauf éventuellement
   * `keepSessionId` (la session courante lors d'un changement de mot de passe).
   */
  async revokeSessions(userId: string, keepSessionId?: string): Promise<void> {
    const [rows] = await this.db.query(
      keepSessionId
        ? 'SELECT refresh_token FROM sessions WHERE user_id = ? AND id <> ?'
        : 'SELECT refresh_token FROM sessions WHERE user_id = ?',
      keepSessionId ? [userId, keepSessionId] : [userId]
    );
    for (const row of rows as any[]) {
      await this.redis.set(`revoked:${row.refresh_token}`, '1', 365 * 24 * 60 * 60);
    }
    await this.db.execute(
      keepSessionId
        ? 'DELETE FROM sessions WHERE user_id = ? AND id <> ?'
        : 'DELETE FROM sessions WHERE user_id = ?',
      keepSessionId ? [userId, keepSessionId] : [userId]
    );
    // Les sockets ouvertes survivaient à la révocation.
    await disconnectUserSockets(userId);
  }

  // Déconnexion de toutes les sessions
  async logoutAll(userId: string): Promise<void> {
    await this.revokeSessions(userId);

    // Mettre l'utilisateur hors ligne
    await userService.updateStatus(userId, 'offline');
  }

  // Vérifier un token d'accès
  verifyAccessToken(token: string): { valid: boolean; userId?: string } {
    try {
      const payload = jwt.verify(token, this.JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
      
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

  /**
   * Retourne le message de bannissement si le compte est banni, sinon null.
   * Lit directement les sanctions actives : les colonnes dénormalisées de
   * `users` peuvent référencer un ban temporaire déjà expiré.
   */
  private async checkBan(userId: string): Promise<string | null> {
    try {
      const [rows] = await this.db.query(
        `SELECT reason, expires_at FROM moderation_sanctions
         WHERE user_id = ? AND type = 'ban' AND revoked = FALSE
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY expires_at IS NULL DESC, expires_at DESC
         LIMIT 1`,
        [userId]
      );
      const bans = rows as any[];
      if (bans.length === 0) return null;

      const { reason, expires_at } = bans[0];
      if (!expires_at) {
        return `Ce compte est banni définitivement. Motif : ${reason}`;
      }
      const until = new Date(expires_at).toLocaleString('fr-FR');
      return `Ce compte est suspendu jusqu'au ${until}. Motif : ${reason}`;
    } catch (err) {
      // Un contrôle d'autorisation qui ne peut pas s'exécuter doit REFUSER.
      // L'ancien `return null` (« ne pas bloquer la connexion ») rouvrait
      // l'accès à tous les comptes bannis dès que la base devenait
      // momentanément inaccessible.
      logger.error('checkBan: vérification impossible, connexion refusée', { err });
      return 'Vérification du compte impossible pour le moment. Réessayez dans quelques instants.';
    }
  }

  // Générer les tokens
  private async generateTokens(userId: string, ipAddress?: string | null, userAgent?: string | null) {
    // Récupérer le rôle pour l'inclure dans le JWT
    let role: 'user' | 'moderator' | 'admin' = 'user';
    try {
      const [rows] = await this.db.query('SELECT role FROM users WHERE id = ?', [userId]);
      if ((rows as any[]).length > 0) role = (rows as any[])[0].role || 'user';
    } catch { /* fallback to 'user' */ }

    // L'identifiant de session est connu AVANT la signature : il est porté par
    // le jeton d'accès (`sid`), ce qui permet de révoquer « toutes les autres
    // sessions » en épargnant la courante.
    const sessionId = uuidv4();

    const accessToken = jwt.sign(
      { userId, type: 'access', role, sid: sessionId } as TokenPayload,
      this.JWT_SECRET,
      { expiresIn: this.ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' }
    );

    const refreshToken = jwt.sign(
      { userId, type: 'refresh', sid: sessionId, jti: uuidv4() } as TokenPayload & { jti: string },
      this.JWT_REFRESH_SECRET,
      { expiresIn: this.REFRESH_TOKEN_EXPIRY, algorithm: 'HS256' }
    );

    // Sauvegarder la session — empreinte du refresh token uniquement
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await this.db.execute(
      `INSERT INTO sessions (id, user_id, refresh_token, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, userId, hashRefreshToken(refreshToken), expiresAt, ipAddress ?? null, (userAgent ?? '').slice(0, 512) || null]
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ACCESS_TOKEN_EXPIRY_SECONDS,
      sessionId,
    };
  }

  /**
   * Émet une session pour un compte dont l'identité a déjà été prouvée par un
   * AUTRE appareil authentifié (connexion par QR code).
   *
   * Ne fait aucune vérification d'identité : l'appelant est responsable de
   * l'avoir établie. Réservé à `remote-auth.service`, qui exige une
   * approbation explicite depuis un appareil déjà connecté.
   */
  async issueTokensForUser(
    userId: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ) {
    return this.generateTokens(userId, ipAddress, userAgent);
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
    await this.redis.set(`revoked:${refresh_token}`, '1', 365 * 24 * 60 * 60);
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

  // Récupérer les clés E2EE de l'utilisateur courant
  async getUserE2EEKeys(userId: string): Promise<{ keySalt: string | null; encryptedPrivateKey: string | null; publicKey: string | null }> {
    const [rows] = await this.db.query(
      'SELECT key_salt, encrypted_private_key, public_key FROM users WHERE id = ?',
      [userId]
    );
    const users = rows as any[];
    if (users.length === 0) return { keySalt: null, encryptedPrivateKey: null, publicKey: null };
    return {
      keySalt: users[0].key_salt || null,
      encryptedPrivateKey: users[0].encrypted_private_key || null,
      publicKey: users[0].public_key || null,
    };
  }

  // Sauvegarder les clés E2EE pour un utilisateur existant.
  // Remplacer une clé EXISTANTE exige le mot de passe : un jeton d'accès volé
  // (15 min) suffisait à substituer sa propre clé publique et à intercepter
  // les messages chiffrés suivants.
  async saveUserKeys(userId: string, publicKey: string, encryptedPrivateKey: string, keySalt: string, password?: string): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query('SELECT public_key, password_hash FROM users WHERE id = ?', [userId]);
    const row = (rows as any[])[0];
    if (!row) return { success: false, error: 'Utilisateur introuvable' };
    if (row.public_key) {
      if (typeof password !== 'string' || !password || !(await verifyPassword(password, row.password_hash))) {
        return { success: false, error: 'Mot de passe requis pour remplacer vos clés de chiffrement' };
      }
    }
    await this.db.execute(
      'UPDATE users SET public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?',
      [publicKey, encryptedPrivateKey, keySalt, userId]
    );
    return { success: true };
  }

  // Demander une réinitialisation de mot de passe
  async requestPasswordReset(email: string): Promise<{ success: boolean }> {
    // Toujours retourner succès pour éviter l'énumération des emails
    try {
      const [rows] = await this.db.query(
        'SELECT id, username FROM users WHERE email = ?',
        [email]
      );
      const users = rows as any[];
      if (users.length === 0) return { success: true };

      const user = users[0];
      // Un seul lien valide à la fois : le précédent est invalidé.
      const previous = await this.redis.get(`pwreset:user:${user.id}`);
      if (previous) await this.redis.del(`pwreset:${previous}`);
      const token = crypto.randomBytes(48).toString('hex');
      // Stocker dans Redis avec TTL de 1h
      await this.redis.set(`pwreset:${token}`, user.id, 3600);
      await this.redis.set(`pwreset:user:${user.id}`, token, 3600);
      // Envoyer l'email (best-effort)
      await emailService.sendPasswordResetEmail(email, user.username, token);
    } catch (err) {
      // Ne pas exposer l'erreur
    }
    return { success: true };
  }

  // Réinitialiser le mot de passe avec un token
  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    const userId = await this.redis.get(`pwreset:${token}`);
    if (!userId) {
      return { success: false, error: 'Lien invalide ou expiré.' };
    }

    const passwordHash = await hashPassword(newPassword);

    // Mettre à jour le mot de passe et effacer les clés E2EE
    // (elles seront régénérées avec le nouveau mot de passe à la prochaine connexion)
    await this.db.execute(
      `UPDATE users SET
         password_hash = ?,
         encrypted_private_key = NULL,
         key_salt = NULL,
         public_key = NULL
       WHERE id = ?`,
      [passwordHash, userId]
    );

    // Supprimer le token utilisé (et tout autre lien de réinitialisation en cours)
    await this.redis.del(`pwreset:${token}`);
    await this.redis.del(`pwreset:user:${userId}`);

    // Révoquer toutes les sessions existantes par sécurité
    await this.logoutAll(userId);

    return { success: true };
  }
}

export const authService = new AuthService();
