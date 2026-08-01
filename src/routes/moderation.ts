// ==========================================
// ALFYCHAT - ROUTES MODÉRATION
// Montées sur /admin/moderation → exposées via /api/admin/moderation
// ==========================================

import { Router } from 'express';
import { body, query } from 'express-validator';
import { moderationController } from '../controllers/moderation.controller';
import { authMiddleware } from '../middleware/auth';
import { staffMiddleware } from '../middleware/admin';
import { validateRequest } from '../middleware/validate';

export const moderationRouter = Router();

// Réservé au staff (admin, modérateurs, support, techniciens)
moderationRouter.use(authMiddleware);
moderationRouter.use(staffMiddleware);

// ============ TABLEAU DE BORD ============

moderationRouter.get('/stats',
  moderationController.getStats.bind(moderationController)
);

// ============ SANCTIONS ============

moderationRouter.get('/sanctions',
  query('userId').optional().isString(),
  query('type').optional().isIn(['warn', 'mute', 'kick', 'ban']),
  query('activeOnly').optional().isBoolean(),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  query('offset').optional().isInt({ min: 0 }),
  validateRequest,
  moderationController.listSanctions.bind(moderationController)
);

// Dossier de modération complet d'un utilisateur
moderationRouter.get('/users/:userId',
  moderationController.getUserModeration.bind(moderationController)
);

// Appliquer une sanction (avertissement, mute, kick, ban)
moderationRouter.post('/users/:userId/sanctions',
  body('type').isIn(['warn', 'mute', 'kick', 'ban']),
  body('reason').isString().isLength({ min: 3, max: 1000 }),
  // null / absent = permanent (ban, mute) ou sans objet (warn, kick)
  body('durationMinutes').optional({ nullable: true }).isInt({ min: 1, max: 525_600 }),
  validateRequest,
  moderationController.createSanction.bind(moderationController)
);

// Lever une sanction précise
moderationRouter.delete('/sanctions/:sanctionId',
  body('reason').optional().isString().isLength({ max: 1000 }),
  validateRequest,
  moderationController.revokeSanction.bind(moderationController)
);

// Raccourcis : lever tous les bans / mutes actifs d'un utilisateur
moderationRouter.post('/users/:userId/unban',
  body('reason').optional().isString().isLength({ max: 1000 }),
  validateRequest,
  moderationController.unbanUser.bind(moderationController)
);

moderationRouter.post('/users/:userId/unmute',
  body('reason').optional().isString().isLength({ max: 1000 }),
  validateRequest,
  moderationController.unmuteUser.bind(moderationController)
);

// ============ TERMES INTERDITS (filtre de pseudos) ============

moderationRouter.get('/terms',
  moderationController.listTerms.bind(moderationController)
);

moderationRouter.post('/terms',
  body('term').isString().isLength({ min: 2, max: 100 }),
  body('matchType').optional().isIn(['substring', 'word', 'exact']),
  validateRequest,
  moderationController.addTerm.bind(moderationController)
);

moderationRouter.delete('/terms/:termId',
  moderationController.deleteTerm.bind(moderationController)
);
