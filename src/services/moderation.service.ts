// ==========================================
// ALFYCHAT - SERVICE MODÉRATION GLOBALE
// Avertissements, mutes, kicks et bannissements à l'échelle de la plateforme.
// ==========================================

import { v4 as uuidv4 } from 'uuid';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { setCustomTerms, TermMatch } from '../utils/username-filter';
import { logger } from '../utils/logger';

export type SanctionType = 'warn' | 'mute' | 'kick' | 'ban';

export interface Sanction {
  id: string;
  userId: string;
  username?: string;
  displayName?: string;
  type: SanctionType;
  reason: string;
  /** null = permanent */
  expiresAt: Date | null;
  issuedBy: string | null;
  issuedByUsername?: string | null;
  revoked: boolean;
  revokedBy: string | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
  /** Calculé : sanction toujours en vigueur */
  active: boolean;
}

export interface ModerationStatus {
  banned: boolean;
  bannedUntil: Date | null;
  banReason: string | null;
  muted: boolean;
  mutedUntil: Date | null;
  muteReason: string | null;
  warnings: number;
}

export interface ModerationTerm {
  id: string;
  term: string;
  matchType: TermMatch;
  createdBy: string | null;
  createdAt: Date;
}

const CLEAN_STATUS: ModerationStatus = {
  banned: false,
  bannedUntil: null,
  banReason: null,
  muted: false,
  mutedUntil: null,
  muteReason: null,
  warnings: 0,
};

/** TTL court : une sanction doit s'appliquer presque immédiatement */
const STATUS_CACHE_TTL = 30;

export class ModerationService {
  private get db() {
    return getDatabaseClient();
  }

  private get redis() {
    return getRedisClient();
  }

  // ============ SANCTIONS ============

  /**
   * Applique une sanction. `durationMinutes` absent ou null = permanent
   * (sans objet pour `warn` et `kick`, qui sont ponctuels).
   */
  async applySanction(data: {
    userId: string;
    type: SanctionType;
    reason: string;
    durationMinutes?: number | null;
    issuedBy: string | null;
  }): Promise<Sanction> {
    const id = uuidv4();
    const isTemporary =
      (data.type === 'ban' || data.type === 'mute') &&
      typeof data.durationMinutes === 'number' &&
      data.durationMinutes > 0;

    const expiresAt = isTemporary
      ? new Date(Date.now() + (data.durationMinutes as number) * 60_000)
      : null;

    await this.db.execute(
      `INSERT INTO moderation_sanctions (id, user_id, type, reason, expires_at, issued_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.userId, data.type, data.reason, expiresAt, data.issuedBy]
    );

    // Un ban et un kick coupent immédiatement l'accès
    if (data.type === 'ban' || data.type === 'kick') {
      await this.revokeAllSessions(data.userId);
    }

    await this.refreshUserFlags(data.userId);

    // Couper les WebSockets ouverts — sans ça, un banni reste connecté
    // jusqu'à sa prochaine reconnexion.
    this.notifyGateway(data.userId, data.type, data.reason, expiresAt).catch(() => {});

    const sanction = await this.getSanction(id);
    if (!sanction) throw new Error('Sanction non créée');
    return sanction;
  }

  /** Lève une sanction (débannissement, démute…) */
  async revokeSanction(
    sanctionId: string,
    revokedBy: string,
    revokeReason?: string
  ): Promise<{ success: boolean; error?: string; userId?: string }> {
    const sanction = await this.getSanction(sanctionId);
    if (!sanction) {
      return { success: false, error: 'Sanction introuvable' };
    }
    if (sanction.revoked) {
      return { success: false, error: 'Sanction déjà levée' };
    }

    await this.db.execute(
      `UPDATE moderation_sanctions
       SET revoked = TRUE, revoked_by = ?, revoked_at = NOW(), revoke_reason = ?
       WHERE id = ?`,
      [revokedBy, revokeReason ?? null, sanctionId]
    );

    await this.refreshUserFlags(sanction.userId);
    // Purge le cache du gateway pour que la levée soit immédiate
    this.notifyGateway(sanction.userId, 'lift', revokeReason ?? '', null).catch(() => {});
    return { success: true, userId: sanction.userId };
  }

  /** Lève toutes les sanctions actives d'un type donné pour un utilisateur */
  async revokeActiveSanctions(
    userId: string,
    type: SanctionType,
    revokedBy: string,
    revokeReason?: string
  ): Promise<number> {
    const result = await this.db.execute(
      `UPDATE moderation_sanctions
       SET revoked = TRUE, revoked_by = ?, revoked_at = NOW(), revoke_reason = ?
       WHERE user_id = ? AND type = ? AND revoked = FALSE
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [revokedBy, revokeReason ?? null, userId, type]
    );

    await this.refreshUserFlags(userId);
    this.notifyGateway(userId, 'lift', revokeReason ?? '', null).catch(() => {});
    return result?.affectedRows ?? 0;
  }

