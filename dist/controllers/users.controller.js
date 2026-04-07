"use strict";
// ==========================================
// ALFYCHAT - CONTRÔLEUR UTILISATEURS
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.userController = exports.UserController = void 0;
const users_service_1 = require("../services/users.service");
const logger_1 = require("../utils/logger");
const userService = new users_service_1.UserService();
class UserController {
    // Récupérer un utilisateur par ID
    async getUser(req, res) {
        try {
            const { userId } = req.params;
            const user = await userService.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'Utilisateur non trouvé' });
            }
            res.json(user);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération utilisateur:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Récupérer plusieurs utilisateurs
    async getUsers(req, res) {
        try {
            const { ids } = req.query;
            if (!ids || typeof ids !== 'string') {
                return res.status(400).json({ error: 'IDs requis' });
            }
            const userIds = ids.split(',');
            const users = await userService.findByIds(userIds);
            res.json(users);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération utilisateurs:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Rechercher des utilisateurs
    async searchUsers(req, res) {
        try {
            const { q, limit = '20' } = req.query;
            if (!q || typeof q !== 'string') {
                return res.status(400).json({ error: 'Requête de recherche requise' });
            }
            const users = await userService.search(q, parseInt(limit));
            res.json(users);
        }
        catch (error) {
            logger_1.logger.error('Erreur recherche utilisateurs:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Mettre à jour le profil
    async updateProfile(req, res) {
        try {
            const { userId } = req.params;
            // Vérifier que l'utilisateur modifie son propre profil
            if (req.userId !== userId) {
                return res.status(403).json({ error: 'Non autorisé' });
            }
            const { displayName, avatarUrl, bannerUrl, bio, cardColor, showBadges, tutorialCompleted } = req.body;
            await userService.updateProfile(userId, {
                displayName,
                avatarUrl,
                bannerUrl,
                bio,
                cardColor,
                showBadges,
                tutorialCompleted,
            });
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour profil:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Mettre à jour le statut
    async updateStatus(req, res) {
        try {
            const { userId } = req.params;
            const { status } = req.body;
            await userService.updateStatus(userId, status);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour statut:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Mettre à jour last seen
    async updateLastSeen(req, res) {
        try {
            const { userId } = req.params;
            await userService.updateLastSeen(userId);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour last seen:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Récupérer les préférences
    async getPreferences(req, res) {
        try {
            const { userId } = req.params;
            const prefs = await userService.getPreferences(userId);
            if (!prefs) {
                return res.status(404).json({ error: 'Préférences non trouvées' });
            }
            res.json(prefs);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération préférences:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Mettre à jour les préférences
    async updatePreferences(req, res) {
        try {
            const { userId } = req.params;
            if (req.userId !== userId) {
                return res.status(403).json({ error: 'Non autorisé' });
            }
            await userService.updatePreferences(userId, req.body);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour préférences:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Changer le mot de passe
    async changePassword(req, res) {
        try {
            const { userId } = req.params;
            if (req.userId !== userId) {
                return res.status(403).json({ error: 'Non autorisé' });
            }
            const { currentPassword, newPassword } = req.body;
            const result = await userService.changePassword(userId, currentPassword, newPassword);
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur changement mot de passe:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // ============ GESTION DES BADGES ============
    // Récupérer les badges d'un utilisateur
    async getBadges(req, res) {
        try {
            const { userId } = req.params;
            const badges = await userService.getBadges(userId);
            res.json(badges);
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération badges:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Attribuer un badge (admin seulement)
    async addBadge(req, res) {
        try {
            const { userId } = req.params;
            const { badgeType } = req.body;
            // TODO: Vérifier que l'utilisateur est admin
            // Pour le moment, on autorise pour le développement
            await userService.addBadge(userId, badgeType);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur attribution badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Retirer un badge (admin seulement)
    async removeBadge(req, res) {
        try {
            const { userId, badgeId } = req.params;
            // TODO: Vérifier que l'utilisateur est admin
            await userService.removeBadge(userId, badgeId);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur retrait badge:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Basculer l'affichage des badges
    async toggleBadgesVisibility(req, res) {
        try {
            const { userId } = req.params;
            if (req.userId !== userId) {
                return res.status(403).json({ error: 'Non autorisé' });
            }
            const { show } = req.body;
            await userService.toggleBadgesVisibility(userId, show);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur bascule badges:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
}
exports.UserController = UserController;
exports.userController = new UserController();
//# sourceMappingURL=users.controller.js.map