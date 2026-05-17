"use strict";
// ==========================================
// ALFYCHAT - ROUTES HELPDESK
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.helpdeskRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const admin_1 = require("../middleware/admin");
const validate_1 = require("../middleware/validate");
const helpdesk_service_1 = require("../services/helpdesk.service");
const logger_1 = require("../utils/logger");
exports.helpdeskRouter = (0, express_1.Router)();
// Toutes les routes helpdesk nécessitent l'authentification + rôle staff
exports.helpdeskRouter.use(auth_1.authMiddleware);
exports.helpdeskRouter.use(admin_1.staffMiddleware);
const VALID_STATUSES = ['open', 'pending', 'in_progress', 'resolved', 'closed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_CATEGORIES = ['general', 'technical', 'billing', 'account', 'abuse', 'feature', 'other'];
// ── Stats globales ─────────────────────────────────────────────────────────
exports.helpdeskRouter.get('/stats', async (req, res) => {
    try {
        const stats = await helpdesk_service_1.helpdeskService.getStats();
        res.json(stats);
    }
    catch (err) {
        logger_1.logger.error('helpdesk stats error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Liste des agents staff ─────────────────────────────────────────────────
exports.helpdeskRouter.get('/agents', async (req, res) => {
    try {
        const agents = await helpdesk_service_1.helpdeskService.getStaffAgents();
        res.json(agents);
    }
    catch (err) {
        logger_1.logger.error('helpdesk agents error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Liste des tickets ──────────────────────────────────────────────────────
exports.helpdeskRouter.get('/tickets', (0, express_validator_1.query)('status').optional().isIn(VALID_STATUSES), (0, express_validator_1.query)('priority').optional().isIn(VALID_PRIORITIES), (0, express_validator_1.query)('category').optional().isIn(VALID_CATEGORIES), (0, express_validator_1.query)('assignedTo').optional().isString(), (0, express_validator_1.query)('search').optional().isString().isLength({ max: 100 }), (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 200 }), (0, express_validator_1.query)('offset').optional().isInt({ min: 0 }), validate_1.validateRequest, async (req, res) => {
    try {
        const { status, priority, category, assignedTo, search, limit, offset } = req.query;
        const tickets = await helpdesk_service_1.helpdeskService.getTickets({
            status, priority, category,
            assignedTo: assignedTo || undefined,
            search: search || undefined,
            limit: limit ? Number(limit) : 50,
            offset: offset ? Number(offset) : 0,
        });
        res.json(tickets);
    }
    catch (err) {
        logger_1.logger.error('helpdesk list error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Créer un ticket (admin/staff peut créer pour un utilisateur) ───────────
exports.helpdeskRouter.post('/tickets', (0, express_validator_1.body)('subject').isString().isLength({ min: 3, max: 255 }), (0, express_validator_1.body)('description').isString().isLength({ min: 10 }), (0, express_validator_1.body)('priority').optional().isIn(VALID_PRIORITIES), (0, express_validator_1.body)('category').optional().isIn(VALID_CATEGORIES), (0, express_validator_1.body)('requesterId').optional().isString(), validate_1.validateRequest, async (req, res) => {
    try {
        const { subject, description, priority, category, requesterId } = req.body;
        const ticket = await helpdesk_service_1.helpdeskService.createTicket({
            subject, description, priority, category,
            requesterId: requesterId || req.userId,
        });
        res.status(201).json(ticket);
    }
    catch (err) {
        logger_1.logger.error('helpdesk create error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Détail d'un ticket ─────────────────────────────────────────────────────
exports.helpdeskRouter.get('/tickets/:id', (0, express_validator_1.param)('id').isUUID(), validate_1.validateRequest, async (req, res) => {
    try {
        const ticket = await helpdesk_service_1.helpdeskService.getTicketById(req.params.id);
        if (!ticket)
            return res.status(404).json({ error: 'Ticket non trouvé' });
        res.json(ticket);
    }
    catch (err) {
        logger_1.logger.error('helpdesk get error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Modifier un ticket ─────────────────────────────────────────────────────
exports.helpdeskRouter.patch('/tickets/:id', (0, express_validator_1.param)('id').isUUID(), (0, express_validator_1.body)('status').optional().isIn(VALID_STATUSES), (0, express_validator_1.body)('priority').optional().isIn(VALID_PRIORITIES), (0, express_validator_1.body)('category').optional().isIn(VALID_CATEGORIES), (0, express_validator_1.body)('assignedTo').optional({ nullable: true }), (0, express_validator_1.body)('subject').optional().isString().isLength({ min: 3, max: 255 }), validate_1.validateRequest, async (req, res) => {
    try {
        const { status, priority, category, assignedTo, subject } = req.body;
        await helpdesk_service_1.helpdeskService.updateTicket(req.params.id, { status, priority, category, assignedTo, subject });
        const updated = await helpdesk_service_1.helpdeskService.getTicketById(req.params.id);
        res.json(updated);
    }
    catch (err) {
        logger_1.logger.error('helpdesk update error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Supprimer un ticket (admin uniquement) ─────────────────────────────────
exports.helpdeskRouter.delete('/tickets/:id', (0, express_validator_1.param)('id').isUUID(), validate_1.validateRequest, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Réservé aux administrateurs' });
        }
        await helpdesk_service_1.helpdeskService.deleteTicket(req.params.id);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('helpdesk delete error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Messages d'un ticket ───────────────────────────────────────────────────
exports.helpdeskRouter.get('/tickets/:id/messages', (0, express_validator_1.param)('id').isUUID(), validate_1.validateRequest, async (req, res) => {
    try {
        const ticket = await helpdesk_service_1.helpdeskService.getTicketById(req.params.id);
        if (!ticket)
            return res.status(404).json({ error: 'Ticket non trouvé' });
        const messages = await helpdesk_service_1.helpdeskService.getMessages(req.params.id);
        res.json(messages);
    }
    catch (err) {
        logger_1.logger.error('helpdesk messages error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// ── Ajouter un message ─────────────────────────────────────────────────────
exports.helpdeskRouter.post('/tickets/:id/messages', (0, express_validator_1.param)('id').isUUID(), (0, express_validator_1.body)('content').isString().isLength({ min: 1, max: 5000 }), (0, express_validator_1.body)('isInternal').optional().isBoolean(), validate_1.validateRequest, async (req, res) => {
    try {
        const ticket = await helpdesk_service_1.helpdeskService.getTicketById(req.params.id);
        if (!ticket)
            return res.status(404).json({ error: 'Ticket non trouvé' });
        const msg = await helpdesk_service_1.helpdeskService.addMessage(req.params.id, req.userId, req.body.content, req.body.isInternal ?? false);
        res.status(201).json(msg);
    }
    catch (err) {
        logger_1.logger.error('helpdesk add message error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
//# sourceMappingURL=helpdesk.js.map