  async getSanction(sanctionId: string): Promise<Sanction | null> {
    const [rows] = await this.db.query(
      `SELECT s.*, u.username, u.display_name, a.username AS issued_by_username
       FROM moderation_sanctions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN users a ON a.id = s.issued_by
       WHERE s.id = ?`,
      [sanctionId]
    );
    const sanctions = rows as any[];
    return sanctions.length > 0 ? this.formatSanction(sanctions[0]) : null;
  }

  /** Liste paginée des sanctions, filtrable */
  async listSanctions(filters: {
    userId?: string;
    type?: SanctionType;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<Sanction[]> {
    const where: string[] = [];
    const params: any[] = [];

    if (filters.userId) {
      where.push('s.user_id = ?');
      params.push(filters.userId);
    }
    if (filters.type) {
      where.push('s.type = ?');
      params.push(filters.type);
    }
    if (filters.activeOnly) {
      where.push('s.revoked = FALSE AND (s.expires_at IS NULL OR s.expires_at > NOW())');
    }

    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = Math.max(filters.offset ?? 0, 0);

    const [rows] = await this.db.query(
      `SELECT s.*, u.username, u.display_name, a.username AS issued_by_username
       FROM moderation_sanctions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN users a ON a.id = s.issued_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    );

    return (rows as any[]).map(row => this.formatSanction(row));
  }

  /** Compteurs pour le tableau de bord modération */
  async getStats(): Promise<{
    activeBans: number;
    activeMutes: number;
    warnings30d: number;
    totalSanctions: number;
  }> {
    const [rows] = await this.db.query(
      `SELECT
         SUM(type = 'ban'  AND revoked = FALSE AND (expires_at IS NULL OR expires_at > NOW())) AS active_bans,
         SUM(type = 'mute' AND revoked = FALSE AND (expires_at IS NULL OR expires_at > NOW())) AS active_mutes,
         SUM(type = 'warn' AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY))                  AS warnings_30d,
         COUNT(*)                                                                              AS total
       FROM moderation_sanctions`
    );
    const row = (rows as any[])[0] ?? {};
    return {
      activeBans: Number(row.active_bans) || 0,
      activeMutes: Number(row.active_mutes) || 0,
      warnings30d: Number(row.warnings_30d) || 0,
      totalSanctions: Number(row.total) || 0,
    };
  }

  // ============ STATUT ============

  /** Statut de modération d'un utilisateur (mis en cache 30 s) */
  async getStatus(userId: string): Promise<ModerationStatus> {
    try {
      const cached = await this.redis.get(`mod:status:${userId}`);
      if (cached) return this.reviveStatus(JSON.parse(cached));
    } catch {
      // Redis indisponible — on interroge la DB
    }

    const status = await this.computeStatus(userId);

    try {
      await this.redis.set(`mod:status:${userId}`, JSON.stringify(status), STATUS_CACHE_TTL);
    } catch {
      // Cache best-effort
    }

    return status;
  }

  /** Recalcule le statut depuis les sanctions actives (sans cache) */
  private async computeStatus(userId: string): Promise<ModerationStatus> {
    const [rows] = await this.db.query(
      `SELECT type, reason, expires_at
       FROM moderation_sanctions
       WHERE user_id = ? AND revoked = FALSE
         AND (expires_at IS NULL OR expires_at > NOW())
         AND type IN ('ban', 'mute')
       ORDER BY expires_at IS NULL DESC, expires_at DESC`,
      [userId]
    );

    const [warnRows] = await this.db.query(
      `SELECT COUNT(*) AS count FROM moderation_sanctions
       WHERE user_id = ? AND type = 'warn' AND revoked = FALSE`,
      [userId]
    );

    const status: ModerationStatus = {
      ...CLEAN_STATUS,
      warnings: Number((warnRows as any[])[0]?.count) || 0,
    };

    for (const row of rows as any[]) {
      if (row.type === 'ban' && !status.banned) {
        status.banned = true;
        status.bannedUntil = row.expires_at ? new Date(row.expires_at) : null;
        status.banReason = row.reason;
      }
      if (row.type === 'mute' && !status.muted) {
        status.muted = true;
        status.mutedUntil = row.expires_at ? new Date(row.expires_at) : null;
        status.muteReason = row.reason;
      }
    }

    return status;
  }

  /**
   * Réaligne les colonnes dénormalisées de `users` sur les sanctions actives
   * et purge les caches (statut modération + profil utilisateur).
   */
  async refreshUserFlags(userId: string): Promise<ModerationStatus> {
    const status = await this.computeStatus(userId);

    await this.db.execute(
      `UPDATE users
       SET is_banned = ?, banned_until = ?, ban_reason = ?, muted_until = ?, mute_reason = ?
       WHERE id = ?`,
      [
        status.banned ? 1 : 0,
        status.bannedUntil,
        status.banReason,
        status.mutedUntil,
        status.muteReason,
        userId,
      ]
    );

    try {
      await this.redis.del(`mod:status:${userId}`);
      await this.redis.del(`user:${userId}`);
    } catch {
      // Cache best-effort
    }

    return status;
  }

  /**
   * Demande au gateway d'appliquer la sanction sur les sessions WebSocket ouvertes.
   * Best-effort : un échec ne doit pas annuler la sanction déjà enregistrée.
   */
  private async notifyGateway(
    userId: string,
    type: SanctionType | 'lift',
    reason: string,
    expiresAt: Date | null
  ): Promise<void> {
    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:3000';
    const secret = process.env.INTERNAL_SECRET;
    if (!secret) return;

    try {
      await fetch(`${gatewayUrl}/internal/moderation/enforce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify({
          userId,
          type,
          reason,
          expiresAt: expiresAt?.toISOString() ?? null,
        }),
      });
    } catch (error) {
      logger.warn(`Gateway injoignable pour appliquer la sanction sur ${userId}`);
    }
  }

  /** Révoque toutes les sessions d'un utilisateur (déconnexion forcée) */
  private async revokeAllSessions(userId: string): Promise<void> {
    try {
      const [rows] = await this.db.query(
        'SELECT refresh_token FROM sessions WHERE user_id = ?',
        [userId]
      );
      for (const row of rows as any[]) {
        await this.redis.set(`revoked:${row.refresh_token}`, '1', 365 * 24 * 60 * 60);
      }
      await this.db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await this.db.execute(
        'UPDATE users SET is_online = FALSE, status = ? WHERE id = ?',
        ['offline', userId]
      );
    } catch (error) {
      logger.error('Erreur révocation des sessions:', error);
    }
  }

  // ============ TERMES INTERDITS ============

  async listTerms(): Promise<ModerationTerm[]> {
    const [rows] = await this.db.query(
      'SELECT * FROM moderation_terms ORDER BY term ASC'
    );
    return (rows as any[]).map(row => ({
      id: row.id,
      term: row.term,
      matchType: row.match_type as TermMatch,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }

  async addTerm(
    term: string,
    matchType: TermMatch,
    createdBy: string
  ): Promise<{ success: boolean; error?: string }> {
    const normalized = term.trim().toLowerCase();
    if (!normalized) {
      return { success: false, error: 'Terme vide' };
    }
    try {
      await this.db.execute(
        'INSERT INTO moderation_terms (id, term, match_type, created_by) VALUES (?, ?, ?, ?)',
        [uuidv4(), normalized, matchType, createdBy]
      );
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return { success: false, error: 'Ce terme est déjà dans la liste' };
      }
      throw error;
    }
    await this.reloadTerms();
    return { success: true };
  }

  async deleteTerm(termId: string): Promise<void> {
    await this.db.execute('DELETE FROM moderation_terms WHERE id = ?', [termId]);
    await this.reloadTerms();
  }

  /** Recharge la liste personnalisée dans le filtre en mémoire */
  async reloadTerms(): Promise<void> {
    try {
      const terms = await this.listTerms();
      setCustomTerms(terms.map(t => ({ term: t.term, matchType: t.matchType })));
    } catch (error) {
      logger.error('Erreur rechargement des termes interdits:', error);
    }
  }

  // ============ HELPERS ============

  private formatSanction(row: any): Sanction {
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    const revoked = Boolean(row.revoked);

    return {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      type: row.type,
      reason: row.reason,
      expiresAt,
      issuedBy: row.issued_by,
      issuedByUsername: row.issued_by_username ?? null,
      revoked,
      revokedBy: row.revoked_by,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      revokeReason: row.revoke_reason ?? null,
      createdAt: row.created_at,
      active: !revoked && (!expiresAt || expiresAt > new Date()),
    };
  }

  private reviveStatus(raw: any): ModerationStatus {
    return {
      banned: Boolean(raw.banned),
      bannedUntil: raw.bannedUntil ? new Date(raw.bannedUntil) : null,
      banReason: raw.banReason ?? null,
      muted: Boolean(raw.muted),
      mutedUntil: raw.mutedUntil ? new Date(raw.mutedUntil) : null,
      muteReason: raw.muteReason ?? null,
      warnings: Number(raw.warnings) || 0,
    };
  }
}

export const moderationService = new ModerationService();
