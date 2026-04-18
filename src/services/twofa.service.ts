// ==========================================
// ALFYCHAT - SERVICE 2FA (TOTP)
// ==========================================

import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { logger } from '../utils/logger';

const APP_NAME = 'AlfyChat';

// Clé de chiffrement du secret TOTP au repos. Dérivée de TWOFA_ENCRYPTION_KEY
// ou, à défaut, de JWT_SECRET — dans les deux cas on applique un HKDF-like
// SHA-256 pour obtenir une clé 32 octets stable.
function deriveTotpKey(): Buffer {
  const raw = process.env.TWOFA_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!raw) {
    throw new Error('TWOFA_ENCRYPTION_KEY ou JWT_SECRET doit être défini pour chiffrer le secret TOTP');
  }
  return crypto.createHash('sha256').update(`alfychat:totp-key:${raw}`).digest();
}

function encryptTotpSecret(plain: string): string {
  const key = deriveTotpKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: v1:base64(iv|tag|ct)
  return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptTotpSecret(stored: string): string {
  // Rétro-compatible : si la valeur n'a pas le préfixe v1:, on suppose un secret en clair
  // (migration progressive : sera re-chiffré au prochain cycle d'activation).
  if (!stored.startsWith('v1:')) return stored;
  const raw = Buffer.from(stored.slice(3), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveTotpKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export class TwoFactorService {
  private get db() {
    return getDatabaseClient();
  }

  private get redis() {
    return getRedisClient();
  }

  // Générer un secret TOTP et retourner l'URL otpauth + QR code
  async generateSecret(userId: string, userEmail: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  }> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(userEmail, APP_NAME, secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    // Stocker le secret temporaire (pas encore activé) dans Redis, expire dans 10 minutes
    await this.redis.set(`2fa:pending:${userId}`, secret, 10 * 60);

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  // Activer le 2FA après vérification du code OTP
  async enable(userId: string, totpCode: string): Promise<{ success: boolean; error?: string; backupCodes?: string[] }> {
    const pendingSecret = await this.redis.get(`2fa:pending:${userId}`) as string | null;
    if (!pendingSecret) {
      return { success: false, error: 'Session expirée. Veuillez recommencer la configuration.' };
    }

    const isValid = authenticator.verify({ token: totpCode, secret: pendingSecret });
    if (!isValid) {
      return { success: false, error: 'Code invalide. Vérifiez votre application d\'authentification.' };
    }

    // Générer les codes de secours : retournés une seule fois en clair au client,
    // stockés UNIQUEMENT sous forme de hash bcrypt (jamais en clair ni JSON).
    const backupCodes = this.generateBackupCodes();
    const hashedBackupCodes = await Promise.all(
      backupCodes.map((c) => bcrypt.hash(c, 10))
    );
    const storedBackupCodes = JSON.stringify(hashedBackupCodes);

    // Chiffrer le secret TOTP avant persistance (AES-256-GCM)
    const encryptedSecret = encryptTotpSecret(pendingSecret);

    await this.db.execute(
      `UPDATE users SET totp_secret = ?, totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?`,
      [encryptedSecret, storedBackupCodes, userId]
    );

    // Supprimer le secret temporaire
    await this.redis.del(`2fa:pending:${userId}`);

    logger.info(`2FA activé pour l'utilisateur ${userId}`);
    return { success: true, backupCodes };
  }

  // Désactiver le 2FA
  async disable(userId: string, totpCode: string): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query(
      'SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = TRUE',
      [userId]
    );

    const user = (rows as any[])[0];
    if (!user) {
      return { success: false, error: '2FA non activé sur ce compte.' };
    }

    const decryptedSecret = decryptTotpSecret(user.totp_secret);
    const isValid2 = authenticator.verify({ token: totpCode, secret: decryptedSecret });
    if (!isValid2) {
      return { success: false, error: 'Code invalide.' };
    }

    await this.db.execute(
      'UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = ?',
      [userId]
    );

    logger.info(`2FA désactivé pour l'utilisateur ${userId}`);
    return { success: true };
  }

  // Vérifier un code TOTP lors de la connexion
  async verify(userId: string, totpCode: string): Promise<boolean> {
    const [rows] = await this.db.query(
      'SELECT totp_secret, totp_backup_codes FROM users WHERE id = ? AND totp_enabled = TRUE',
      [userId]
    );

    const user = (rows as any[])[0];
    if (!user) return false;

    // Vérifier le code TOTP normal (avec tolérance ±1 step)
    authenticator.options = { window: 1 };
    const decryptedSecret = decryptTotpSecret(user.totp_secret);
    const isValidTotp = authenticator.verify({ token: totpCode, secret: decryptedSecret });
    if (isValidTotp) return true;

    // Vérifier les codes de secours — comparés en bcrypt (hash à usage unique).
    if (user.totp_backup_codes) {
      let stored: string[];
      try {
        stored = JSON.parse(user.totp_backup_codes);
      } catch {
        stored = [];
      }
      const normalizedCode = totpCode.trim().toUpperCase();
      for (let i = 0; i < stored.length; i++) {
        const entry = stored[i];
        // Un hash bcrypt commence par $2a$, $2b$ ou $2y$ — distingue du legacy en clair.
        const isHash = typeof entry === 'string' && /^\$2[aby]\$/.test(entry);
        const match = isHash
          ? await bcrypt.compare(normalizedCode, entry)
          : entry === normalizedCode;
        if (match) {
          // Consommer le code (usage unique)
          stored.splice(i, 1);
          await this.db.execute(
            'UPDATE users SET totp_backup_codes = ? WHERE id = ?',
            [JSON.stringify(stored), userId]
          );
          logger.info(`Code de secours 2FA utilisé pour ${userId}`);
          return true;
        }
      }
    }

    return false;
  }

  // Vérifier si l'utilisateur a le 2FA activé
  async isEnabled(userId: string): Promise<boolean> {
    const [rows] = await this.db.query(
      'SELECT totp_enabled FROM users WHERE id = ?',
      [userId]
    );
    const user = (rows as any[])[0];
    return user?.totp_enabled === 1 || user?.totp_enabled === true;
  }

  // Créer un token de connexion intermédiaire (attend le code 2FA)
  async createPendingSession(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.redis.set(`2fa:session:${token}`, userId, 5 * 60);
    return token;
  }

  // Résoudre le token de session en attente
  async resolvePendingSession(token: string): Promise<string | null> {
    const userId = await this.redis.get(`2fa:session:${token}`) as string | null;
    if (!userId) return null;
    await this.redis.del(`2fa:session:${token}`);
    return userId;
  }

  // Générer des codes de secours (RNG cryptographique — jamais Math.random pour un secret)
  private generateBackupCodes(count = 8): string[] {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const bytes = crypto.randomBytes(8);
      let code = '';
      for (let j = 0; j < 8; j++) code += chars[bytes[j] % chars.length];
      codes.push(code);
    }
    return codes;
  }
}

export const twoFactorService = new TwoFactorService();
