// ==========================================
// ALFYCHAT - ROUTES RGPD
// ==========================================

import { Router } from 'express';
import { body } from 'express-validator';
import { rgpdController } from '../controllers/rgpd.controller';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';

export const rgpdRouter = Router();

// Toutes les routes RGPD nécessitent une authentification
rgpdRouter.use(authMiddleware);

// Exporter les données (Article 20 RGPD)
rgpdRouter.get('/:userId/export',
  rgpdController.exportData.bind(rgpdController)
);

// Demander la suppression (Article 17 RGPD)
rgpdRouter.post('/:userId/delete',
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
  rgpdController.anonymize.bind(rgpdController)
);
