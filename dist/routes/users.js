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
exports.usersRouter = (0, express_1.Router)();
// Récupérer l'utilisateur courant (doit être avant /:userId)
exports.usersRouter.get('/me', auth_1.authMiddleware, auth_controller_1.authController.me.bind(auth_controller_1.authController));
// Rechercher des utilisateurs
exports.usersRouter.get('/search', (0, express_validator_1.query)('q').isString().isLength({ min: 1 }), (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 50 }), validate_1.validateRequest, users_controller_1.userController.searchUsers.bind(users_controller_1.userController));
// Récupérer plusieurs utilisateurs par IDs
exports.usersRouter.get('/batch', (0, express_validator_1.query)('ids').isString(), validate_1.validateRequest, users_controller_1.userController.getUsers.bind(users_controller_1.userController));
// Récupérer un utilisateur
exports.usersRouter.get('/:userId', users_controller_1.userController.getUser.bind(users_controller_1.userController));
// Mettre à jour le profil (authentifié)
exports.usersRouter.patch('/:userId', auth_1.authMiddleware, (0, express_validator_1.body)('displayName').optional().isLength({ max: 64 }), (0, express_validator_1.body)('avatarUrl').optional().isString(), (0, express_validator_1.body)('bannerUrl').optional().isString(), (0, express_validator_1.body)('bio').optional().isLength({ max: 500 }), (0, express_validator_1.body)('cardColor').optional().isString().isLength({ max: 7 }), (0, express_validator_1.body)('showBadges').optional().isBoolean(), validate_1.validateRequest, users_controller_1.userController.updateProfile.bind(users_controller_1.userController));
// Mettre à jour le statut
exports.usersRouter.patch('/:userId/status', (0, express_validator_1.body)('status').isIn(['online', 'idle', 'dnd', 'invisible', 'offline']), validate_1.validateRequest, users_controller_1.userController.updateStatus.bind(users_controller_1.userController));
// Mettre à jour last seen
exports.usersRouter.patch('/:userId/last-seen', users_controller_1.userController.updateLastSeen.bind(users_controller_1.userController));
// Récupérer les préférences (authentifié)
exports.usersRouter.get('/:userId/preferences', auth_1.authMiddleware, users_controller_1.userController.getPreferences.bind(users_controller_1.userController));
// Mettre à jour les préférences (authentifié)
exports.usersRouter.patch('/:userId/preferences', auth_1.authMiddleware, validate_1.validateRequest, users_controller_1.userController.updatePreferences.bind(users_controller_1.userController));
// Changer le mot de passe (authentifié)
exports.usersRouter.post('/:userId/change-password', auth_1.authMiddleware, (0, express_validator_1.body)('currentPassword').isString().isLength({ min: 1 }), (0, express_validator_1.body)('newPassword').isString().isLength({ min: 8 }), validate_1.validateRequest, users_controller_1.userController.changePassword.bind(users_controller_1.userController));
// ============ ROUTES BADGES ============
// Récupérer les badges d'un utilisateur
exports.usersRouter.get('/:userId/badges', users_controller_1.userController.getBadges.bind(users_controller_1.userController));
// Attribuer un badge (admin)
exports.usersRouter.post('/:userId/badges', auth_1.authMiddleware, (0, express_validator_1.body)('badgeType').isString(), validate_1.validateRequest, users_controller_1.userController.addBadge.bind(users_controller_1.userController));
// Retirer un badge (admin)
exports.usersRouter.delete('/:userId/badges/:badgeId', auth_1.authMiddleware, users_controller_1.userController.removeBadge.bind(users_controller_1.userController));
// Basculer l'affichage des badges
exports.usersRouter.patch('/:userId/badges/visibility', auth_1.authMiddleware, (0, express_validator_1.body)('show').isBoolean(), validate_1.validateRequest, users_controller_1.userController.toggleBadgesVisibility.bind(users_controller_1.userController));
//# sourceMappingURL=users.js.map