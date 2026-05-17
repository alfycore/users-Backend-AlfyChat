"use strict";
// ==========================================
// ALFYCHAT - ROUTES UTILISATEURS
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const users_controller_1 = require("../controllers/users.controller");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const auth_controller_1 = require("../controllers/auth.controller");
const admin_service_1 = require("../services/admin.service");
const users_service_1 = require("../services/users.service");
exports.usersRouter = (0, express_1.Router)();
// ============ CHANGELOGS PUBLICS ============
// Accessible sans authentification via GET /api/users/changelogs
exports.usersRouter.get('/changelogs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const changelogs = await admin_service_1.adminService.getChangelogs(limit, offset);
        res.json(changelogs);
    }
    catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Récupérer l'utilisateur courant (doit être avant /:userId)
exports.usersRouter.get('/me', auth_1.authMiddleware, auth_controller_1.authController.me.bind(auth_controller_1.authController));
// Rechercher des utilisateurs
exports.usersRouter.get('/search', (0, express_validator_1.query)('q').isString().isLength({ min: 1 }), (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 50 }), validate_1.validateRequest, users_controller_1.userController.searchUsers.bind(users_controller_1.userController));
// Récupérer plusieurs utilisateurs par IDs
exports.usersRouter.get('/batch', (0, express_validator_1.query)('ids').isString(), validate_1.validateRequest, users_controller_1.userController.getUsers.bind(users_controller_1.userController));
// Vérifier la disponibilité d'un nom d'utilisateur
exports.usersRouter.get('/check-username/:username', users_controller_1.userController.checkUsernameAvailable.bind(users_controller_1.userController));
// Récupérer la clé publique E2EE d'un utilisateur
exports.usersRouter.get('/:userId/public-key', auth_1.authMiddleware, users_controller_1.userController.getPublicKey.bind(users_controller_1.userController));
// Récupérer un utilisateur
exports.usersRouter.get('/:userId', users_controller_1.userController.getUser.bind(users_controller_1.userController));
// Mettre à jour le profil (authentifié)
exports.usersRouter.patch('/:userId', auth_1.authMiddleware, (0, express_validator_1.body)('displayName').optional().isLength({ max: 64 }), (0, express_validator_1.body)('avatarUrl').optional().isString(), (0, express_validator_1.body)('bannerUrl').optional().isString(), (0, express_validator_1.body)('bio').optional().isLength({ max: 500 }), (0, express_validator_1.body)('cardColor').optional().isString().isLength({ max: 7 }), (0, express_validator_1.body)('showBadges').optional().isBoolean(), (0, express_validator_1.body)('hiddenBadgeIds').optional().isArray(), validate_1.validateRequest, users_controller_1.userController.updateProfile.bind(users_controller_1.userController));
// Mettre à jour le statut (authentifié — seul l'utilisateur peut modifier son propre statut)
exports.usersRouter.patch('/:userId/status', auth_1.authMiddleware, (0, express_validator_1.body)('status').isIn(['online', 'idle', 'dnd', 'invisible', 'offline']), (0, express_validator_1.body)('customStatus').optional({ nullable: true }).isString().isLength({ max: 100 }), (0, express_validator_1.body)('text').optional({ nullable: true }).isString().isLength({ max: 100 }), (0, express_validator_1.body)('emoji').optional({ nullable: true }).isString().isLength({ max: 10 }), validate_1.validateRequest, users_controller_1.userController.updateStatus.bind(users_controller_1.userController));
// Mettre à jour le statut personnalisé uniquement
exports.usersRouter.patch('/:userId/custom-status', auth_1.authMiddleware, (0, express_validator_1.body)('customStatus').optional({ nullable: true }).isString().isLength({ max: 100 }), validate_1.validateRequest, users_controller_1.userController.updateCustomStatus.bind(users_controller_1.userController));
// Mettre à jour last seen
exports.usersRouter.patch('/:userId/last-seen', auth_1.authMiddleware, users_controller_1.userController.updateLastSeen.bind(users_controller_1.userController));
// Récupérer les préférences (authentifié)
exports.usersRouter.get('/:userId/preferences', auth_1.authMiddleware, users_controller_1.userController.getPreferences.bind(users_controller_1.userController));
// Mettre à jour les préférences (authentifié)
exports.usersRouter.patch('/:userId/preferences', auth_1.authMiddleware, validate_1.validateRequest, users_controller_1.userController.updatePreferences.bind(users_controller_1.userController));
// Changer le mot de passe (authentifié)
exports.usersRouter.post('/:userId/change-password', auth_1.authMiddleware, (0, express_validator_1.body)('currentPassword').isString().isLength({ min: 1 }), (0, express_validator_1.body)('newPassword').isString().isLength({ min: 8 }), validate_1.validateRequest, users_controller_1.userController.changePassword.bind(users_controller_1.userController));
// Changer le nom d'utilisateur (authentifié)
exports.usersRouter.post('/:userId/change-username', auth_1.authMiddleware, (0, express_validator_1.body)('newUsername').isString().isLength({ min: 3, max: 32 }).matches(/^[a-z0-9_]+$/), (0, express_validator_1.body)('password').isString().isLength({ min: 1 }), validate_1.validateRequest, users_controller_1.userController.changeUsername.bind(users_controller_1.userController));
// ============ ROUTES BADGES ============
// Récupérer les badges d'un utilisateur
exports.usersRouter.get('/:userId/badges', users_controller_1.userController.getBadges.bind(users_controller_1.userController));
// Attribuer un badge (admin)
exports.usersRouter.post('/:userId/badges', auth_1.authMiddleware, (0, express_validator_1.body)('badgeType').isString(), validate_1.validateRequest, users_controller_1.userController.addBadge.bind(users_controller_1.userController));
// Retirer un badge (admin)
exports.usersRouter.delete('/:userId/badges/:badgeId', auth_1.authMiddleware, users_controller_1.userController.removeBadge.bind(users_controller_1.userController));
// Basculer l'affichage des badges
exports.usersRouter.patch('/:userId/badges/visibility', auth_1.authMiddleware, (0, express_validator_1.body)('show').isBoolean(), validate_1.validateRequest, users_controller_1.userController.toggleBadgesVisibility.bind(users_controller_1.userController));
// ============ PRÉSENCE MUSICALE ============
// Mettre à jour la présence musicale de l'utilisateur connecté
exports.usersRouter.patch('/:userId/music-presence', auth_1.authMiddleware, async (req, res) => {
    try {
        if (req.userId !== req.params.userId) {
            return res.status(403).json({ error: 'Non autorisé' });
        }
        const data = req.body; // null pour effacer, ou { title, artist, coverUrl, platform, startedAt }
        await users_service_1.userService.updateMusicPresence(req.params.userId, data ?? null);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ============ PROFILE CARD ============
exports.usersRouter.patch('/:userId/profile-card', auth_1.authMiddleware, (0, express_validator_1.body)('profileCardUrl').optional({ nullable: true }).isString(), validate_1.validateRequest, async (req, res) => {
    try {
        if (req.userId !== req.params.userId) {
            return res.status(403).json({ error: 'Non autorisé' });
        }
        await users_service_1.userService.updateProfileCard(req.params.userId, req.body.profileCardUrl ?? null);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ============ FAVORIS (emojis/stickers/gifs) ============
// Récupérer les favoris
exports.usersRouter.get('/me/favorites', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const type = req.query.type;
        const favorites = await users_service_1.userService.getFavorites(userId, type);
        res.json(favorites);
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Ajouter un favori
exports.usersRouter.post('/me/favorites', auth_1.authMiddleware, (0, express_validator_1.body)('type').isIn(['emoji', 'sticker', 'gif']), (0, express_validator_1.body)('value').isString().isLength({ min: 1, max: 500 }), validate_1.validateRequest, async (req, res) => {
    try {
        const userId = req.userId;
        const { type, value } = req.body;
        const fav = await users_service_1.userService.addFavorite(userId, type, value);
        res.status(201).json(fav);
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Supprimer un favori
exports.usersRouter.delete('/me/favorites/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        await users_service_1.userService.removeFavorite(userId, req.params.id);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Réordonner les favoris
exports.usersRouter.patch('/me/favorites/reorder', auth_1.authMiddleware, (0, express_validator_1.body)('orderedIds').isArray(), validate_1.validateRequest, async (req, res) => {
    try {
        const userId = req.userId;
        await users_service_1.userService.reorderFavorites(userId, req.body.orderedIds);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ============ VISIBILITÉ DE L'ACTIVITÉ ============
// Récupérer la liste des utilisateurs à qui l'activité est cachée
exports.usersRouter.get('/me/hidden-from', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const hiddenFrom = await users_service_1.userService.getActivityHiddenFrom(userId);
        res.json(hiddenFrom);
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Cacher l'activité à un utilisateur
exports.usersRouter.post('/me/hide-activity/:targetUserId', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        await users_service_1.userService.hideActivityFrom(userId, req.params.targetUserId);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Montrer l'activité à un utilisateur (supprimer l'exception)
exports.usersRouter.delete('/me/hide-activity/:targetUserId', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        await users_service_1.userService.showActivityTo(userId, req.params.targetUserId);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ============ DMs ÉPINGLÉS ============
// Récupérer les conversations épinglées de l'utilisateur
exports.usersRouter.get('/me/pinned-conversations', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const pinned = await users_service_1.userService.getPinnedConversations(userId);
        res.json(pinned);
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Épingler une conversation
exports.usersRouter.post('/me/pinned-conversations/:conversationId', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        await users_service_1.userService.pinConversation(userId, req.params.conversationId);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Désépingler une conversation
exports.usersRouter.delete('/me/pinned-conversations/:conversationId', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        await users_service_1.userService.unpinConversation(userId, req.params.conversationId);
        res.json({ success: true });
    }
    catch {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
//# sourceMappingURL=users.js.map