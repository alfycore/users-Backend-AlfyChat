"use strict";
// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = exports.UserService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
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
        const [rows] = await this.db.query(`SELECT id, username, email, display_name, avatar_url, banner_url, bio, 
              card_color, badges, show_badges, role, status, is_online, tutorial_completed, created_at, last_seen_at
       FROM users WHERE id = ?`, [userId]);
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
              card_color, badges, show_badges, role, status, is_online, created_at, last_seen_at
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
              badges, show_badges, role, status, is_online
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
    async updateStatus(userId, status) {
        await this.db.execute('UPDATE users SET status = ?, is_online = ? WHERE id = ?', [status, status !== 'offline', userId]);
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
        };
        const jsonFields = new Set(['interests', 'notifKeywords']);
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
    // Changer le mot de passe
    async changePassword(userId, currentPassword, newPassword) {
        const [rows] = await this.db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0) {
            return { success: false, error: 'Utilisateur non trouvé' };
        }
        const isValid = await bcrypt_1.default.compare(currentPassword, users[0].password_hash);
        if (!isValid) {
            return { success: false, error: 'Mot de passe actuel incorrect' };
        }
        const newHash = await bcrypt_1.default.hash(newPassword, 12);
        await this.db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
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
            tutorialCompleted: Boolean(row.tutorial_completed),
            role: row.role || 'user',
            status: row.status,
            isOnline: Boolean(row.is_online),
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
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
        };
    }
}
exports.UserService = UserService;
exports.userService = new UserService();
//# sourceMappingURL=users.service.js.map