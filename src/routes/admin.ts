// ==========================================
// ALFYCHAT - ROUTES ADMIN
// ==========================================

import { Router } from 'express';
import { body, query } from 'express-validator';
import { adminController } from '../controllers/admin.controller';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import { validateRequest } from '../middleware/validate';

export const adminRouter = Router();

// Toutes les routes admin nécessitent l'authentification + rôle admin
adminRouter.use(authMiddleware);
adminRouter.use(adminMiddleware);

// ============ STATISTIQUES ============
adminRouter.get('/stats',
  adminController.getStats.bind(adminController)
);

// ============ BADGES PERSONNALISÉS ============

// Récupérer tous les badges
adminRouter.get('/badges',
  adminController.getAllBadges.bind(adminController)
);

// Créer un badge
adminRouter.post('/badges',
  body('name').isString().isLength({ min: 1, max: 100 }),
  body('description').optional().isString(),
  body('iconType').isIn(['bootstrap', 'svg']),
  body('iconValue').isString().isLength({ min: 1 }),
  body('color').isString().matches(/^#[0-9A-Fa-f]{6}$/),
  body('displayOrder').optional().isInt(),
  validateRequest,
  adminController.createBadge.bind(adminController)
);

// Mettre à jour un badge
adminRouter.patch('/badges/:badgeId',
  body('name').optional().isString().isLength({ min: 1, max: 100 }),
  body('description').optional().isString(),
  body('iconType').optional().isIn(['bootstrap', 'svg']),
  body('iconValue').optional().isString().isLength({ min: 1 }),
  body('color').optional().isString().matches(/^#[0-9A-Fa-f]{6}$/),
  body('displayOrder').optional().isInt(),
  validateRequest,
  adminController.updateBadge.bind(adminController)
);

// Activer/désactiver un badge
adminRouter.patch('/badges/:badgeId/status',
  body('isActive').isBoolean(),
  validateRequest,
  adminController.toggleBadgeStatus.bind(adminController)
);

// Supprimer un badge
adminRouter.delete('/badges/:badgeId',
  adminController.deleteBadge.bind(adminController)
);

// ============ ATTRIBUTION DE BADGES AUX UTILISATEURS ============

// Attribuer un badge à un utilisateur
adminRouter.post('/users/:userId/badges/:badgeId',
  adminController.assignBadgeToUser.bind(adminController)
);

// Retirer un badge d'un utilisateur
adminRouter.delete('/users/:userId/badges/:badgeId',
  adminController.removeBadgeFromUser.bind(adminController)
);

// ============ GESTION DES UTILISATEURS ============

// Récupérer tous les utilisateurs
adminRouter.get('/users',
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('offset').optional().isInt({ min: 0 }),
  validateRequest,
  adminController.getAllUsers.bind(adminController)
);

// Rechercher des utilisateurs
adminRouter.get('/users/search',
  query('q').isString().isLength({ min: 1 }),
  validateRequest,
  adminController.searchUsers.bind(adminController)
);

// Mettre à jour le rôle d'un utilisateur
adminRouter.patch('/users/:userId/role',
  body('role').isIn(['user', 'moderator', 'admin']),
  validateRequest,
  adminController.updateUserRole.bind(adminController)
);

// ============ PARAMÈTRES DU SITE ============

// Récupérer les paramètres
adminRouter.get('/settings',
  adminController.getSiteSettings.bind(adminController)
);

// Mettre à jour un paramètre
adminRouter.put('/settings',
  body('key').isString().isLength({ min: 1 }),
  body('value').isString(),
  validateRequest,
  adminController.updateSiteSetting.bind(adminController)
);

// ============ LIENS D'INSCRIPTION ============

// Créer un lien d'inscription
adminRouter.post('/invite-links',
  body('email').isEmail().normalizeEmail(),
  body('expiresInHours').optional().isInt({ min: 1, max: 720 }),
  validateRequest,
  adminController.createInviteLink.bind(adminController)
);

// Récupérer tous les liens
adminRouter.get('/invite-links',
  adminController.getInviteLinks.bind(adminController)
);

// Supprimer un lien
adminRouter.delete('/invite-links/:linkId',
  adminController.deleteInviteLink.bind(adminController)
);

// ============ CHANGELOGS ============

// Récupérer tous les changelogs (aussi accessible publiquement via /users/changelogs)
adminRouter.get('/changelogs',
  adminController.getChangelogs.bind(adminController)
);

// Créer un changelog
adminRouter.post('/changelogs',
  body('version').isString().isLength({ min: 1, max: 50 }),
  body('title').isString().isLength({ min: 1, max: 255 }),
  body('content').isString().isLength({ min: 1 }),
  body('type').optional().isIn(['feature', 'fix', 'improvement', 'security', 'breaking']),
  validateRequest,
  adminController.createChangelog.bind(adminController)
);

// Supprimer un changelog
adminRouter.delete('/changelogs/:changelogId',
  adminController.deleteChangelog.bind(adminController)
);
