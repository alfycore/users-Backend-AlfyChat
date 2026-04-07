"use strict";
// ==========================================
// ALFYCHAT - SERVICE ADMIN
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminService = exports.AdminService = void 0;
const database_1 = require("../database");
const redis_1 = require("../redis");
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
class AdminService {
    get db() {
        return (0, database_1.getDatabaseClient)();
    }
    // ============ GESTION DES BADGES PERSONNALISÉS ============
    async getAllCustomBadges() {
        const [rows] = await this.db.query(`SELECT * FROM custom_badges ORDER BY display_order ASC, name ASC`);
        return rows.map(row => this.formatBadge(row));
    }
    async getCustomBadge(badgeId) {
        const [rows] = await this.db.query('SELECT * FROM custom_badges WHERE id = ?', [badgeId]);
        const badges = rows;
        return badges.length > 0 ? this.formatBadge(badges[0]) : null;
    }
    async createCustomBadge(data, createdBy) {
        const id = (0, uuid_1.v4)();
        await this.db.execute(`INSERT INTO custom_badges (id, name, description, icon_type, icon_value, color, display_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
            id,
            data.name,
            data.description || null,
            data.iconType,
            data.iconValue,
            data.color,
            data.displayOrder || 999,
            createdBy
        ]);
        const badge = await this.getCustomBadge(id);
        if (!badge)
            throw new Error('Badge non créé');
        return badge;
    }
    async updateCustomBadge(badgeId, data) {
        const updates = [];
        const params = [];
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
            await this.db.execute(`UPDATE custom_badges SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
        }
    }
    async toggleBadgeStatus(badgeId, isActive) {
        await this.db.execute('UPDATE custom_badges SET is_active = ? WHERE id = ?', [isActive, badgeId]);
    }
    async deleteCustomBadge(badgeId) {
        await this.db.execute('DELETE FROM custom_badges WHERE id = ?', [badgeId]);
    }
    // ============ GESTION DES UTILISATEURS ============
    async getAllUsers(limit = 100, offset = 0) {
        const [rows] = await this.db.query(`SELECT id, username, display_name, email, role, badges, status, is_online, created_at, last_seen_at
       FROM users 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`, [String(limit), String(offset)]);
        return rows.map(row => this.formatUserAdmin(row));
    }
    async searchUsers(query, limit = 50) {
        const [rows] = await this.db.query(`SELECT id, username, display_name, email, role, badges, status, is_online, created_at, last_seen_at
       FROM users 
       WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ?
       ORDER BY created_at DESC 
       LIMIT ?`, [`%${query}%`, `%${query}%`, `%${query}%`, String(limit)]);
        return rows.map(row => this.formatUserAdmin(row));
    }
    async updateUserRole(userId, role) {
        await this.db.execute('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    }
    async getUserStats() {
        const [totalRows] = await this.db.query('SELECT COUNT(*) as count FROM users');
        const [onlineRows] = await this.db.query('SELECT COUNT(*) as count FROM users WHERE is_online = TRUE');
        const [adminRows] = await this.db.query('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
        const [modRows] = await this.db.query('SELECT COUNT(*) as count FROM users WHERE role = "moderator"');
        return {
            totalUsers: totalRows[0].count,
            onlineUsers: onlineRows[0].count,
            admins: adminRows[0].count,
            moderators: modRows[0].count,
        };
    }
    // ============ ATTRIBUTION DE BADGES AUX UTILISATEURS ============
    async assignBadgeToUser(userId, badgeId) {
        // Récupérer le badge personnalisé
        const badge = await this.getCustomBadge(badgeId);
        if (!badge)
            throw new Error('Badge non trouvé');
        // Récupérer les badges actuels de l'utilisateur
        const [rows] = await this.db.query('SELECT badges FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0)
            throw new Error('Utilisateur non trouvé');
        let badges = [];
        if (users[0].badges) {
            try {
                badges = typeof users[0].badges === 'string'
                    ? JSON.parse(users[0].badges)
                    : users[0].badges;
            }
            catch {
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
        await this.db.execute('UPDATE users SET badges = ? WHERE id = ?', [JSON.stringify(badges), userId]);
        // Invalider le cache Redis
        try {
            const redis = (0, redis_1.getRedisClient)();
            await redis.del(`user:${userId}`);
        }
        catch (e) {
            // Ignorer les erreurs de cache
        }
    }
    async removeBadgeFromUser(userId, badgeId) {
        const [rows] = await this.db.query('SELECT badges FROM users WHERE id = ?', [userId]);
        const users = rows;
        if (users.length === 0)
            return;
        let badges = [];
        if (users[0].badges) {
            try {
                badges = typeof users[0].badges === 'string'
                    ? JSON.parse(users[0].badges)
                    : users[0].badges;
            }
            catch {
                badges = [];
            }
        }
        const filteredBadges = badges.filter(b => b.id !== badgeId);
        await this.db.execute('UPDATE users SET badges = ? WHERE id = ?', [JSON.stringify(filteredBadges), userId]);
        // Invalider le cache Redis
        try {
            const redis = (0, redis_1.getRedisClient)();
            await redis.del(`user:${userId}`);
        }
        catch (e) {
            // Ignorer les erreurs de cache
        }
    }
    // ============ PARAMÈTRES DU SITE ============
    async getSiteSettings() {
        const [rows] = await this.db.query('SELECT setting_key, setting_value FROM site_settings');
        const settings = {};
        for (const row of rows) {
            settings[row.setting_key] = row.setting_value;
        }
        return settings;
    }
    async updateSiteSetting(key, value) {
        await this.db.execute(`INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`, [key, value, value]);
    }
    async isRegistrationEnabled() {
        const [rows] = await this.db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'registration_enabled'");
        const r = rows;
        return r.length > 0 ? r[0].setting_value === 'true' : true;
    }
    async isTurnstileEnabled() {
        const [rows] = await this.db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'turnstile_enabled'");
        const r = rows;
        return r.length > 0 ? r[0].setting_value === 'true' : false;
    }
    // ============ LIENS D'INSCRIPTION ============
    async createInviteLink(email, createdBy, expiresInHours = 48) {
        const id = (0, uuid_1.v4)();
        const code = crypto_1.default.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
        await this.db.execute(`INSERT INTO invite_links (id, code, email, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?)`, [id, code, email, createdBy, expiresAt]);
        return {
            id,
            code,
            email,
            expiresAt,
            link: `${frontendUrl}/register?invite=${code}`,
        };
    }
    async getInviteLinks() {
        const [rows] = await this.db.query(`SELECT il.*, u.username as created_by_username 
       FROM invite_links il 
       LEFT JOIN users u ON il.created_by = u.id
       ORDER BY il.created_at DESC`);
        return rows.map(row => ({
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
    async deleteInviteLink(linkId) {
        await this.db.execute('DELETE FROM invite_links WHERE id = ?', [linkId]);
    }
    async validateInviteCode(code, email) {
        const [rows] = await this.db.query('SELECT * FROM invite_links WHERE code = ?', [code]);
        const links = rows;
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
    async markInviteLinkUsed(linkId, usedBy) {
        await this.db.execute('UPDATE invite_links SET used = TRUE, used_by = ?, used_at = NOW() WHERE id = ?', [usedBy, linkId]);
    }
    // ============ VÉRIFICATION TURNSTILE ============
    async verifyTurnstileToken(token) {
        const secretKey = process.env.TURNSTILE_SECRET_KEY;
        if (!secretKey)
            return true; // Si pas configuré, on laisse passer
        try {
            const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    secret: secretKey,
                    response: token,
                }),
            });
            const data = await response.json();
            return data.success === true;
        }
        catch {
            return false;
        }
    }
    // ============ HELPERS ============
    formatBadge(row) {
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
    formatUserAdmin(row) {
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
}
exports.AdminService = AdminService;
exports.adminService = new AdminService();
//# sourceMappingURL=admin.service.js.map