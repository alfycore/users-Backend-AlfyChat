"use strict";
// ==========================================
// ALFYCHAT - CONTRÔLEUR ADMIN
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminController = exports.AdminController = void 0;
const admin_service_1 = require("../services/admin.service");
const logger_1 = require("../utils/logger");
class AdminController {
    // ============ BADGES PERSONNALISÉS ============
    async getAllBadges(req, res) {
        try {
            const badges = await admin_service_1.adminService.getAllCustomBadges();
            res.json(badges);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération badges:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async createBadge(req, res) {
        try {
            const data = req.body;
            if (!data.name || !data.iconType || !data.iconValue || !data.color) {
                return res.status(400).json({ error: 'Données manquantes' });
            }
            const badge = await admin_service_1.adminService.createCustomBadge(data, req.userId);
            logger_1.logger.info(`Badge créé: ${badge.name} par ${req.userId}`);
            res.json(badge);
        }
        catch (error) {
            logger_1.logger.error('Erreur création badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async updateBadge(req, res) {
        try {
            const { badgeId } = req.params;
            const data = req.body;
            await admin_service_1.adminService.updateCustomBadge(badgeId, data);
            logger_1.logger.info(`Badge mis à jour: ${badgeId} par ${req.userId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async toggleBadgeStatus(req, res) {
        try {
            const { badgeId } = req.params;
            const { isActive } = req.body;
            await admin_service_1.adminService.toggleBadgeStatus(badgeId, isActive);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur toggle badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async deleteBadge(req, res) {
        try {
            const { badgeId } = req.params;
            await admin_service_1.adminService.deleteCustomBadge(badgeId);
            logger_1.logger.info(`Badge supprimé: ${badgeId} par ${req.userId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur suppression badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // ============ ATTRIBUTION DE BADGES ============
    async assignBadgeToUser(req, res) {
        try {
            const { userId, badgeId } = req.params;
            await admin_service_1.adminService.assignBadgeToUser(userId, badgeId);
            logger_1.logger.info(`Badge ${badgeId} attribué à ${userId} par ${req.userId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur attribution badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async removeBadgeFromUser(req, res) {
        try {
            const { userId, badgeId } = req.params;
            await admin_service_1.adminService.removeBadgeFromUser(userId, badgeId);
            logger_1.logger.info(`Badge ${badgeId} retiré de ${userId} par ${req.userId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur retrait badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // ============ GESTION DES UTILISATEURS ============
    async getAllUsers(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const offset = parseInt(req.query.offset) || 0;
            const users = await admin_service_1.adminService.getAllUsers(limit, offset);
            res.json(users);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération utilisateurs:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async searchUsers(req, res) {
        try {
            const { q } = req.query;
            if (!q || typeof q !== 'string') {
                return res.status(400).json({ error: 'Requête de recherche requise' });
            }
            const users = await admin_service_1.adminService.searchUsers(q);
            res.json(users);
        }
        catch (error) {
            logger_1.logger.error('Erreur recherche utilisateurs:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async updateUserRole(req, res) {
        try {
            const { userId } = req.params;
            const { role } = req.body;
            if (!['user', 'moderator', 'admin'].includes(role)) {
                return res.status(400).json({ error: 'Rôle invalide' });
            }
            await admin_service_1.adminService.updateUserRole(userId, role);
            logger_1.logger.info(`Rôle ${role} attribué à ${userId} par ${req.userId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour rôle:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async getStats(req, res) {
        try {
            const stats = await admin_service_1.adminService.getUserStats();
            res.json(stats);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération stats:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // ============ PARAMÈTRES DU SITE ============
    async getSiteSettings(req, res) {
        try {
            const settings = await admin_service_1.adminService.getSiteSettings();
            res.json(settings);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération paramètres:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async updateSiteSetting(req, res) {
        try {
            const { key, value } = req.body;
            const allowedKeys = ['registration_enabled', 'turnstile_enabled', 'turnstile_site_key'];
            if (!allowedKeys.includes(key)) {
                return res.status(400).json({ error: 'Paramètre non autorisé' });
            }
            await admin_service_1.adminService.updateSiteSetting(key, value);
            logger_1.logger.info(`Paramètre ${key} = ${value} mis à jour par ${req.userId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour paramètre:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // ============ LIENS D'INSCRIPTION ============
    async createInviteLink(req, res) {
        try {
            const { email, expiresInHours } = req.body;
            const link = await admin_service_1.adminService.createInviteLink(email, req.userId, expiresInHours);
            logger_1.logger.info(`Lien d'invitation créé pour ${email} par ${req.userId}`);
            res.json(link);
        }
        catch (error) {
            logger_1.logger.error('Erreur création lien invitation:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async getInviteLinks(req, res) {
        try {
            const links = await admin_service_1.adminService.getInviteLinks();
            res.json(links);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération liens invitation:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    async deleteInviteLink(req, res) {
        try {
            const { linkId } = req.params;
            await admin_service_1.adminService.deleteInviteLink(linkId);
            logger_1.logger.info(`Lien d'invitation ${linkId} supprimé par ${req.userId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur suppression lien invitation:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
}
exports.AdminController = AdminController;
exports.adminController = new AdminController();
//# sourceMappingURL=admin.controller.js.map