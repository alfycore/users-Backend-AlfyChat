"use strict";
// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// ==========================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = exports.UserService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("../database");
const redis_1 = require("../redis");
const badges_1 = require("../types/badges");
class UserService {
    get db() {
        return (0, database_1.getDatabaseClient)();
    }
    get redis() {
        return (0, redis_1.getRedisClient)();
    }
    // Trouver un utilisateur par ID
    async findById(userId) {
        // Vérifier le cache
        const cached = await this.redis.get(`user:${userId}`);
        if (cached) {
            return JSON.parse(cached);
        }
        const [rows] = await this.db.query(`SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, u.banner_url, u.bio,
              u.card_color, u.badges, u.show_badges, u.hidden_badge_ids, u.role, u.status, u.is_online,
              u.tutorial_completed, u.created_at, u.last_seen_at, u.custom_status, u.status_emoji,
              up.interests
       FROM users u
       LEFT JOIN user_preferences up ON up.user_id = u.id
       WHERE u.id = ?`, [userId]);
        const users = rows;
        if (users.length === 0)
            return null;
        const user = this.formatUser(users[0]);
        // Mettre en cache (5 minutes)
        await this.redis.set(`user:${userId}`, JSON.stringify(user), 300);
        return user;
    }
    // Trouver plusieurs utilisateurs par IDs
    async findByIds(userIds) {
        if (userIds.length === 0)
            return [];
        const placeholders = userIds.map(() => '?').join(',');
        const [rows] = await this.db.query(`SELECT id, username, display_name, avatar_url, banner_url, bio,
              card_color, badges, show_badges, hidden_badge_ids, role, status, is_online,
              created_at, last_seen_at, custom_status, status_emoji
       FROM users WHERE id IN (${placeholders})`, userIds);
        return rows.map(row => this.formatUser(row));
    }
    // Trouver un utilisateur par email
    async findByEmail(email) {
        const [rows] = await this.db.query('SELECT * FROM users WHERE email = ?', [email]);
        const users = rows;
        return users.length > 0 ? users[0] : null;
    }
    // Trouver un utilisateur par username
    async findByUsername(username) {
        const [rows] = await this.db.query('SELECT * FROM users WHERE username = ?', [username]);
        const users = rows;
        return users.length > 0 ? this.formatUser(users[0]) : null;
    }
    // Rechercher des utilisateurs
    async search(query, limit = 20) {
        const [rows] = await this.db.query(`SELECT id, username, display_name, avatar_url, banner_url, card_color, 
              badges, show_badges, hidden_badge_ids, role, status, is_online
       FROM users 
       WHERE username LIKE ? OR display_name LIKE ?
       LIMIT ?`, [`%${query}%`, `%${query}%`, String(limit)]);
        return rows.map(row => this.formatUser(row));
    }
    // Créer un utilisateur
    async create(data) {
        await this.db.execute(`INSERT INTO users (id, email, username, display_name, password_hash)
       VALUES (?, ?, ?, ?, ?)`, [data.id, data.email, data.username, data.displayName, data.passwordHash]);
        // Créer les préférences par défaut
        await this.db.execute(`INSERT INTO user_preferences (user_id) VALUES (?)`, [data.id]);
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
    async updateProfile(userId, data) {
        const updates = [];
        const params = [];
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
            await this.db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
            await this.invalidateCache(userId);
        }
    }
    // Mettre à jour le statut
    async updateStatus(userId, status, customStatus, emoji) {
        // invisible → is_online = FALSE (l'utilisateur est techniquement connecté mais se cache)
        const isOnline = status !== 'offline' && status !== 'invisible';
        if (customStatus !== undefined || emoji !== undefined) {
            await this.db.execute('UPDATE users SET status = ?, is_online = ?, custom_status = ?, status_emoji = ? WHERE id = ?', [status, isOnline, customStatus !== undefined ? (customStatus?.slice(0, 100) ?? null) : null,
                emoji !== undefined ? (emoji?.slice(0, 10) ?? null) : null, userId]);
        }
        else {
            await this.db.execute('UPDATE users SET status = ?, is_online = ? WHERE id = ?', [status, isOnline, userId]);
        }
        await this.invalidateCache(userId);
    }
    // Mettre à jour uniquement le statut personnalisé
    async updateCustomStatus(userId, customStatus) {
        await this.db.execute('UPDATE users SET custom_status = ? WHERE id = ?', [customStatus ? customStatus.slice(0, 100) : null, userId]);
        await this.invalidateCache(userId);
    }
    // Mettre à jour last seen
    async updateLastSeen(userId) {
        await this.db.execute('UPDATE users SET last_seen_at = NOW(), is_online = FALSE WHERE id = ?', [userId]);
        await this.invalidateCache(userId);
    }
    // Récupérer les préférences
    async getPreferences(userId) {
        const [rows] = await this.db.query('SELECT * FROM user_preferences WHERE user_id = ?', [userId]);
        const prefs = rows;
        return prefs.length > 0 ? this.formatPreferences(prefs[0]) : null;
    }
    // Mettre à jour les préférences
    async updatePreferences(userId, data) {
        const allowedFields = {
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
        const updates = [];
        const params = [];
        for (const [key, column] of Object.entries(allowedFields)) {
            if (data[key] !== undefined) {
                updates.push(`${column} = ?`);
                let value = data[key];
                if (jsonFields.has(key) && value !== null && typeof value === 'object') {
                    value = JSON.stringify(value);
                }
                params.push(value);
            }
        }
        if (updates.length > 0) {
            params.push(userId);
            await this.db.execute(`UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = ?`, params);
            await this.invalidateCache(userId);
        }
    }
    // Vérifier la disponibilité d'un nom d'utilisateur
    async checkUsernameAvailable(username) {
        const [rows] = await this.db.query('SELECT id FROM users WHERE username = ?', [username]);
        return rows.length === 0;
    }
    // Changer le nom d'utilisateur (nécessite le mot de passe)
    async changeUsername(userId, newUsername, password) {
        // Vérifier le mot de passe
        const [rows] = await this.db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0) {
            return { success: false, error: 'Utilisateur non trouvé' };
        }
        const isValid = await bcryptjs_1.default.compare(password, users[0].password_hash);
        if (!isValid) {
            return { success: false, error: 'Mot de passe incorrect' };
        }
        // Vérifier la disponibilité
        const available = await this.checkUsernameAvailable(newUsername);
        if (!available) {
            return { success: false, error: 'Ce nom d\'utilisateur est déjà pris' };
        }
        // Mettre à jour
        await this.db.execute('UPDATE users SET username = ? WHERE id = ?', [newUsername, userId]);
        await this.invalidateCache(userId);
        return { success: true };
    }
    // Changer le mot de passe
    async changePassword(userId, currentPassword, newPassword, encryptedPrivateKey, keySalt) {
        const [rows] = await this.db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0) {
            return { success: false, error: 'Utilisateur non trouvé' };
        }
        const isValid = await bcryptjs_1.default.compare(currentPassword, users[0].password_hash);
        if (!isValid) {
            return { success: false, error: 'Mot de passe actuel incorrect' };
        }
        const newHash = await bcryptjs_1.default.hash(newPassword, 12);
        // Update password hash + re-encrypted E2EE key if provided
        if (encryptedPrivateKey && keySalt) {
            await this.db.execute('UPDATE users SET password_hash = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?', [newHash, encryptedPrivateKey, keySalt, userId]);
        }
        else {
            await this.db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
        }
        return { success: true };
    }
    // ============ GESTION DES BADGES ============
    // Récupérer les badges d'un utilisateur
    async getBadges(userId) {
        const [rows] = await this.db.query('SELECT badges FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0 || !users[0].badges)
            return [];
        try {
            return typeof users[0].badges === 'string'
                ? JSON.parse(users[0].badges)
                : users[0].badges;
        }
        catch {
            return [];
        }
    }
    // Attribuer un badge à un utilisateur
    async addBadge(userId, badgeType) {
        const badges = await this.getBadges(userId);
        // Vérifier si le badge existe déjà
        if (badges.find(b => b.id === badgeType)) {
            return;
        }
        const badgeDefinition = badges_1.BADGE_DEFINITIONS[badgeType];
        if (!badgeDefinition) {
            throw new Error('Type de badge invalide');
        }
        const newBadge = {
            id: badgeType,
            name: badgeDefinition.name,
            icon: badgeDefinition.icon,
            color: badgeDefinition.color,
            earnedAt: new Date().toISOString(),
        };
        badges.push(newBadge);
        // Trier les badges par ordre
        badges.sort((a, b) => {
            const orderA = badges_1.BADGE_DEFINITIONS[a.id]?.order ?? 999;
            const orderB = badges_1.BADGE_DEFINITIONS[b.id]?.order ?? 999;
            return orderA - orderB;
        });
        await this.db.execute('UPDATE users SET badges = ? WHERE id = ?', [JSON.stringify(badges), userId]);
        await this.invalidateCache(userId);
    }
    // Retirer un badge d'un utilisateur
    async removeBadge(userId, badgeId) {
        const badges = await this.getBadges(userId);
        const filteredBadges = badges.filter(b => b.id !== badgeId);
        await this.db.execute('UPDATE users SET badges = ? WHERE id = ?', [JSON.stringify(filteredBadges), userId]);
        await this.invalidateCache(userId);
    }
    // Mettre à jour l'affichage des badges
    async toggleBadgesVisibility(userId, show) {
        await this.db.execute('UPDATE users SET show_badges = ? WHERE id = ?', [show, userId]);
        await this.invalidateCache(userId);
    }
    // Attribuer automatiquement les badges d'ancienneté
    async checkAndAwardAnniversaryBadges(userId) {
        const [rows] = await this.db.query('SELECT created_at FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0)
            return;
        const createdAt = new Date(users[0].created_at);
        const now = new Date();
        const yearsDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 365);
        if (yearsDiff >= 3) {
            await this.addBadge(userId, badges_1.BadgeType.MEMBER_3_YEARS);
        }
        else if (yearsDiff >= 2) {
            await this.addBadge(userId, badges_1.BadgeType.MEMBER_2_YEARS);
        }
        else if (yearsDiff >= 1) {
            await this.addBadge(userId, badges_1.BadgeType.MEMBER_1_YEAR);
        }
    }
    // Invalider le cache
    async invalidateCache(userId) {
        await this.redis.del(`user:${userId}`);
    }
    // Formater un utilisateur pour la réponse
    formatUser(row) {
        // Parser les badges JSON
        let badges = [];
        if (row.badges) {
            try {
                badges = typeof row.badges === 'string' ? JSON.parse(row.badges) : row.badges;
            }
            catch {
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
                if (!row.hidden_badge_ids)
                    return [];
                if (Array.isArray(row.hidden_badge_ids))
                    return row.hidden_badge_ids;
                try {
                    return JSON.parse(row.hidden_badge_ids);
                }
                catch {
                    return [];
                }
            })(),
            tutorialCompleted: Boolean(row.tutorial_completed),
            role: row.role || 'user',
            status: row.status,
            customStatus: row.custom_status || null,
            statusEmoji: row.status_emoji || null,
            isOnline: Boolean(row.is_online),
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
            interests: (() => {
                if (!row.interests)
                    return [];
                if (Array.isArray(row.interests))
                    return row.interests;
                try {
                    return JSON.parse(row.interests);
                }
                catch {
                    return [];
                }
            })(),
        };
    }
    // Formater les préférences pour la réponse
    formatPreferences(row) {
        const parseJsonField = (v) => {
            if (!v)
                return undefined;
            if (typeof v === 'string') {
                try {
                    return JSON.parse(v);
                }
                catch {
                    return undefined;
                }
            }
            return v;
        };
        const formatDate = (v) => {
            if (!v)
                return undefined;
            if (v instanceof Date)
                return v.toISOString().split('T')[0];
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
    async isBlockedBy(viewerId, targetId) {
        // La table blocked_users est dans le service friends mais répliquée en Redis
        // Pour éviter une requête cross-service, on fait une query directe sur la DB partagée
        try {
            const [rows] = await this.db.query(`SELECT 1 FROM blocked_users WHERE user_id = ? AND blocked_user_id = ? LIMIT 1`, [targetId, viewerId]);
            return rows.length > 0;
        }
        catch {
            return false; // table absente dans ce service DB → ne pas bloquer
        }
    }
    // Mettre à jour la présence musicale
    async updateMusicPresence(userId, data) {
        await this.db.execute('UPDATE users SET music_presence = ? WHERE id = ?', [data !== null ? JSON.stringify(data) : null, userId]);
        await this.invalidateCache(userId);
    }
    // Mettre à jour la profile card
    async updateProfileCard(userId, profileCardUrl) {
        await this.db.execute('UPDATE users SET profile_card_url = ? WHERE id = ?', [profileCardUrl, userId]);
        await this.invalidateCache(userId);
    }
    // ---- Favoris (emojis/stickers/gifs) ----
    async getFavorites(userId, type) {
        if (type) {
            const [rows] = await this.db.query('SELECT id, type, value, position FROM user_favorites WHERE user_id = ? AND type = ? ORDER BY position ASC', [userId, type]);
            return rows;
        }
        const [rows] = await this.db.query('SELECT id, type, value, position FROM user_favorites WHERE user_id = ? ORDER BY type ASC, position ASC', [userId]);
        return rows;
    }
    async addFavorite(userId, type, value) {
        const { v4: uuidv4 } = await Promise.resolve().then(() => __importStar(require('uuid')));
        const id = uuidv4();
        // position = max existant + 1
        const [posRows] = await this.db.query('SELECT COALESCE(MAX(position), -1) as maxPos FROM user_favorites WHERE user_id = ? AND type = ?', [userId, type]);
        const position = (posRows[0]?.maxPos ?? -1) + 1;
        await this.db.execute('INSERT IGNORE INTO user_favorites (id, user_id, type, value, position) VALUES (?, ?, ?, ?, ?)', [id, userId, type, value, position]);
        return { id, type, value, position };
    }
    async removeFavorite(userId, id) {
        await this.db.execute('DELETE FROM user_favorites WHERE id = ? AND user_id = ?', [id, userId]);
    }
    async reorderFavorites(userId, orderedIds) {
        for (let i = 0; i < orderedIds.length; i++) {
            await this.db.execute('UPDATE user_favorites SET position = ? WHERE id = ? AND user_id = ?', [i, orderedIds[i], userId]);
        }
    }
    // ---- Visibilité de l'activité ----
    async getActivityHiddenFrom(userId) {
        const [rows] = await this.db.query('SELECT hidden_from_user_id FROM activity_visibility_exceptions WHERE user_id = ?', [userId]);
        return rows.map(r => r.hidden_from_user_id);
    }
    async hideActivityFrom(userId, targetUserId) {
        await this.db.execute('INSERT IGNORE INTO activity_visibility_exceptions (user_id, hidden_from_user_id) VALUES (?, ?)', [userId, targetUserId]);
    }
    async showActivityTo(userId, targetUserId) {
        await this.db.execute('DELETE FROM activity_visibility_exceptions WHERE user_id = ? AND hidden_from_user_id = ?', [userId, targetUserId]);
    }
    async isActivityHiddenFrom(userId, viewerId) {
        const [rows] = await this.db.query('SELECT 1 FROM activity_visibility_exceptions WHERE user_id = ? AND hidden_from_user_id = ? LIMIT 1', [userId, viewerId]);
        return rows.length > 0;
    }
    // ---- DMs épinglés ----
    async getPinnedConversations(userId) {
        const [rows] = await this.db.query('SELECT conversation_id, pin_order FROM pinned_conversations WHERE user_id = ? ORDER BY pin_order ASC', [userId]);
        return rows.map(r => ({ conversationId: r.conversation_id, pinOrder: r.pin_order }));
    }
    async pinConversation(userId, conversationId) {
        const [posRows] = await this.db.query('SELECT COALESCE(MAX(pin_order), -1) as maxOrd FROM pinned_conversations WHERE user_id = ?', [userId]);
        const pinOrder = (posRows[0]?.maxOrd ?? -1) + 1;
        await this.db.execute('INSERT IGNORE INTO pinned_conversations (user_id, conversation_id, pin_order) VALUES (?, ?, ?)', [userId, conversationId, pinOrder]);
    }
    async unpinConversation(userId, conversationId) {
        await this.db.execute('DELETE FROM pinned_conversations WHERE user_id = ? AND conversation_id = ?', [userId, conversationId]);
    }
}
exports.UserService = UserService;
exports.userService = new UserService();
//# sourceMappingURL=users.service.js.map