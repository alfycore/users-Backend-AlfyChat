// ==========================================
// ALFYCHAT - ROUTES UTILISATEURS
// ==========================================

import { Router } from 'express';
import { body, query } from 'express-validator';
import { userController } from '../controllers/users.controller';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { authController } from '../controllers/auth.controller';

export const usersRouter = Router();

// Récupérer l'utilisateur courant (doit être avant /:userId)
usersRouter.get('/me',
  authMiddleware,
  authController.me.bind(authController)
);

// Rechercher des utilisateurs
usersRouter.get('/search',
  query('q').isString().isLength({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validateRequest,
  userController.searchUsers.bind(userController)
);

// Récupérer plusieurs utilisateurs par IDs
usersRouter.get('/batch',
  query('ids').isString(),
  validateRequest,
  userController.getUsers.bind(userController)
);

// Récupérer la clé publique E2EE d'un utilisateur
usersRouter.get('/:userId/public-key',
  authMiddleware,
  userController.getPublicKey.bind(userController)
);

// Récupérer un utilisateur
usersRouter.get('/:userId',
  userController.getUser.bind(userController)
);

// Mettre à jour le profil (authentifié)
usersRouter.patch('/:userId',
  authMiddleware,
  body('displayName').optional().isLength({ max: 64 }),
  body('avatarUrl').optional().isString(),
  body('bannerUrl').optional().isString(),
  body('bio').optional().isLength({ max: 500 }),
  body('cardColor').optional().isString().isLength({ max: 7 }),
  body('showBadges').optional().isBoolean(),
  validateRequest,
  userController.updateProfile.bind(userController)
);

// Mettre à jour le statut
usersRouter.patch('/:userId/status',
  body('status').isIn(['online', 'idle', 'dnd', 'invisible', 'offline']),
  validateRequest,
  userController.updateStatus.bind(userController)
);

// Mettre à jour last seen
usersRouter.patch('/:userId/last-seen',
  userController.updateLastSeen.bind(userController)
);

// Récupérer les préférences (authentifié)
usersRouter.get('/:userId/preferences',
  authMiddleware,
  userController.getPreferences.bind(userController)
);

// Mettre à jour les préférences (authentifié)
usersRouter.patch('/:userId/preferences',
  authMiddleware,
  validateRequest,
  userController.updatePreferences.bind(userController)
);

// Changer le mot de passe (authentifié)
usersRouter.post('/:userId/change-password',
  authMiddleware,
  body('currentPassword').isString().isLength({ min: 1 }),
  body('newPassword').isString().isLength({ min: 8 }),
  validateRequest,
  userController.changePassword.bind(userController)
);

// ============ ROUTES BADGES ============

// Récupérer les badges d'un utilisateur
usersRouter.get('/:userId/badges',
  userController.getBadges.bind(userController)
);

// Attribuer un badge (admin)
usersRouter.post('/:userId/badges',
  authMiddleware,
  body('badgeType').isString(),
  validateRequest,
  userController.addBadge.bind(userController)
);

// Retirer un badge (admin)
usersRouter.delete('/:userId/badges/:badgeId',
  authMiddleware,
  userController.removeBadge.bind(userController)
);

// Basculer l'affichage des badges
usersRouter.patch('/:userId/badges/visibility',
  authMiddleware,
  body('show').isBoolean(),
  validateRequest,
  userController.toggleBadgesVisibility.bind(userController)
);
