// ==========================================
// ALFYCHAT - SERVICE 2FA (TOTP — RFC 6238)
// Implémentation native via Node.js crypto
// ==========================================

import crypto from 'crypto';
import qrcode from 'qrcode';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { logger } from '../utils/logger';

const APP_NAME = 'AlfyChat';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ── Base32 ────────────────────────────────────────────────────────────────────

function base32Encode(buf: Buffer): string {
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) result += BASE32[(value << (5 - bits)) & 0x1f];
  return result;
}

function base32Decode(str: string): Buffer {
  const s = str.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff); }
  }
  return Buffer.from(bytes);
}

// ── TOTP core (RFC 6238 / RFC 4226) ──────────────────────────────────────────

function hotp(secretBuf: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

function totpGenerate(secretBase32: string): string {
  return hotp(base32Decode(secretBase32), Math.floor(Date.now() / 1000 / 30));
}

function totpVerify(token: string, secretBase32: string, window = 1): boolean {
  const secretBuf = base32Decode(secretBase32);
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (hotp(secretBuf, step + i) === token) return true;
  }
  return false;
}

function totpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function totpKeyUri(account: string, issuer: string, secret: string): string {
  const p = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${p.toString()}`;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TwoFactorService {
  private get db() { return getDatabaseClient(); }
  private get redis() { return getRedisClient(); }

  async generateSecret(userId: string, userEmail: string): Promise<{
    secret: string; otpauthUrl: string; qrCodeDataUrl: string;
  }> {
    const secret = totpSecret();
    const otpauthUrl = totpKeyUri(userEmail, APP_NAME, secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    await this.redis.set(`2fa:pending:${userId}`, secret, 10 * 60);
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enable(userId: string, totpCode: string): Promise<{ success: boolean; error?: string; backupCodes?: string[] }> {
    const pendingSecret = await this.redis.get(`2fa:pending:${userId}`) as string | null;
    if (!pendingSecret) return { success: false, error: 'Session expirée. Veuillez recommencer la configuration.' };

    if (!totpVerify(totpCode, pendingSecret)) {
      return { success: false, error: 'Code invalide. Vérifiez votre application d\'authentification.' };
    }

    const backupCodes = this.generateBackupCodes();
    await this.db.execute(
      `UPDATE users SET totp_secret = ?, totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?`,
      [pendingSecret, JSON.stringify(backupCodes), userId]
    );
    await this.redis.del(`2fa:pending:${userId}`);
    logger.info(`2FA activé pour l'utilisateur ${userId}`);
    return { success: true, backupCodes };
  }

  async disable(userId: string, totpCode: string): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query(
      'SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = TRUE', [userId]
    );
    const user = (rows as any[])[0];
    if (!user) return { success: false, error: '2FA non activé sur ce compte.' };

    if (!totpVerify(totpCode, user.totp_secret)) {
      return { success: false, error: 'Code invalide.' };
    }

    await this.db.execute(
      'UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = ?', [userId]
    );
    logger.info(`2FA désactivé pour l'utilisateur ${userId}`);
    return { success: true };
  }

  async verify(userId: string, totpCode: string): Promise<boolean> {
    const [rows] = await this.db.query(
      'SELECT totp_secret, totp_backup_codes FROM users WHERE id = ? AND totp_enabled = TRUE', [userId]
    );
    const user = (rows as any[])[0];
    if (!user) return false;

    // Code TOTP normal (tolérance ±1 step)
    if (totpVerify(totpCode, user.totp_secret, 1)) return true;

    // Codes de secours (usage unique)
    if (user.totp_backup_codes) {
      const backupCodes: string[] = JSON.parse(user.totp_backup_codes);
      const normalizedCode = totpCode.trim().toUpperCase();
      const idx = backupCodes.indexOf(normalizedCode);
      if (idx !== -1) {
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

  async isEnabled(userId: string): Promise<boolean> {
    const [rows] = await this.db.query('SELECT totp_enabled FROM users WHERE id = ?', [userId]);
    const user = (rows as any[])[0];
    return user?.totp_enabled === 1 || user?.totp_enabled === true;
  }

  async createPendingSession(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.redis.set(`2fa:session:${token}`, userId, 5 * 60);
    return token;
  }

  async resolvePendingSession(token: string): Promise<string | null> {
    const userId = await this.redis.get(`2fa:session:${token}`) as string | null;
    if (!userId) return null;
    await this.redis.del(`2fa:session:${token}`);
    return userId;
  }

  private generateBackupCodes(count = 8): string[] {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: count }, () =>
      Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    );
  }
}

export const twoFactorService = new TwoFactorService();
