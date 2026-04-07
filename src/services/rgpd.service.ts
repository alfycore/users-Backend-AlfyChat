// ==========================================
// ALFYCHAT - SERVICE RGPD
// ==========================================

import { v4 as uuidv4 } from 'uuid';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';

interface Consent {
  id: string;
  consentType: string;
  granted: boolean;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

interface UserDataExport {
  user: any;
  preferences: any;
  messages: any[];
  friends: any[];
  servers: any[];
  consents: Consent[];
  exportedAt: Date;
}

export class RgpdService {
  private get db() {
    return getDatabaseClient();
  }

  private get redis() {
    return getRedisClient();
  }

  // Exporter toutes les données utilisateur (RGPD Article 20)
  async exportUserData(userId: string): Promise<UserDataExport> {
    // Récupérer les données utilisateur
    const [userRows] = await this.db.query(
      `SELECT id, email, username, display_name, avatar_url, bio, status, 
              created_at, last_seen_at
       FROM users WHERE id = ?`,
      [userId]
    );

    const [prefRows] = await this.db.query(
      'SELECT * FROM user_preferences WHERE user_id = ?',
      [userId]
    );

    const [messageRows] = await this.db.query(
      `SELECT id, content, channel_id, recipient_id, created_at
       FROM messages WHERE author_id = ? ORDER BY created_at DESC`,
      [userId]
    );

    const [friendRows] = await this.db.query(
      `SELECT f.id, f.status, f.created_at,
              u.username, u.display_name
       FROM friends f
       JOIN users u ON (
         CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
       )
       WHERE f.user_id = ? OR f.friend_id = ?`,
      [userId, userId, userId]
    );

    const [serverRows] = await this.db.query(
      `SELECT s.id, s.name, sm.joined_at, sm.nickname
       FROM server_members sm
       JOIN servers s ON sm.server_id = s.id
       WHERE sm.user_id = ?`,
      [userId]
    );

    const consents = await this.getConsents(userId);

    return {
      user: (userRows as any[])[0] || null,
      preferences: (prefRows as any[])[0] || null,
      messages: messageRows as any[],
      friends: friendRows as any[],
      servers: serverRows as any[],
      consents,
      exportedAt: new Date(),
    };
  }

  // Demander la suppression (RGPD Article 17)
  async requestDeletion(userId: string): Promise<{ scheduledDeletionAt: Date }> {
    const scheduledDeletionAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours

    // Vérifier si une demande existe déjà
    const [existing] = await this.db.query(
      'SELECT id FROM rgpd_deletion_requests WHERE user_id = ? AND completed_at IS NULL',
      [userId]
    );

    if ((existing as any[]).length > 0) {
      // Mettre à jour la demande existante
      await this.db.execute(
        'UPDATE rgpd_deletion_requests SET scheduled_deletion_at = ?, requested_at = NOW() WHERE user_id = ? AND completed_at IS NULL',
        [scheduledDeletionAt, userId]
      );
    } else {
      // Créer une nouvelle demande
      await this.db.execute(
        `INSERT INTO rgpd_deletion_requests (id, user_id, scheduled_deletion_at)
         VALUES (?, ?, ?)`,
        [uuidv4(), userId, scheduledDeletionAt]
      );
    }

    return { scheduledDeletionAt };
  }

  // Annuler la demande de suppression
  async cancelDeletion(userId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM rgpd_deletion_requests WHERE user_id = ? AND completed_at IS NULL',
      [userId]
    );
  }

  // Récupérer les consentements
  async getConsents(userId: string): Promise<Consent[]> {
    const [rows] = await this.db.query(
      'SELECT id, consent_type, granted, granted_at, revoked_at FROM rgpd_consents WHERE user_id = ?',
      [userId]
    );

    return (rows as any[]).map(row => ({
      id: row.id,
      consentType: row.consent_type,
      granted: Boolean(row.granted),
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
    }));
  }

  // Mettre à jour un consentement
  async updateConsent(userId: string, consentType: string, granted: boolean): Promise<void> {
    const [existing] = await this.db.query(
      'SELECT id FROM rgpd_consents WHERE user_id = ? AND consent_type = ?',
      [userId, consentType]
    );

    if ((existing as any[]).length > 0) {
      if (granted) {
        await this.db.execute(
          `UPDATE rgpd_consents 
           SET granted = TRUE, granted_at = NOW(), revoked_at = NULL 
           WHERE user_id = ? AND consent_type = ?`,
          [userId, consentType]
        );
      } else {
        await this.db.execute(
          `UPDATE rgpd_consents 
           SET granted = FALSE, revoked_at = NOW() 
           WHERE user_id = ? AND consent_type = ?`,
          [userId, consentType]
        );
      }
    } else {
      await this.db.execute(
        `INSERT INTO rgpd_consents (id, user_id, consent_type, granted, granted_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [uuidv4(), userId, consentType, granted]
      );
    }
  }

  // Anonymiser les données utilisateur
  async anonymizeUser(userId: string): Promise<void> {
    const anonymousUsername = `deleted_${uuidv4().slice(0, 8)}`;
    
    // Anonymiser l'utilisateur
    await this.db.execute(
      `UPDATE users SET 
         email = CONCAT('deleted_', id, '@anonymous.local'),
         username = ?,
         display_name = 'Utilisateur supprimé',
         avatar_url = NULL,
         bio = NULL,
         password_hash = 'DELETED'
       WHERE id = ?`,
      [anonymousUsername, userId]
    );

    // Anonymiser les messages (garder pour le contexte mais supprimer le contenu)
    await this.db.execute(
      `UPDATE messages SET content = '[Message supprimé]' WHERE author_id = ?`,
      [userId]
    );

    // Supprimer les préférences
    await this.db.execute(
      'DELETE FROM user_preferences WHERE user_id = ?',
      [userId]
    );

    // Supprimer les sessions
    await this.db.execute(
      'DELETE FROM sessions WHERE user_id = ?',
      [userId]
    );

    // Invalider le cache
    await this.redis.del(`user:${userId}`);
  }

  // Supprimer complètement un utilisateur (appelé après le délai de 30 jours)
  async permanentlyDeleteUser(userId: string): Promise<void> {
    // Supprimer dans l'ordre pour respecter les contraintes FK
    await this.db.execute('DELETE FROM rgpd_consents WHERE user_id = ?', [userId]);
    await this.db.execute('DELETE FROM rgpd_deletion_requests WHERE user_id = ?', [userId]);
    await this.db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    await this.db.execute('DELETE FROM user_preferences WHERE user_id = ?', [userId]);
    await this.db.execute('DELETE FROM reactions WHERE user_id = ?', [userId]);
    await this.db.execute('DELETE FROM messages WHERE author_id = ?', [userId]);
    await this.db.execute('DELETE FROM friends WHERE user_id = ? OR friend_id = ?', [userId, userId]);
    await this.db.execute('DELETE FROM server_members WHERE user_id = ?', [userId]);
    await this.db.execute('DELETE FROM call_participants WHERE user_id = ?', [userId]);
    await this.db.execute('DELETE FROM users WHERE id = ?', [userId]);

    // Invalider le cache
    await this.redis.del(`user:${userId}`);
  }
}

export const rgpdService = new RgpdService();
