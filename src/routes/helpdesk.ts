// ==========================================
// ALFYCHAT - ROUTES HELPDESK
// ==========================================

import { Router, Response } from 'express';
import { body, query, param } from 'express-validator';
import { authMiddleware } from '../middleware/auth';
import { staffMiddleware } from '../middleware/admin';
import { validateRequest } from '../middleware/validate';
import { helpdeskService, TicketStatus, TicketPriority, TicketCategory } from '../services/helpdesk.service';
import { AuthRequest } from '../types/express';
import { logger } from '../utils/logger';

export const helpdeskRouter = Router();

// Toutes les routes helpdesk nécessitent l'authentification + rôle staff
helpdeskRouter.use(authMiddleware);
helpdeskRouter.use(staffMiddleware);

const VALID_STATUSES: TicketStatus[] = ['open', 'pending', 'in_progress', 'resolved', 'closed'];
const VALID_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'critical'];
const VALID_CATEGORIES: TicketCategory[] = ['general', 'technical', 'billing', 'account', 'abuse', 'feature', 'other'];

// ── Stats globales ─────────────────────────────────────────────────────────
helpdeskRouter.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const stats = await helpdeskService.getStats();
    res.json(stats);
  } catch (err) {
    logger.error('helpdesk stats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Liste des agents staff ─────────────────────────────────────────────────
helpdeskRouter.get('/agents', async (req: AuthRequest, res: Response) => {
  try {
    const agents = await helpdeskService.getStaffAgents();
    res.json(agents);
  } catch (err) {
    logger.error('helpdesk agents error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Liste des tickets ──────────────────────────────────────────────────────
helpdeskRouter.get('/tickets',
  query('status').optional().isIn(VALID_STATUSES),
  query('priority').optional().isIn(VALID_PRIORITIES),
  query('category').optional().isIn(VALID_CATEGORIES),
  query('assignedTo').optional().isString(),
  query('search').optional().isString().isLength({ max: 100 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, priority, category, assignedTo, search, limit, offset } = req.query as any;
      const tickets = await helpdeskService.getTickets({
        status, priority, category,
        assignedTo: assignedTo || undefined,
        search: search || undefined,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      res.json(tickets);
    } catch (err) {
      logger.error('helpdesk list error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── Créer un ticket (admin/staff peut créer pour un utilisateur) ───────────
helpdeskRouter.post('/tickets',
  body('subject').isString().isLength({ min: 3, max: 255 }),
  body('description').isString().isLength({ min: 10 }),
  body('priority').optional().isIn(VALID_PRIORITIES),
  body('category').optional().isIn(VALID_CATEGORIES),
  body('requesterId').optional().isString(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const { subject, description, priority, category, requesterId } = req.body;
      const ticket = await helpdeskService.createTicket({
        subject, description, priority, category,
        requesterId: requesterId || req.userId!,
      });
      res.status(201).json(ticket);
    } catch (err) {
      logger.error('helpdesk create error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── Détail d'un ticket ─────────────────────────────────────────────────────
helpdeskRouter.get('/tickets/:id',
  param('id').isUUID(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const ticket = await helpdeskService.getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });
      res.json(ticket);
    } catch (err) {
      logger.error('helpdesk get error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── Modifier un ticket ─────────────────────────────────────────────────────
helpdeskRouter.patch('/tickets/:id',
  param('id').isUUID(),
  body('status').optional().isIn(VALID_STATUSES),
  body('priority').optional().isIn(VALID_PRIORITIES),
  body('category').optional().isIn(VALID_CATEGORIES),
  body('assignedTo').optional({ nullable: true }),
  body('subject').optional().isString().isLength({ min: 3, max: 255 }),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, priority, category, assignedTo, subject } = req.body;
      await helpdeskService.updateTicket(req.params.id, { status, priority, category, assignedTo, subject });
      const updated = await helpdeskService.getTicketById(req.params.id);
      res.json(updated);
    } catch (err) {
      logger.error('helpdesk update error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── Supprimer un ticket (admin uniquement) ─────────────────────────────────
helpdeskRouter.delete('/tickets/:id',
  param('id').isUUID(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Réservé aux administrateurs' });
      }
      await helpdeskService.deleteTicket(req.params.id);
      res.json({ success: true });
    } catch (err) {
      logger.error('helpdesk delete error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── Messages d'un ticket ───────────────────────────────────────────────────
helpdeskRouter.get('/tickets/:id/messages',
  param('id').isUUID(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const ticket = await helpdeskService.getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });
      const messages = await helpdeskService.getMessages(req.params.id);
      res.json(messages);
    } catch (err) {
      logger.error('helpdesk messages error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// ── Ajouter un message ─────────────────────────────────────────────────────
helpdeskRouter.post('/tickets/:id/messages',
  param('id').isUUID(),
  body('content').isString().isLength({ min: 1, max: 5000 }),
  body('isInternal').optional().isBoolean(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const ticket = await helpdeskService.getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket non trouvé' });
      const msg = await helpdeskService.addMessage(
        req.params.id, req.userId!, req.body.content, req.body.isInternal ?? false
      );
      res.status(201).json(msg);
    } catch (err) {
      logger.error('helpdesk add message error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);
