// ==========================================
// ALFYCHAT - SERVICE ADMIN
// ==========================================

import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface CustomBadge {
  id: string;
  name: string;
  description?: string;
  iconType: 'bootstrap' | 'svg';
  iconValue: string;
  color: string;
  displayOrder: number;
  isActive: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBadgeData {
  name: string;
  description?: string;
  iconType: 'bootstrap' | 'svg';
  iconValue: string;
  color: string;
  displayOrder?: number;
}

export interface UserAdminData {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: 'user' | 'moderator' | 'admin';
  badges: any[];
  status: string;
  isOnline: boolean;
  createdAt: Date;
  lastSeenAt?: Date;
}

export class AdminService {
  private get db() {
    return getDatabaseClient();
  }

  // ============ GESTION DES BADGES PERSONNALISÉS ============

  async getAllCustomBadges(): Promise<CustomBadge[]> {
    const [rows] = await this.db.query(
      `SELECT * FROM custom_badges ORDER BY display_order ASC, name ASC`
    );

    return (rows as any[]).map(row => this.formatBadge(row));
  }

  async getCustomBadge(badgeId: string): Promise<CustomBadge | null> {
    const [rows] = await this.db.query(
      'SELECT * FROM custom_badges WHERE id = ?',
      [badgeId]
    );

    const badges = rows as any[];
    return badges.length > 0 ? this.formatBadge(badges[0]) : null;
  }

  async createCustomBadge(data: CreateBadgeData, createdBy: string): Promise<CustomBadge> {
    const id = uuidv4();
    
    await this.db.execute(
      `INSERT INTO custom_badges (id, name, description, icon_type, icon_value, color, display_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.description || null,
        data.iconType,
        data.iconValue,
        data.color,
        data.displayOrder || 999,
        createdBy
      ]
    );

    const badge = await this.getCustomBadge(id);
    if (!badge) throw new Error('Badge non créé');
    return badge;
  }

  async updateCustomBadge(badgeId: string, data: Partial<CreateBadgeData>): Promise<void> {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (data.iconType !== undefined) {
      updates.push('icon_type = ?');
      params.push(data.iconType);
    }
    if (data.iconValue !== undefined) {
      updates.push('icon_value = ?');
      params.push(data.iconValue);
    }
    if (data.color !== undefined) {
      updates.push('color = ?');
      params.push(data.color);
    }
    if (data.displayOrder !== undefined) {
      updates.push('display_order = ?');
      params.push(data.displayOrder);
    }

    if (updates.length > 0) {
      params.push(badgeId);
      await this.db.execute(
        `UPDATE custom_badges SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
        params
      );
    }
  }

  async toggleBadgeStatus(badgeId: string, isActive: boolean): Promise<void> {
    await this.db.execute(
      'UPDATE custom_badges SET is_active = ? WHERE id = ?',
      [isActive, badgeId]
    );
  }

  async deleteCustomBadge(badgeId: string): Promise<void> {
    await this.db.execute('DELETE FROM custom_badges WHERE id = ?', [badgeId]);
  }

  // ============ GESTION DES UTILISATEURS ============

  async getAllUsers(limit: number = 100, offset: number = 0): Promise<UserAdminData[]> {
    const [rows] = await this.db.query(
      `SELECT id, username, display_name, email, role, badges, status, is_online, created_at, last_seen_at
       FROM users 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [String(limit), String(offset)]
    );

    return (rows as any[]).map(row => this.formatUserAdmin(row));
  }

  async searchUsers(query: string, limit: number = 50): Promise<UserAdminData[]> {
    const [rows] = await this.db.query(
      `SELECT id, username, display_name, email, role, badges, status, is_online, created_at, last_seen_at
       FROM users 
       WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ?
       ORDER BY created_at DESC 
       LIMIT ?`,
      [`%${query}%`, `%${query}%`, `%${query}%`, String(limit)]
    );

    return (rows as any[]).map(row => this.formatUserAdmin(row));
  }

  async updateUserRole(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void> {
    await this.db.execute(
      'UPDATE users SET role = ? WHERE id = ?',
      [role, userId]
    );
  }

  async getUserStats(): Promise<{
    totalUsers: number;
    onlineUsers: number;
    admins: number;
    moderators: number;
  }> {
    const [totalRows] = await this.db.query('SELECT COUNT(*) as count FROM users');
    const [onlineRows] = await this.db.query('SELECT COUNT(*) as count FROM users WHERE is_online = TRUE');
    const [adminRows] = await this.db.query('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
    const [modRows] = await this.db.query('SELECT COUNT(*) as count FROM users WHERE role = "moderator"');

    return {
      totalUsers: (totalRows as any[])[0].count,
      onlineUsers: (onlineRows as any[])[0].count,
      admins: (adminRows as any[])[0].count,
      moderators: (modRows as any[])[0].count,
    };
  }

  // ============ ATTRIBUTION DE BADGES AUX UTILISATEURS ============

  async assignBadgeToUser(userId: string, badgeId: string): Promise<void> {
    // Récupérer le badge personnalisé
    const badge = await this.getCustomBadge(badgeId);
    if (!badge) throw new Error('Badge non trouvé');

    // Récupérer les badges actuels de l'utilisateur
    const [rows] = await this.db.query(
      'SELECT badges FROM users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0) throw new Error('Utilisateur non trouvé');

    let badges: any[] = [];
    if (users[0].badges) {
      try {
        badges = typeof users[0].badges === 'string' 
          ? JSON.parse(users[0].badges) 
          : users[0].badges;
      } catch {
        badges = [];
      }
    }

    // Vérifier si le badge existe déjà
    if (badges.find(b => b.id === badgeId)) {
      return; // Badge déjà attribué
    }

    // Ajouter le nouveau badge
    badges.push({
      id: badge.id,
      name: badge.name,
      icon: badge.iconValue,
      iconType: badge.iconType,
      iconValue: badge.iconValue,
      color: badge.color,
      earnedAt: new Date().toISOString(),
    });

    // Mettre à jour en BDD
    await this.db.execute(
      'UPDATE users SET badges = ? WHERE id = ?',
      [JSON.stringify(badges), userId]
    );

    // Invalider le cache Redis
    try {
      const redis = getRedisClient();
      await redis.del(`user:${userId}`);
    } catch (e) {
      // Ignorer les erreurs de cache
    }
  }

  async removeBadgeFromUser(userId: string, badgeId: string): Promise<void> {
    const [rows] = await this.db.query(
      'SELECT badges FROM users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0) return;

    let badges: any[] = [];
    if (users[0].badges) {
      try {
        badges = typeof users[0].badges === 'string' 
          ? JSON.parse(users[0].badges) 
          : users[0].badges;
      } catch {
        badges = [];
      }
    }

    const filteredBadges = badges.filter(b => b.id !== badgeId);

    await this.db.execute(
      'UPDATE users SET badges = ? WHERE id = ?',
      [JSON.stringify(filteredBadges), userId]
    );

    // Invalider le cache Redis
    try {
      const redis = getRedisClient();
      await redis.del(`user:${userId}`);
    } catch (e) {
      // Ignorer les erreurs de cache
    }
  }

  // ============ PARAMÈTRES DU SITE ============

  async getSiteSettings(): Promise<Record<string, string>> {
    const [rows] = await this.db.query(
      'SELECT setting_key, setting_value FROM site_settings'
    );
    const settings: Record<string, string> = {};
    for (const row of rows as any[]) {
      settings[row.setting_key] = row.setting_value;
    }
    return settings;
  }

  async updateSiteSetting(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
      [key, value, value]
    );
  }

  async isRegistrationEnabled(): Promise<boolean> {
    const [rows] = await this.db.query(
      "SELECT setting_value FROM site_settings WHERE setting_key = 'registration_enabled'",
    );
    const r = rows as any[];
    return r.length > 0 ? r[0].setting_value === 'true' : true;
  }

  async isTurnstileEnabled(): Promise<boolean> {
    const [rows] = await this.db.query(
      "SELECT setting_value FROM site_settings WHERE setting_key = 'turnstile_enabled'",
    );
    const r = rows as any[];
    return r.length > 0 ? r[0].setting_value === 'true' : false;
  }

  // ============ LIENS D'INSCRIPTION ============

  async createInviteLink(email: string, createdBy: string, expiresInHours: number = 48): Promise<{
    id: string;
    code: string;
    email: string;
    expiresAt: Date;
    link: string;
  }> {
    const id = uuidv4();
    const code = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';

    await this.db.execute(
      `INSERT INTO invite_links (id, code, email, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, code, email, createdBy, expiresAt]
    );

    return {
      id,
      code,
      email,
      expiresAt,
      link: `${frontendUrl}/register?invite=${code}`,
    };
  }

  async getInviteLinks(): Promise<any[]> {
    const [rows] = await this.db.query(
      `SELECT il.*, u.username as created_by_username 
       FROM invite_links il 
       LEFT JOIN users u ON il.created_by = u.id
       ORDER BY il.created_at DESC`
    );
    return (rows as any[]).map(row => ({
      id: row.id,
      code: row.code,
      email: row.email,
      used: Boolean(row.used),
      usedBy: row.used_by,
      usedAt: row.used_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      createdBy: row.created_by,
      createdByUsername: row.created_by_username,
    }));
  }

  async deleteInviteLink(linkId: string): Promise<void> {
    await this.db.execute('DELETE FROM invite_links WHERE id = ?', [linkId]);
  }

  async validateInviteCode(code: string, email: string): Promise<{ valid: boolean; error?: string; linkId?: string }> {
    const [rows] = await this.db.query(
      'SELECT * FROM invite_links WHERE code = ?',
      [code]
    );
    const links = rows as any[];
    if (links.length === 0) {
      return { valid: false, error: 'Lien d\'invitation invalide' };
    }

    const link = links[0];
    if (link.used) {
      return { valid: false, error: 'Ce lien d\'invitation a déjà été utilisé' };
    }
    if (new Date(link.expires_at) < new Date()) {
      return { valid: false, error: 'Ce lien d\'invitation a expiré' };
    }
    if (link.email.toLowerCase() !== email.toLowerCase()) {
      return { valid: false, error: 'Cet email ne correspond pas au lien d\'invitation' };
    }

    return { valid: true, linkId: link.id };
  }

  async markInviteLinkUsed(linkId: string, usedBy: string): Promise<void> {
    await this.db.execute(
      'UPDATE invite_links SET used = TRUE, used_by = ?, used_at = NOW() WHERE id = ?',
      [usedBy, linkId]
    );
  }

  // ============ VÉRIFICATION TURNSTILE ============

  async verifyTurnstileToken(token: string): Promise<boolean> {
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    if (!secretKey) return true; // Si pas configuré, on laisse passer

    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: secretKey,
          response: token,
        }),
      });
      const data = await response.json() as { success: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  }

  // ============ HELPERS ============

  private formatBadge(row: any): CustomBadge {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      iconType: row.icon_type,
      iconValue: row.icon_value,
      color: row.color,
      displayOrder: row.display_order,
      isActive: Boolean(row.is_active),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private formatUserAdmin(row: any): UserAdminData {
    let badges: any[] = [];
    if (row.badges) {
      try {
        badges = typeof row.badges === 'string' ? JSON.parse(row.badges) : row.badges;
      } catch {
        badges = [];
      }
    }

    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      badges,
      status: row.status,
      isOnline: Boolean(row.is_online),
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  // ============ CHANGELOGS ============

  async getChangelogs(limit = 50, offset = 0) {
    const [rows] = await this.db.query(
      `SELECT c.*, u.username as author_username, u.display_name as author_display_name
       FROM changelogs c
       LEFT JOIN users u ON c.created_by = u.id
       ORDER BY c.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`
    );
    return rows as any[];
  }

  async createChangelog(data: {
    version: string;
    title: string;
    content: string;
    type: 'feature' | 'fix' | 'improvement' | 'security' | 'breaking';
    bannerUrl?: string | null;
    createdBy: string;
  }) {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO changelogs (id, version, title, content, type, banner_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.version, data.title, data.content, data.type, data.bannerUrl ?? null, data.createdBy]
    );
    const [rows] = await this.db.query(`SELECT * FROM changelogs WHERE id = ?`, [id]);
    return (rows as any[])[0];
  }

  async deleteChangelog(changelogId: string) {
    await this.db.execute(`DELETE FROM changelogs WHERE id = ?`, [changelogId]);
  }
}

export const adminService = new AdminService();
