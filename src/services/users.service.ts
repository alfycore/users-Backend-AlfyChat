// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// ==========================================

import bcrypt from 'bcryptjs';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { User, UserPreferences, UserStatus } from '../types/user';
import { UserBadge, BadgeType, BADGE_DEFINITIONS } from '../types/badges';

export class UserService {
  private get db() {
    return getDatabaseClient();
  }

  private get redis() {
    return getRedisClient();
  }

  // Trouver un utilisateur par ID
  async findById(userId: string): Promise<User | null> {
    // Vérifier le cache
    const cached = await this.redis.get(`user:${userId}`);
    if (cached) {
      return JSON.parse(cached as string);
    }

    const [rows] = await this.db.query(
      `SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, u.banner_url, u.bio,
              u.card_color, u.badges, u.show_badges, u.hidden_badge_ids, u.role, u.status, u.is_online,
              u.tutorial_completed, u.created_at, u.last_seen_at,
              up.interests
       FROM users u
       LEFT JOIN user_preferences up ON up.user_id = u.id
       WHERE u.id = ?`,
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0) return null;

    const user = this.formatUser(users[0]);
    
    // Mettre en cache (5 minutes)
    await this.redis.set(`user:${userId}`, JSON.stringify(user), 300);

    return user;
  }

  // Trouver plusieurs utilisateurs par IDs
  async findByIds(userIds: string[]): Promise<User[]> {
    if (userIds.length === 0) return [];

    const placeholders = userIds.map(() => '?').join(',');
    const [rows] = await this.db.query(
      `SELECT id, username, display_name, avatar_url, banner_url, bio, 
              card_color, badges, show_badges, hidden_badge_ids, role, status, is_online, created_at, last_seen_at
       FROM users WHERE id IN (${placeholders})`,
      userIds
    );

    return (rows as any[]).map(row => this.formatUser(row));
  }

  // Trouver un utilisateur par email
  async findByEmail(email: string): Promise<User | null> {
    const [rows] = await this.db.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    const users = rows as any[];
    return users.length > 0 ? users[0] : null;
  }

  // Trouver un utilisateur par username
  async findByUsername(username: string): Promise<User | null> {
    const [rows] = await this.db.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    const users = rows as any[];
    return users.length > 0 ? this.formatUser(users[0]) : null;
  }

  // Rechercher des utilisateurs
  async search(query: string, limit: number = 20): Promise<User[]> {
    const [rows] = await this.db.query(
      `SELECT id, username, display_name, avatar_url, banner_url, card_color, 
              badges, show_badges, hidden_badge_ids, role, status, is_online
       FROM users 
       WHERE username LIKE ? OR display_name LIKE ?
       LIMIT ?`,
      [`%${query}%`, `%${query}%`, String(limit)]
    );

    return (rows as any[]).map(row => this.formatUser(row));
  }

