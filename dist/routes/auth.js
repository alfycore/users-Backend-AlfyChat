"use strict";
// ==========================================
// ALFYCHAT - ROUTES AUTHENTIFICATION
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
exports.authRouter = (0, express_1.Router)();
// Paramètres d'inscription publics (pas d'auth requise)
exports.authRouter.get('/register/settings', auth_controller_1.authController.getRegisterSettings.bind(auth_controller_1.authController));
// Inscription
exports.authRouter.post('/register', (0, express_validator_1.body)('email').isEmail().normalizeEmail(), (0, express_validator_1.body)('username').isString().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/), (0, express_validator_1.body)('password').isString().isLength({ min: 8 }), (0, express_validator_1.body)('displayName').optional().isString().isLength({ max: 64 }), (0, express_validator_1.body)('inviteCode').optional().isString(), (0, express_validator_1.body)('turnstileToken').optional().isString(), validate_1.validateRequest, auth_controller_1.authController.register.bind(auth_controller_1.authController));
// Connexion
exports.authRouter.post('/login', (0, express_validator_1.body)('email').isEmail().normalizeEmail(), (0, express_validator_1.body)('password').isString().isLength({ min: 1 }), validate_1.validateRequest, auth_controller_1.authController.login.bind(auth_controller_1.authController));
// Finaliser la connexion avec code 2FA
exports.authRouter.post('/2fa/login', (0, express_validator_1.body)('twoFactorToken').isString(), (0, express_validator_1.body)('code').isString().isLength({ min: 6, max: 8 }), validate_1.validateRequest, auth_controller_1.authController.loginWith2FA.bind(auth_controller_1.authController));
// Rafraîchir le token
exports.authRouter.post('/refresh', (0, express_validator_1.body)('refreshToken').isString(), validate_1.validateRequest, auth_controller_1.authController.refresh.bind(auth_controller_1.authController));
// Déconnexion
exports.authRouter.post('/logout', auth_1.authMiddleware, auth_controller_1.authController.logout.bind(auth_controller_1.authController));
// Déconnexion de toutes les sessions
exports.authRouter.post('/logout-all', auth_1.authMiddleware, auth_controller_1.authController.logoutAll.bind(auth_controller_1.authController));
// Vérifier le token
exports.authRouter.get('/verify', auth_1.authMiddleware, auth_controller_1.authController.verify.bind(auth_controller_1.authController));
// ==========================================
// VÉRIFICATION EMAIL
// ==========================================
exports.authRouter.get('/verify-email', auth_controller_1.authController.verifyEmail.bind(auth_controller_1.authController));
exports.authRouter.post('/resend-verification', auth_1.authMiddleware, auth_controller_1.authController.resendVerification.bind(auth_controller_1.authController));
// ==========================================
// 2FA (TOTP)
// ==========================================
// Statut 2FA
exports.authRouter.get('/2fa/status', auth_1.authMiddleware, auth_controller_1.authController.get2FAStatus.bind(auth_controller_1.authController));
// Étape 1 : générer le secret + QR code
exports.authRouter.post('/2fa/setup', auth_1.authMiddleware, auth_controller_1.authController.setup2FA.bind(auth_controller_1.authController));
// Étape 2 : activer avec un code valide
exports.authRouter.post('/2fa/enable', auth_1.authMiddleware, (0, express_validator_1.body)('code').isString().isLength({ min: 6, max: 6 }), validate_1.validateRequest, auth_controller_1.authController.enable2FA.bind(auth_controller_1.authController));
// Désactiver le 2FA
exports.authRouter.post('/2fa/disable', auth_1.authMiddleware, (0, express_validator_1.body)('code').isString().isLength({ min: 6, max: 8 }), validate_1.validateRequest, auth_controller_1.authController.disable2FA.bind(auth_controller_1.authController));
// Récupérer l'utilisateur courant
exports.authRouter.get('/me', auth_1.authMiddleware, auth_controller_1.authController.me.bind(auth_controller_1.authController));
// ==========================================
// SESSIONS ACTIVES
// ==========================================
// Lister les sessions de l'utilisateur courant
exports.authRouter.get('/sessions', auth_1.authMiddleware, auth_controller_1.authController.getSessions.bind(auth_controller_1.authController));
// Révoquer une session spécifique
exports.authRouter.delete('/sessions/:id', auth_1.authMiddleware, auth_controller_1.authController.revokeSession.bind(auth_controller_1.authController));
//# sourceMappingURL=auth.js.map