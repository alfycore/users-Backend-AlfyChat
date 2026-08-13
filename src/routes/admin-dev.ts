// ==========================================
// ALFYCHAT - ROUTES DEV (admin only)
// Aperçu/envoi de test pour les templates d'email
// ==========================================

import { Router } from 'express';
import { body, param } from 'express-validator';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import { validateRequest } from '../middleware/validate';
import { emailService, EMAIL_PREVIEW_TYPES, type EmailPreviewType } from '../services/email.service';

export const adminDevRouter = Router();

const PREVIEW_TYPE_IDS = EMAIL_PREVIEW_TYPES.map((t) => t.id);

adminDevRouter.use(authMiddleware);
adminDevRouter.use(adminMiddleware);

adminDevRouter.get('/emails/types', (_req, res) => {
  res.json(EMAIL_PREVIEW_TYPES);
});

adminDevRouter.get(
  '/emails/:type/preview',
  param('type').isIn(PREVIEW_TYPE_IDS),
  validateRequest,
  (req, res) => {
    const type = req.params.type as EmailPreviewType;
    const html = emailService.previewHtml(type);
    res.json({ html });
  },
);

adminDevRouter.post(
  '/emails/:type/send',
  param('type').isIn(PREVIEW_TYPE_IDS),
  body('to').isEmail(),
  validateRequest,
  async (req, res) => {
    const type = req.params.type as EmailPreviewType;
    try {
      const ok = await emailService.sendPreviewEmail(type, req.body.to);
      if (!ok) {
        res.status(502).json({ success: false, error: "L'envoi a échoué (voir logs SMTP)" });
        return;
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },
);