  // Créer un utilisateur
  async create(data: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    passwordHash: string;
  }): Promise<User> {
    await this.db.execute(
      `INSERT INTO users (id, email, username, display_name, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [data.id, data.email, data.username, data.displayName, data.passwordHash]
    );

    // Créer les préférences par défaut
    await this.db.execute(
      `INSERT INTO user_preferences (user_id) VALUES (?)`,
      [data.id]
    );

    return {
      id: data.id,
      email: data.email,
      username: data.username,
      displayName: data.displayName,
      status: 'offline',
      isOnline: false,
      createdAt: new Date(),
    };
  }

  // Mettre à jour le profil
  async updateProfile(userId: string, data: {
    displayName?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    bio?: string;
    cardColor?: string;
    showBadges?: boolean;
    hiddenBadgeIds?: string[];
    tutorialCompleted?: boolean;
  }): Promise<void> {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.displayName !== undefined) {
      updates.push('display_name = ?');
      params.push(data.displayName);
    }
    if (data.avatarUrl !== undefined) {
      updates.push('avatar_url = ?');
      params.push(data.avatarUrl);
    }
    if (data.bannerUrl !== undefined) {
      updates.push('banner_url = ?');
      params.push(data.bannerUrl);
    }
    if (data.bio !== undefined) {
      updates.push('bio = ?');
      params.push(data.bio);
    }
    if (data.cardColor !== undefined) {
      updates.push('card_color = ?');
      params.push(data.cardColor);
    }
    if (data.showBadges !== undefined) {
      updates.push('show_badges = ?');
      params.push(data.showBadges ? 1 : 0);
    }
    if (data.hiddenBadgeIds !== undefined) {
      updates.push('hidden_badge_ids = ?');
      params.push(JSON.stringify(data.hiddenBadgeIds));
    }
    if (data.tutorialCompleted !== undefined) {
      updates.push('tutorial_completed = ?');
      params.push(data.tutorialCompleted ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(userId);
      await this.db.execute(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      await this.invalidateCache(userId);
    }
  }

  // Mettre à jour le statut
  async updateStatus(userId: string, status: UserStatus, customStatus?: string | null): Promise<void> {
    if (customStatus !== undefined) {
      await this.db.execute(
        'UPDATE users SET status = ?, is_online = ?, custom_status = ? WHERE id = ?',
        [status, status !== 'offline', customStatus ? customStatus.slice(0, 100) : null, userId]
      );
    } else {
      await this.db.execute(
        'UPDATE users SET status = ?, is_online = ? WHERE id = ?',
        [status, status !== 'offline', userId]
      );
    }
    await this.invalidateCache(userId);
  }

  // Mettre à jour uniquement le statut personnalisé
  async updateCustomStatus(userId: string, customStatus: string | null): Promise<void> {
    await this.db.execute(
      'UPDATE users SET custom_status = ? WHERE id = ?',
      [customStatus ? customStatus.slice(0, 100) : null, userId]
    );
    await this.invalidateCache(userId);
  }

  // Mettre à jour last seen
  async updateLastSeen(userId: string): Promise<void> {
    await this.db.execute(
      'UPDATE users SET last_seen_at = NOW(), is_online = FALSE WHERE id = ?',
      [userId]
    );
    await this.invalidateCache(userId);
  }

  // Récupérer les préférences
  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const [rows] = await this.db.query(
      'SELECT * FROM user_preferences WHERE user_id = ?',
      [userId]
    );

    const prefs = rows as any[];
    return prefs.length > 0 ? this.formatPreferences(prefs[0]) : null;
  }

  // Mettre à jour les préférences
  async updatePreferences(userId: string, data: Partial<UserPreferences>): Promise<void> {
    const allowedFields: Record<string, string> = {
      theme: 'theme',
      language: 'language',
      encryptionLevel: 'encryption_level',
      notificationsDesktop: 'notifications_desktop',
      notificationsSound: 'notifications_sound',
      notificationsMentions: 'notifications_mentions',
      notificationsDm: 'notifications_dm',
      privacyShowOnline: 'privacy_show_online',
      privacyAllowDm: 'privacy_allow_dm',
      privacyAllowFriendRequests: 'privacy_allow_friend_requests',
      birthday: 'birthday',
      timezone: 'timezone',
      interests: 'interests',
      micMode: 'mic_mode',
      fontFamily: 'font_family',
      dndEnabled: 'dnd_enabled',
      notifKeywords: 'notif_keywords',
      quietStart: 'quiet_start',
      quietEnd: 'quiet_end',
      vacationStart: 'vacation_start',
      vacationEnd: 'vacation_end',
      layoutPrefs: 'layout_prefs',
      wallpaper: 'wallpaper',
    };

    const jsonFields = new Set(['interests', 'notifKeywords', 'layoutPrefs']);
    const updates: string[] = [];
    const params: any[] = [];

    for (const [key, column] of Object.entries(allowedFields)) {
      if ((data as any)[key] !== undefined) {
        updates.push(`${column} = ?`);
        let value = (data as any)[key];
        if (jsonFields.has(key) && value !== null && typeof value === 'object') {
          value = JSON.stringify(value);
        }
        params.push(value);
      }
    }

    if (updates.length > 0) {
      params.push(userId);
      await this.db.execute(
        `UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = ?`,
        params
      );
      await this.invalidateCache(userId);
    }
  }

  // Vérifier la disponibilité d'un nom d'utilisateur
  async checkUsernameAvailable(username: string): Promise<boolean> {
    const [rows] = await this.db.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );
    return (rows as any[]).length === 0;
  }

  // Changer le nom d'utilisateur (nécessite le mot de passe)
  async changeUsername(
    userId: string,
    newUsername: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    // Vérifier le mot de passe
    const [rows] = await this.db.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );
    const users = rows as any[];
    if (users.length === 0) {
      return { success: false, error: 'Utilisateur non trouvé' };
    }
    const isValid = await bcrypt.compare(password, users[0].password_hash);
    if (!isValid) {
      return { success: false, error: 'Mot de passe incorrect' };
    }

    // Vérifier la disponibilité
    const available = await this.checkUsernameAvailable(newUsername);
    if (!available) {
      return { success: false, error: 'Ce nom d\'utilisateur est déjà pris' };
    }

    // Mettre à jour
    await this.db.execute(
      'UPDATE users SET username = ? WHERE id = ?',
      [newUsername, userId]
    );
    await this.invalidateCache(userId);

    return { success: true };
  }

  // Changer le mot de passe
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    encryptedPrivateKey?: string,
    keySalt?: string
  ): Promise<{ success: boolean; error?: string }> {
    const [rows] = await this.db.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0) {
      return { success: false, error: 'Utilisateur non trouvé' };
    }

    const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);
    if (!isValid) {
      return { success: false, error: 'Mot de passe actuel incorrect' };
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    // Update password hash + re-encrypted E2EE key if provided
    if (encryptedPrivateKey && keySalt) {
      await this.db.execute(
        'UPDATE users SET password_hash = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?',
        [newHash, encryptedPrivateKey, keySalt, userId]
      );
    } else {
      await this.db.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [newHash, userId]
      );
    }

    return { success: true };
  }

  // ============ GESTION DES BADGES ============

  // Récupérer les badges d'un utilisateur
  async getBadges(userId: string): Promise<UserBadge[]> {
    const [rows] = await this.db.query(
      'SELECT badges FROM users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0 || !users[0].badges) return [];

    try {
      return typeof users[0].badges === 'string' 
        ? JSON.parse(users[0].badges) 
        : users[0].badges;
    } catch {
      return [];
    }
  }

  // Attribuer un badge à un utilisateur
  async addBadge(userId: string, badgeType: BadgeType): Promise<void> {
    const badges = await this.getBadges(userId);
    
    // Vérifier si le badge existe déjà
    if (badges.find(b => b.id === badgeType)) {
      return;
    }

    const badgeDefinition = BADGE_DEFINITIONS[badgeType];
    if (!badgeDefinition) {
      throw new Error('Type de badge invalide');
    }

    const newBadge: UserBadge = {
      id: badgeType,
      name: badgeDefinition.name,
      icon: badgeDefinition.icon,
      color: badgeDefinition.color,
      earnedAt: new Date().toISOString(),
    };

    badges.push(newBadge);
    
    // Trier les badges par ordre
    badges.sort((a, b) => {
      const orderA = BADGE_DEFINITIONS[a.id as BadgeType]?.order ?? 999;
      const orderB = BADGE_DEFINITIONS[b.id as BadgeType]?.order ?? 999;
      return orderA - orderB;
    });

    await this.db.execute(
      'UPDATE users SET badges = ? WHERE id = ?',
      [JSON.stringify(badges), userId]
    );

    await this.invalidateCache(userId);
  }

  // Retirer un badge d'un utilisateur
  async removeBadge(userId: string, badgeId: string): Promise<void> {
    const badges = await this.getBadges(userId);
    const filteredBadges = badges.filter(b => b.id !== badgeId);

    await this.db.execute(
      'UPDATE users SET badges = ? WHERE id = ?',
      [JSON.stringify(filteredBadges), userId]
    );

    await this.invalidateCache(userId);
  }

  // Mettre à jour l'affichage des badges
  async toggleBadgesVisibility(userId: string, show: boolean): Promise<void> {
    await this.db.execute(
      'UPDATE users SET show_badges = ? WHERE id = ?',
      [show, userId]
    );

    await this.invalidateCache(userId);
  }

  // Attribuer automatiquement les badges d'ancienneté
  async checkAndAwardAnniversaryBadges(userId: string): Promise<void> {
    const [rows] = await this.db.query(
      'SELECT created_at FROM users WHERE id = ?',
      [userId]
    );

    const users = rows as any[];
    if (users.length === 0) return;

    const createdAt = new Date(users[0].created_at);
    const now = new Date();
    const yearsDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 365);

    if (yearsDiff >= 3) {
      await this.addBadge(userId, BadgeType.MEMBER_3_YEARS);
    } else if (yearsDiff >= 2) {
      await this.addBadge(userId, BadgeType.MEMBER_2_YEARS);
    } else if (yearsDiff >= 1) {
      await this.addBadge(userId, BadgeType.MEMBER_1_YEAR);
    }
  }

  // Invalider le cache
  private async invalidateCache(userId: string): Promise<void> {
    await this.redis.del(`user:${userId}`);
  }

  // Formater un utilisateur pour la réponse
  private formatUser(row: any) {
    // Parser les badges JSON
    let badges: UserBadge[] = [];
    if (row.badges) {
      try {
        badges = typeof row.badges === 'string' ? JSON.parse(row.badges) : row.badges;
      } catch {
        badges = [];
      }
    }

    return {
      id: row.id,
      email: row.email,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      bio: row.bio,
      cardColor: row.card_color,
      badges,
      showBadges: row.show_badges !== undefined ? Boolean(row.show_badges) : true,
      hiddenBadgeIds: (() => {
        if (!row.hidden_badge_ids) return [];
        if (Array.isArray(row.hidden_badge_ids)) return row.hidden_badge_ids;
        try { return JSON.parse(row.hidden_badge_ids); } catch { return []; }
      })(),
      tutorialCompleted: Boolean(row.tutorial_completed),
      role: row.role || 'user',
      status: row.status,
      customStatus: row.custom_status || null,
      isOnline: Boolean(row.is_online),
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      interests: (() => {
        if (!row.interests) return [];
        if (Array.isArray(row.interests)) return row.interests;
        try { return JSON.parse(row.interests); } catch { return []; }
      })(),
    };
  }

  // Formater les préférences pour la réponse
  private formatPreferences(row: any): UserPreferences {
    const parseJsonField = (v: any) => {
      if (!v) return undefined;
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return undefined; } }
      return v;
    };
    const formatDate = (v: any) => {
      if (!v) return undefined;
      if (v instanceof Date) return v.toISOString().split('T')[0];
      return String(v).split('T')[0];
    };
    return {
      theme: row.theme,
      language: row.language,
      encryptionLevel: row.encryption_level,
      notificationsDesktop: Boolean(row.notifications_desktop),
      notificationsSound: Boolean(row.notifications_sound),
      notificationsMentions: Boolean(row.notifications_mentions),
      notificationsDm: Boolean(row.notifications_dm),
      privacyShowOnline: Boolean(row.privacy_show_online),
      privacyAllowDm: Boolean(row.privacy_allow_dm),
      privacyAllowFriendRequests: Boolean(row.privacy_allow_friend_requests),
      birthday: formatDate(row.birthday),
      timezone: row.timezone || undefined,
      interests: parseJsonField(row.interests),
      micMode: row.mic_mode || undefined,
      fontFamily: row.font_family || undefined,
      dndEnabled: row.dnd_enabled != null ? Boolean(row.dnd_enabled) : undefined,
      notifKeywords: parseJsonField(row.notif_keywords),
      quietStart: row.quiet_start || undefined,
      quietEnd: row.quiet_end || undefined,
      vacationStart: formatDate(row.vacation_start),
      vacationEnd: formatDate(row.vacation_end),
      layoutPrefs: parseJsonField(row.layout_prefs),
      wallpaper: row.wallpaper ?? null,
    };
  }

  // ============================================================
  // NOUVELLES FEATURES — PRIVACY & CUSTOMISATION
  // ============================================================

  // Vérifier si viewerId est dans la liste bloquée de targetId
  // (targetId a bloqué viewerId → cacher le profil de targetId au viewerId)
  async isBlockedBy(viewerId: string, targetId: string): Promise<boolean> {
    // La table blocked_users est dans le service friends mais répliquée en Redis
    // Pour éviter une requête cross-service, on fait une query directe sur la DB partagée
    try {
      const [rows] = await this.db.query(
        `SELECT 1 FROM blocked_users WHERE user_id = ? AND blocked_user_id = ? LIMIT 1`,
        [targetId, viewerId]
      );
      return (rows as any[]).length > 0;
    } catch {
      return false; // table absente dans ce service DB → ne pas bloquer
    }
  }

  // Mettre à jour la présence musicale
  async updateMusicPresence(userId: string, data: {
    title?: string;
    artist?: string;
    coverUrl?: string;
    platform?: string;
    startedAt?: string;
  } | null): Promise<void> {
    await this.db.execute(
      'UPDATE users SET music_presence = ? WHERE id = ?',
      [data !== null ? JSON.stringify(data) : null, userId]
    );
    await this.invalidateCache(userId);
  }

  // Mettre à jour la profile card
  async updateProfileCard(userId: string, profileCardUrl: string | null): Promise<void> {
    await this.db.execute(
      'UPDATE users SET profile_card_url = ? WHERE id = ?',
      [profileCardUrl, userId]
    );
    await this.invalidateCache(userId);
  }

  // ---- Favoris (emojis/stickers/gifs) ----

  async getFavorites(userId: string, type?: 'emoji' | 'sticker' | 'gif'): Promise<any[]> {
    if (type) {
      const [rows] = await this.db.query(
        'SELECT id, type, value, position FROM user_favorites WHERE user_id = ? AND type = ? ORDER BY position ASC',
        [userId, type]
      );
      return rows as any[];
    }
    const [rows] = await this.db.query(
      'SELECT id, type, value, position FROM user_favorites WHERE user_id = ? ORDER BY type ASC, position ASC',
      [userId]
    );
    return rows as any[];
  }

  async addFavorite(userId: string, type: 'emoji' | 'sticker' | 'gif', value: string): Promise<any> {
    const { v4: uuidv4 } = await import('uuid');
    const id = uuidv4();
    // position = max existant + 1
    const [posRows] = await this.db.query(
      'SELECT COALESCE(MAX(position), -1) as maxPos FROM user_favorites WHERE user_id = ? AND type = ?',
      [userId, type]
    );
    const position = ((posRows as any[])[0]?.maxPos ?? -1) + 1;
    await this.db.execute(
      'INSERT IGNORE INTO user_favorites (id, user_id, type, value, position) VALUES (?, ?, ?, ?, ?)',
      [id, userId, type, value, position]
    );
    return { id, type, value, position };
  }

  async removeFavorite(userId: string, id: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM user_favorites WHERE id = ? AND user_id = ?',
      [id, userId]
    );
  }

  async reorderFavorites(userId: string, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db.execute(
        'UPDATE user_favorites SET position = ? WHERE id = ? AND user_id = ?',
        [i, orderedIds[i], userId]
      );
    }
  }

  // ---- Visibilité de l'activité ----

  async getActivityHiddenFrom(userId: string): Promise<string[]> {
    const [rows] = await this.db.query(
      'SELECT hidden_from_user_id FROM activity_visibility_exceptions WHERE user_id = ?',
      [userId]
    );
    return (rows as any[]).map(r => r.hidden_from_user_id);
  }

  async hideActivityFrom(userId: string, targetUserId: string): Promise<void> {
    await this.db.execute(
      'INSERT IGNORE INTO activity_visibility_exceptions (user_id, hidden_from_user_id) VALUES (?, ?)',
      [userId, targetUserId]
    );
  }

  async showActivityTo(userId: string, targetUserId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM activity_visibility_exceptions WHERE user_id = ? AND hidden_from_user_id = ?',
      [userId, targetUserId]
    );
  }

  async isActivityHiddenFrom(userId: string, viewerId: string): Promise<boolean> {
    const [rows] = await this.db.query(
      'SELECT 1 FROM activity_visibility_exceptions WHERE user_id = ? AND hidden_from_user_id = ? LIMIT 1',
      [userId, viewerId]
    );
    return (rows as any[]).length > 0;
  }

  // ---- DMs épinglés ----

  async getPinnedConversations(userId: string): Promise<Array<{ conversationId: string; pinOrder: number }>> {
    const [rows] = await this.db.query(
      'SELECT conversation_id, pin_order FROM pinned_conversations WHERE user_id = ? ORDER BY pin_order ASC',
      [userId]
    );
    return (rows as any[]).map(r => ({ conversationId: r.conversation_id, pinOrder: r.pin_order }));
  }

  async pinConversation(userId: string, conversationId: string): Promise<void> {
    const [posRows] = await this.db.query(
      'SELECT COALESCE(MAX(pin_order), -1) as maxOrd FROM pinned_conversations WHERE user_id = ?',
      [userId]
    );
    const pinOrder = ((posRows as any[])[0]?.maxOrd ?? -1) + 1;
    await this.db.execute(
      'INSERT IGNORE INTO pinned_conversations (user_id, conversation_id, pin_order) VALUES (?, ?, ?)',
      [userId, conversationId, pinOrder]
    );
  }

  async unpinConversation(userId: string, conversationId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM pinned_conversations WHERE user_id = ? AND conversation_id = ?',
      [userId, conversationId]
    );
  }
}

export const userService = new UserService();
