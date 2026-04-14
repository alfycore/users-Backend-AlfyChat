// ==========================================
// ALFYCHAT - ROUTES UTILISATEURS
// ==========================================

import { Router } from 'express';
import { body, query } from 'express-validator';
import { userController } from '../controllers/users.controller';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { authController } from '../controllers/auth.controller';
import { adminService } from '../services/admin.service';
import { userService } from '../services/users.service';

export const usersRouter = Router();

// ============ CHANGELOGS PUBLICS ============
// Accessible sans authentification via GET /api/users/changelogs
usersRouter.get('/changelogs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const changelogs = await adminService.getChangelogs(limit, offset);
    res.json(changelogs);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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

// Vérifier la disponibilité d'un nom d'utilisateur
usersRouter.get('/check-username/:username',
  userController.checkUsernameAvailable.bind(userController)
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
  body('hiddenBadgeIds').optional().isArray(),
  validateRequest,
  userController.updateProfile.bind(userController)
);

// Mettre à jour le statut (authentifié — seul l'utilisateur peut modifier son propre statut)
usersRouter.patch('/:userId/status',
  authMiddleware,
  body('status').isIn(['online', 'idle', 'dnd', 'invisible', 'offline']),
  body('customStatus').optional({ nullable: true }).isString().isLength({ max: 100 }),
  validateRequest,
  userController.updateStatus.bind(userController)
);

// Mettre à jour le statut personnalisé uniquement
usersRouter.patch('/:userId/custom-status',
  authMiddleware,
  body('customStatus').optional({ nullable: true }).isString().isLength({ max: 100 }),
  validateRequest,
  userController.updateCustomStatus.bind(userController)
);

// Mettre à jour last seen
usersRouter.patch('/:userId/last-seen',
  authMiddleware,
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

// Changer le nom d'utilisateur (authentifié)
usersRouter.post('/:userId/change-username',
  authMiddleware,
  body('newUsername').isString().isLength({ min: 3, max: 32 }).matches(/^[a-z0-9_]+$/),
  body('password').isString().isLength({ min: 1 }),
  validateRequest,
  userController.changeUsername.bind(userController)
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

// ============ PRÉSENCE MUSICALE ============

// Mettre à jour la présence musicale de l'utilisateur connecté
usersRouter.patch('/:userId/music-presence',
  authMiddleware,
  async (req, res) => {
    try {
      if ((req as any).userId !== req.params.userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }
      const data = req.body; // null pour effacer, ou { title, artist, coverUrl, platform, startedAt }
      await userService.updateMusicPresence(req.params.userId, data ?? null);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ============ PROFILE CARD ============

usersRouter.patch('/:userId/profile-card',
  authMiddleware,
  body('profileCardUrl').optional({ nullable: true }).isString(),
  validateRequest,
  async (req, res) => {
    try {
      if ((req as any).userId !== req.params.userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }
      await userService.updateProfileCard(req.params.userId, req.body.profileCardUrl ?? null);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ============ FAVORIS (emojis/stickers/gifs) ============

// Récupérer les favoris
usersRouter.get('/me/favorites',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      const type = req.query.type as 'emoji' | 'sticker' | 'gif' | undefined;
      const favorites = await userService.getFavorites(userId, type);
      res.json(favorites);
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Ajouter un favori
usersRouter.post('/me/favorites',
  authMiddleware,
  body('type').isIn(['emoji', 'sticker', 'gif']),
  body('value').isString().isLength({ min: 1, max: 500 }),
  validateRequest,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { type, value } = req.body;
      const fav = await userService.addFavorite(userId, type, value);
      res.status(201).json(fav);
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Supprimer un favori
usersRouter.delete('/me/favorites/:id',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      await userService.removeFavorite(userId, req.params.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Réordonner les favoris
usersRouter.patch('/me/favorites/reorder',
  authMiddleware,
  body('orderedIds').isArray(),
  validateRequest,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      await userService.reorderFavorites(userId, req.body.orderedIds);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ============ VISIBILITÉ DE L'ACTIVITÉ ============

// Récupérer la liste des utilisateurs à qui l'activité est cachée
usersRouter.get('/me/hidden-from',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      const hiddenFrom = await userService.getActivityHiddenFrom(userId);
      res.json(hiddenFrom);
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Cacher l'activité à un utilisateur
usersRouter.post('/me/hide-activity/:targetUserId',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      await userService.hideActivityFrom(userId, req.params.targetUserId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Montrer l'activité à un utilisateur (supprimer l'exception)
usersRouter.delete('/me/hide-activity/:targetUserId',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      await userService.showActivityTo(userId, req.params.targetUserId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ============ DMs ÉPINGLÉS ============

// Récupérer les conversations épinglées de l'utilisateur
usersRouter.get('/me/pinned-conversations',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      const pinned = await userService.getPinnedConversations(userId);
      res.json(pinned);
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Épingler une conversation
usersRouter.post('/me/pinned-conversations/:conversationId',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      await userService.pinConversation(userId, req.params.conversationId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Désépingler une conversation
usersRouter.delete('/me/pinned-conversations/:conversationId',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = (req as any).userId;
      await userService.unpinConversation(userId, req.params.conversationId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);
