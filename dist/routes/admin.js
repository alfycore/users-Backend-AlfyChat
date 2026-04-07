"use strict";
// ==========================================
// ALFYCHAT - ROUTES ADMIN
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const admin_controller_1 = require("../controllers/admin.controller");
const auth_1 = require("../middleware/auth");
const admin_1 = require("../middleware/admin");
const validate_1 = require("../middleware/validate");
exports.adminRouter = (0, express_1.Router)();
// Toutes les routes admin nécessitent l'authentification + rôle admin
exports.adminRouter.use(auth_1.authMiddleware);
exports.adminRouter.use(admin_1.adminMiddleware);
// ============ STATISTIQUES ============
exports.adminRouter.get('/stats', admin_controller_1.adminController.getStats.bind(admin_controller_1.adminController));
// ============ BADGES PERSONNALISÉS ============
// Récupérer tous les badges
exports.adminRouter.get('/badges', admin_controller_1.adminController.getAllBadges.bind(admin_controller_1.adminController));
// Créer un badge
exports.adminRouter.post('/badges', (0, express_validator_1.body)('name').isString().isLength({ min: 1, max: 100 }), (0, express_validator_1.body)('description').optional().isString(), (0, express_validator_1.body)('iconType').isIn(['bootstrap', 'svg']), (0, express_validator_1.body)('iconValue').isString().isLength({ min: 1 }), (0, express_validator_1.body)('color').isString().matches(/^#[0-9A-Fa-f]{6}$/), (0, express_validator_1.body)('displayOrder').optional().isInt(), validate_1.validateRequest, admin_controller_1.adminController.createBadge.bind(admin_controller_1.adminController));
// Mettre à jour un badge
exports.adminRouter.patch('/badges/:badgeId', (0, express_validator_1.body)('name').optional().isString().isLength({ min: 1, max: 100 }), (0, express_validator_1.body)('description').optional().isString(), (0, express_validator_1.body)('iconType').optional().isIn(['bootstrap', 'svg']), (0, express_validator_1.body)('iconValue').optional().isString().isLength({ min: 1 }), (0, express_validator_1.body)('color').optional().isString().matches(/^#[0-9A-Fa-f]{6}$/), (0, express_validator_1.body)('displayOrder').optional().isInt(), validate_1.validateRequest, admin_controller_1.adminController.updateBadge.bind(admin_controller_1.adminController));
// Activer/désactiver un badge
exports.adminRouter.patch('/badges/:badgeId/status', (0, express_validator_1.body)('isActive').isBoolean(), validate_1.validateRequest, admin_controller_1.adminController.toggleBadgeStatus.bind(admin_controller_1.adminController));
// Supprimer un badge
exports.adminRouter.delete('/badges/:badgeId', admin_controller_1.adminController.deleteBadge.bind(admin_controller_1.adminController));
// ============ ATTRIBUTION DE BADGES AUX UTILISATEURS ============
// Attribuer un badge à un utilisateur
exports.adminRouter.post('/users/:userId/badges/:badgeId', admin_controller_1.adminController.assignBadgeToUser.bind(admin_controller_1.adminController));
// Retirer un badge d'un utilisateur
exports.adminRouter.delete('/users/:userId/badges/:badgeId', admin_controller_1.adminController.removeBadgeFromUser.bind(admin_controller_1.adminController));
// ============ GESTION DES UTILISATEURS ============
// Récupérer tous les utilisateurs
exports.adminRouter.get('/users', (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 500 }), (0, express_validator_1.query)('offset').optional().isInt({ min: 0 }), validate_1.validateRequest, admin_controller_1.adminController.getAllUsers.bind(admin_controller_1.adminController));
// Rechercher des utilisateurs
exports.adminRouter.get('/users/search', (0, express_validator_1.query)('q').isString().isLength({ min: 1 }), validate_1.validateRequest, admin_controller_1.adminController.searchUsers.bind(admin_controller_1.adminController));
// Mettre à jour le rôle d'un utilisateur
exports.adminRouter.patch('/users/:userId/role', (0, express_validator_1.body)('role').isIn(['user', 'moderator', 'admin']), validate_1.validateRequest, admin_controller_1.adminController.updateUserRole.bind(admin_controller_1.adminController));
// ============ PARAMÈTRES DU SITE ============
// Récupérer les paramètres
exports.adminRouter.get('/settings', admin_controller_1.adminController.getSiteSettings.bind(admin_controller_1.adminController));
// Mettre à jour un paramètre
exports.adminRouter.put('/settings', (0, express_validator_1.body)('key').isString().isLength({ min: 1 }), (0, express_validator_1.body)('value').isString(), validate_1.validateRequest, admin_controller_1.adminController.updateSiteSetting.bind(admin_controller_1.adminController));
// ============ LIENS D'INSCRIPTION ============
// Créer un lien d'inscription
exports.adminRouter.post('/invite-links', (0, express_validator_1.body)('email').isEmail().normalizeEmail(), (0, express_validator_1.body)('expiresInHours').optional().isInt({ min: 1, max: 720 }), validate_1.validateRequest, admin_controller_1.adminController.createInviteLink.bind(admin_controller_1.adminController));
// Récupérer tous les liens
exports.adminRouter.get('/invite-links', admin_controller_1.adminController.getInviteLinks.bind(admin_controller_1.adminController));
// Supprimer un lien
exports.adminRouter.delete('/invite-links/:linkId', admin_controller_1.adminController.deleteInviteLink.bind(admin_controller_1.adminController));
//# sourceMappingURL=admin.js.map