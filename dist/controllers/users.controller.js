"use strict";
// ==========================================
// ALFYCHAT - CONTRÔLEUR UTILISATEURS
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.userController = exports.UserController = void 0;
const users_service_1 = require("../services/users.service");
const logger_1 = require("../utils/logger");
const database_1 = require("../database");
const userService = new users_service_1.UserService();
class UserController {
    // Récupérer la clé publique E2EE d'un utilisateur
    async getPublicKey(req, res) {
        try {
            const { userId } = req.params;
            const db = (0, database_1.getDatabaseClient)();
            const [rows] = await db.query('SELECT public_key FROM users WHERE id = ?', [userId]);
            const users = rows;
            if (users.length === 0 || !users[0].public_key) {
                return res.status(404).json({ error: 'Clé publique introuvable' });
            }
            res.json({ publicKey: users[0].public_key });
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération clé publique:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Récupérer un utilisateur par ID
    async getUser(req, res) {
        try {
            const { userId } = req.params;
            // L'ID du viewer peut venir de x-user-id (gateway) ou du query param
            const viewerId = req.userId || req.headers['x-user-id'] || req.query.viewerId;
            const user = await userService.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'Utilisateur non trouvé' });
            }
            // Vérifier si le viewer est bloqué par cet utilisateur → 404 anonyme
            if (viewerId && viewerId !== userId) {
                const blocked = await userService.isBlockedBy(viewerId, userId);
                if (blocked) {
                    return res.status(404).json({ error: 'Utilisateur non trouvé' });
                }
                // Masquer le statut en ligne si l'utilisateur a caché son activité au viewer
                const activityHidden = await userService.isActivityHiddenFrom(userId, viewerId);
                if (activityHidden) {
                    return res.json({ ...user, status: 'offline', isOnline: false });
                }
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
            const { displayName, avatarUrl, bannerUrl, bio, cardColor, showBadges, hiddenBadgeIds, tutorialCompleted } = req.body;
            await userService.updateProfile(userId, {
                displayName,
                avatarUrl,
                bannerUrl,
                bio,
                cardColor,
                showBadges,
                hiddenBadgeIds,
                tutorialCompleted,
            });
            const updatedUser = await userService.findById(userId);
            res.json({ success: true, data: updatedUser });
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
            // Vérifier que l'utilisateur modifie son propre statut
            if (req.userId !== userId) {
                return res.status(403).json({ error: 'Non autorisé' });
            }
            const { status, customStatus, text, emoji } = req.body;
            const resolvedText = text ?? customStatus;
            const resolvedEmoji = emoji ?? null;
            await userService.updateStatus(userId, status, resolvedText, resolvedEmoji);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour statut:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Mettre à jour le statut personnalisé
    async updateCustomStatus(req, res) {
        try {
            const { userId } = req.params;
            const { customStatus } = req.body;
            await userService.updateCustomStatus(userId, customStatus ?? null);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour statut personnalisé:', error);
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
            const { currentPassword, newPassword, encryptedPrivateKey, keySalt } = req.body;
            const result = await userService.changePassword(userId, currentPassword, newPassword, encryptedPrivateKey, keySalt);
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
    // Vérifier la disponibilité d'un nom d'utilisateur
    async checkUsernameAvailable(req, res) {
        try {
            const { username } = req.params;
            const available = await userService.checkUsernameAvailable(username);
            res.json({ available });
        }
        catch (error) {
            logger_1.logger.error('Erreur vérification username:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Changer le nom d'utilisateur
    async changeUsername(req, res) {
        try {
            const { userId } = req.params;
            if (req.userId !== userId) {
                return res.status(403).json({ error: 'Non autorisé' });
            }
            const { newUsername, password } = req.body;
            const result = await userService.changeUsername(userId, newUsername, password);
            if (!result.success) {
                return res.status(400).json({ error: result.error });
            }
            const updatedUser = await userService.findById(userId);
            res.json({ success: true, data: updatedUser });
        }
        catch (error) {
            logger_1.logger.error('Erreur changement username:', error);
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
            if (req.userRole !== 'admin') {
                return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
            }
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
            if (req.userRole !== 'admin') {
                return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
            }
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