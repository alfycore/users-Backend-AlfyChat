// ==========================================
// ALFYCHAT - ROUTES AUTHENTIFICATION
// ==========================================

import { Router } from 'express';
import { body } from 'express-validator';
import { authController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';

export const authRouter = Router();

// Paramètres d'inscription publics (pas d'auth requise)
authRouter.get('/register/settings', authController.getRegisterSettings.bind(authController));

// Inscription
authRouter.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('username').isString().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
  body('password').isString().isLength({ min: 8 }),
  body('displayName').optional().isString().isLength({ max: 64 }),
  body('inviteCode').optional().isString(),
  body('turnstileToken').optional().isString(),
  body('publicKey').optional().isString(),
  body('encryptedPrivateKey').optional().isString(),
  body('keySalt').optional().isString().isLength({ max: 64 }),
  validateRequest,
  authController.register.bind(authController)
);

// Connexion
authRouter.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 1 }),
  validateRequest,
  authController.login.bind(authController)
);

// Finaliser la connexion avec code 2FA
authRouter.post('/2fa/login',
  body('twoFactorToken').isString(),
  body('code').isString().isLength({ min: 6, max: 8 }),
  validateRequest,
  authController.loginWith2FA.bind(authController)
);

// Rafraîchir le token
authRouter.post('/refresh',
  body('refreshToken').isString(),
  validateRequest,
  authController.refresh.bind(authController)
);

// Déconnexion
authRouter.post('/logout',
  authMiddleware,
  authController.logout.bind(authController)
);

// Déconnexion de toutes les sessions
authRouter.post('/logout-all',
  authMiddleware,
  authController.logoutAll.bind(authController)
);

// Vérifier le token
authRouter.get('/verify',
  authMiddleware,
  authController.verify.bind(authController)
);

// ==========================================
// VÉRIFICATION EMAIL
// ==========================================
authRouter.get('/verify-email',
  authController.verifyEmail.bind(authController)
);

authRouter.post('/resend-verification',
  authMiddleware,
  authController.resendVerification.bind(authController)
);

// Renvoyer l'email de vérification sans être authentifié (depuis la page de connexion)
authRouter.post('/resend-verification-email',
  body('email').isEmail().normalizeEmail(),
  validateRequest,
  authController.resendVerificationByEmail.bind(authController)
);

// ==========================================
// 2FA (TOTP)
// ==========================================
// Statut 2FA
authRouter.get('/2fa/status',
  authMiddleware,
  authController.get2FAStatus.bind(authController)
);

// Étape 1 : générer le secret + QR code
authRouter.post('/2fa/setup',
  authMiddleware,
  authController.setup2FA.bind(authController)
);

// Étape 2 : activer avec un code valide
authRouter.post('/2fa/enable',
  authMiddleware,
  body('code').isString().isLength({ min: 6, max: 6 }),
  validateRequest,
  authController.enable2FA.bind(authController)
);

// Désactiver le 2FA
authRouter.post('/2fa/disable',
  authMiddleware,
  body('code').isString().isLength({ min: 6, max: 8 }),
  validateRequest,
  authController.disable2FA.bind(authController)
);

// Sauvegarder les clés E2EE (utilisateurs existants sans clé)
authRouter.patch('/keys',
  authMiddleware,
  body('publicKey').isString(),
  body('encryptedPrivateKey').isString(),
  body('keySalt').isString().isLength({ max: 64 }),
  validateRequest,
  authController.saveKeys.bind(authController)
);

// Récupérer l'utilisateur courant
authRouter.get('/me',
  authMiddleware,
  authController.me.bind(authController)
);

// ==========================================
// SESSIONS ACTIVES
// ==========================================
// Lister les sessions de l'utilisateur courant
authRouter.get('/sessions',
  authMiddleware,
  authController.getSessions.bind(authController)
);

// Révoquer une session spécifique
authRouter.delete('/sessions/:id',
  authMiddleware,
  authController.revokeSession.bind(authController)
);
