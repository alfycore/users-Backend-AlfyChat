// ==========================================
// ALFYCHAT - SERVICE 2FA (TOTP)
// ==========================================

import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { logger } from '../utils/logger';

const APP_NAME = 'AlfyChat';

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

    // Générer les codes de secours
    const backupCodes = this.generateBackupCodes();
    const backupCodesHash = JSON.stringify(backupCodes);

    // Sauvegarder le secret en base
    await this.db.execute(
      `UPDATE users SET totp_secret = ?, totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?`,
      [pendingSecret, backupCodesHash, userId]
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

    const isValid2 = authenticator.verify({ token: totpCode, secret: user.totp_secret });
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
    const isValidTotp = authenticator.verify({ token: totpCode, secret: user.totp_secret });
    if (isValidTotp) return true;

    // Vérifier les codes de secours
    if (user.totp_backup_codes) {
      const backupCodes: string[] = JSON.parse(user.totp_backup_codes);
      const normalizedCode = totpCode.trim().toUpperCase();
      const idx = backupCodes.indexOf(normalizedCode);
      if (idx !== -1) {
        // Consommer le code de secours (usage unique)
        backupCodes.splice(idx, 1);
        await this.db.execute(
          'UPDATE users SET totp_backup_codes = ? WHERE id = ?',
          [JSON.stringify(backupCodes), userId]
        );
        logger.info(`Code de secours 2FA utilisé pour ${userId}`);
        return true;
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
