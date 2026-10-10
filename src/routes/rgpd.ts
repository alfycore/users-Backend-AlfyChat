// ==========================================
// ALFYCHAT - ROUTES RGPD
// ==========================================

import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { rgpdController } from '../controllers/rgpd.controller';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { getDatabaseClient } from '../database';
import { verifyPassword } from '../utils/password';

export const rgpdRouter = Router();

// Toutes les routes RGPD nécessitent une authentification
rgpdRouter.use(authMiddleware);

/**
 * Les actions destructrices (suppression, anonymisation) exigent le mot de
 * passe : un jeton d'accès volé (15 min) suffisait à effacer un compte.
 */
async function requirePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const password = req.body?.password;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Mot de passe requis' });
    }
    const [rows] = await getDatabaseClient().query('SELECT password_hash FROM users WHERE id = ?', [req.userId]);
    const hash = (rows as any[])[0]?.password_hash;
    if (!hash || !(await verifyPassword(password, hash))) {
      return res.status(403).json({ error: 'Mot de passe incorrect' });
    }
    next();
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/**
 * Routes « soi-même » appelées par le front (`/api/rgpd/delete`,
 * `/api/rgpd/export`, `/api/rgpd/consents`). Elles n'existaient pas : seules
 * les variantes `/:userId/...` étaient déclarées, et la suppression de compte
 * depuis l'interface finissait en 404.
 */
function asSelf(req: Request, _res: Response, next: NextFunction) {
  req.params.userId = req.userId as string;
  next();
}

rgpdRouter.get('/export', asSelf, rgpdController.exportData.bind(rgpdController));
rgpdRouter.post('/export', asSelf, rgpdController.exportData.bind(rgpdController));
rgpdRouter.post('/delete', asSelf, requirePassword, rgpdController.requestDeletion.bind(rgpdController));
rgpdRouter.delete('/delete', asSelf, rgpdController.cancelDeletion.bind(rgpdController));
rgpdRouter.get('/consents', asSelf, rgpdController.getConsents.bind(rgpdController));
rgpdRouter.put('/consents',
  asSelf,
  body('type').isIn(['necessary', 'analytics', 'marketing']),
  body('granted').isBoolean(),
  validateRequest,
  (req: Request, _res: Response, next: NextFunction) => {
    req.body.consentType = req.body.type;
    next();
  },
  rgpdController.updateConsent.bind(rgpdController)
);
rgpdRouter.post('/anonymize', asSelf, requirePassword, rgpdController.anonymize.bind(rgpdController));

// Exporter les données (Article 20 RGPD)
rgpdRouter.get('/:userId/export',
  rgpdController.exportData.bind(rgpdController)
);

// Demander la suppression (Article 17 RGPD)
rgpdRouter.post('/:userId/delete',
  requirePassword,
  rgpdController.requestDeletion.bind(rgpdController)
);

// Annuler la demande de suppression
rgpdRouter.delete('/:userId/delete',
  rgpdController.cancelDeletion.bind(rgpdController)
);

// Récupérer les consentements
rgpdRouter.get('/:userId/consents',
  rgpdController.getConsents.bind(rgpdController)
);

// Mettre à jour un consentement
rgpdRouter.patch('/:userId/consents',
  body('consentType').isIn(['necessary', 'analytics', 'marketing']),
  body('granted').isBoolean(),
  validateRequest,
  rgpdController.updateConsent.bind(rgpdController)
);

// Anonymiser les données
rgpdRouter.post('/:userId/anonymize',
  requirePassword,
  rgpdController.anonymize.bind(rgpdController)
);
