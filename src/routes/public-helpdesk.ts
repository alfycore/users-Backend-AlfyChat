// ==========================================
// ALFYCHAT - ROUTES HELPDESK PUBLIC (utilisateurs)
// ==========================================

import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { helpdeskService, TicketCategory, TicketPriority } from '../services/helpdesk.service';
import { AuthRequest } from '../types/express';
import { logger } from '../utils/logger';
import { emailService } from '../services/email.service';
import { userService } from '../services/users.service';

export const publicHelpdeskRouter = Router();

const VALID_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'critical'];

const CATEGORY_MAP: Record<string, TicketCategory> = {
  general:  'general',
  account:  'account',
  security: 'account',
  billing:  'billing',
  bug:      'technical',
  abuse:    'abuse',
  server:   'technical',
  feature:  'feature',
  other:    'other',
};

// Catégories autorisées sans authentification (email requis)
const GUEST_ALLOWED_CATEGORIES = new Set(['account', 'security']);

// ── POST /helpdesk/public/tickets ─────────────────────────────────────────────
// Auth optionnel : si non connecté, catégorie account/security + email requis
publicHelpdeskRouter.post(
  '/tickets',
  body('subject').isString().trim().isLength({ min: 3, max: 255 }),
  body('description').isString().trim().isLength({ min: 10, max: 4000 }),
  body('priority').optional().isIn(VALID_PRIORITIES),
  body('category').optional().isString(),
  body('email').optional().isEmail().normalizeEmail(),
  validateRequest,
  async (req: Request, res: Response) => {
    // Try to get auth from token (optional)
    let userId: string | null = null;
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = await import('jsonwebtoken');
        const secret = process.env.JWT_SECRET || 'default-secret';
        const decoded = jwt.default.verify(authHeader.slice(7), secret) as { userId?: string; sub?: string };
        userId = decoded.userId || decoded.sub || null;
      } catch { /* token invalide ou absent, on continue */ }
    }

    const { subject, description, priority, category, email } = req.body;
    const internalCategory: TicketCategory = category ? (CATEGORY_MAP[category] ?? 'general') : 'general';
    const internalPriority: TicketPriority = priority && VALID_PRIORITIES.includes(priority) ? priority : 'medium';

    // Si non authentifié, vérifier catégorie + email
    if (!userId) {
      if (!GUEST_ALLOWED_CATEGORIES.has(category ?? '')) {
        res.status(401).json({ success: false, error: 'Connexion requise pour cette catégorie' });
        return;
      }
      if (!email) {
        res.status(400).json({ success: false, error: 'Un email est requis pour les demandes liées à votre compte' });
        return;
      }
    }

    try {
      const ticket = await helpdeskService.createTicket({
        subject, description,
        priority: internalPriority,
        category: internalCategory,
        requesterId: userId,
        requesterEmail: userId ? null : email,
      });
      logger.info(`Public ticket created #${ticket.ticketNumber} by ${userId ?? email}`);

      // Envoyer email de confirmation (best-effort, sans bloquer la réponse)
      const categoryLabels: Record<string, string> = {
        general: 'Question générale', technical: 'Technique', billing: 'Facturation',
        account: 'Compte', abuse: 'Signalement', feature: 'Suggestion', other: 'Autre',
      };
      const categoryLabel = categoryLabels[internalCategory] ?? internalCategory;
      let recipientEmail: string | null = userId ? null : (email ?? null);
      if (userId && !recipientEmail) {
        try {
          const user = await userService.findById(userId);
          recipientEmail = user?.email ?? null;
        } catch { /* ignore */ }
      }
      if (recipientEmail) {
        emailService.sendTicketConfirmation(recipientEmail, ticket.ticketNumber, subject, categoryLabel)
          .catch(err => logger.warn('Ticket confirmation email failed:', err));
      }

      res.status(201).json({ success: true, data: { ticketNumber: ticket.ticketNumber } });
    } catch (err) {
      logger.error('public helpdesk create ticket error:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);

// ── GET /helpdesk/public/tickets ──────────────────────────────────────────────
// Auth requise pour lister ses tickets
publicHelpdeskRouter.get('/tickets', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Non connecté' });
      return;
    }

    const tickets = await helpdeskService.getTickets({
      requesterId: userId,
      limit: 20,
      offset: 0,
      excludeInternalCount: true,
    });

    res.json({ success: true, data: tickets });
  } catch (err) {
    logger.error('public helpdesk list tickets error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ── GET /helpdesk/public/tickets/:number ──────────────────────────────────────
// Voir un ticket spécifique (propriétaire uniquement)
publicHelpdeskRouter.get('/tickets/:number', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ success: false, error: 'Non connecté' }); return; }

    const ticketNumber = parseInt(req.params.number, 10);
    if (isNaN(ticketNumber)) { res.status(400).json({ success: false, error: 'Numéro invalide' }); return; }

    const ticket = await helpdeskService.getTicketByNumber(ticketNumber);
    if (!ticket) { res.status(404).json({ success: false, error: 'Ticket non trouvé' }); return; }
    if (ticket.requesterId !== userId) { res.status(403).json({ success: false, error: 'Accès refusé' }); return; }

    res.json({ success: true, data: ticket });
  } catch (err) {
    logger.error('public helpdesk get ticket error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ── GET /helpdesk/public/tickets/:number/messages ─────────────────────────────
// Messages visibles par l'utilisateur (sans les notes internes)
publicHelpdeskRouter.get('/tickets/:number/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ success: false, error: 'Non connecté' }); return; }

    const ticketNumber = parseInt(req.params.number, 10);
    if (isNaN(ticketNumber)) { res.status(400).json({ success: false, error: 'Numéro invalide' }); return; }

    const ticket = await helpdeskService.getTicketByNumber(ticketNumber);
    if (!ticket) { res.status(404).json({ success: false, error: 'Ticket non trouvé' }); return; }
    if (ticket.requesterId !== userId) { res.status(403).json({ success: false, error: 'Accès refusé' }); return; }

    const messages = await helpdeskService.getMessages(ticket.id, { excludeInternal: true });
    res.json({ success: true, data: messages });
  } catch (err) {
    logger.error('public helpdesk get messages error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ── POST /helpdesk/public/tickets/:number/messages ────────────────────────────
// Répondre à son propre ticket (rouvre automatiquement si résolu)
publicHelpdeskRouter.post('/tickets/:number/messages', authMiddleware,
  body('content').isString().trim().isLength({ min: 1, max: 5000 }),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) { res.status(401).json({ success: false, error: 'Non connecté' }); return; }

      const ticketNumber = parseInt(req.params.number, 10);
      if (isNaN(ticketNumber)) { res.status(400).json({ success: false, error: 'Numéro invalide' }); return; }

      const ticket = await helpdeskService.getTicketByNumber(ticketNumber);
      if (!ticket) { res.status(404).json({ success: false, error: 'Ticket non trouvé' }); return; }
      if (ticket.requesterId !== userId) { res.status(403).json({ success: false, error: 'Accès refusé' }); return; }
      if (ticket.status === 'closed') {
        res.status(400).json({ success: false, error: 'Ce ticket est fermé. Ouvrez un nouveau ticket.' });
        return;
      }

      const msg = await helpdeskService.addMessage(ticket.id, userId, req.body.content, false);

      // Si le ticket était résolu, le rouvrir
      if (ticket.status === 'resolved') {
        await helpdeskService.updateTicket(ticket.id, { status: 'open' });
      }

      res.status(201).json({ success: true, data: msg });
    } catch (err) {
      logger.error('public helpdesk add message error:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);
