"use strict";
// ==========================================
// ALFYCHAT - ROUTES HELPDESK PUBLIC (utilisateurs)
// ==========================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicHelpdeskRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const helpdesk_service_1 = require("../services/helpdesk.service");
const logger_1 = require("../utils/logger");
const email_service_1 = require("../services/email.service");
const users_service_1 = require("../services/users.service");
exports.publicHelpdeskRouter = (0, express_1.Router)();
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const CATEGORY_MAP = {
    general: 'general',
    account: 'account',
    security: 'account',
    billing: 'billing',
    bug: 'technical',
    abuse: 'abuse',
    server: 'technical',
    feature: 'feature',
    other: 'other',
};
// Catégories autorisées sans authentification (email requis)
const GUEST_ALLOWED_CATEGORIES = new Set(['account', 'security']);
// ── POST /helpdesk/public/tickets ─────────────────────────────────────────────
// Auth optionnel : si non connecté, catégorie account/security + email requis
exports.publicHelpdeskRouter.post('/tickets', (0, express_validator_1.body)('subject').isString().trim().isLength({ min: 3, max: 255 }), (0, express_validator_1.body)('description').isString().trim().isLength({ min: 10, max: 4000 }), (0, express_validator_1.body)('priority').optional().isIn(VALID_PRIORITIES), (0, express_validator_1.body)('category').optional().isString(), (0, express_validator_1.body)('email').optional().isEmail().normalizeEmail(), validate_1.validateRequest, async (req, res) => {
    // Try to get auth from token (optional)
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
        try {
            const jwt = await Promise.resolve().then(() => __importStar(require('jsonwebtoken')));
            const secret = process.env.JWT_SECRET || 'default-secret';
            const decoded = jwt.default.verify(authHeader.slice(7), secret);
            userId = decoded.userId || decoded.sub || null;
        }
        catch { /* token invalide ou absent, on continue */ }
    }
    const { subject, description, priority, category, email } = req.body;
    const internalCategory = category ? (CATEGORY_MAP[category] ?? 'general') : 'general';
    const internalPriority = priority && VALID_PRIORITIES.includes(priority) ? priority : 'medium';
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
        const ticket = await helpdesk_service_1.helpdeskService.createTicket({
            subject, description,
            priority: internalPriority,
            category: internalCategory,
            requesterId: userId,
            requesterEmail: userId ? null : email,
        });
        logger_1.logger.info(`Public ticket created #${ticket.ticketNumber} by ${userId ?? email}`);
        // Envoyer email de confirmation (best-effort, sans bloquer la réponse)
        const categoryLabels = {
            general: 'Question générale', technical: 'Technique', billing: 'Facturation',
            account: 'Compte', abuse: 'Signalement', feature: 'Suggestion', other: 'Autre',
        };
        const categoryLabel = categoryLabels[internalCategory] ?? internalCategory;
        let recipientEmail = userId ? null : (email ?? null);
        if (userId && !recipientEmail) {
            try {
                const user = await users_service_1.userService.findById(userId);
                recipientEmail = user?.email ?? null;
            }
            catch { /* ignore */ }
        }
        if (recipientEmail) {
            email_service_1.emailService.sendTicketConfirmation(recipientEmail, ticket.ticketNumber, subject, categoryLabel)
                .catch(err => logger_1.logger.warn('Ticket confirmation email failed:', err));
        }
        res.status(201).json({ success: true, data: { ticketNumber: ticket.ticketNumber } });
    }
    catch (err) {
        logger_1.logger.error('public helpdesk create ticket error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// ── GET /helpdesk/public/tickets ──────────────────────────────────────────────
// Auth requise pour lister ses tickets
exports.publicHelpdeskRouter.get('/tickets', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Non connecté' });
            return;
        }
        const tickets = await helpdesk_service_1.helpdeskService.getTickets({
            requesterId: userId,
            limit: 20,
            offset: 0,
            excludeInternalCount: true,
        });
        res.json({ success: true, data: tickets });
    }
    catch (err) {
        logger_1.logger.error('public helpdesk list tickets error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// ── GET /helpdesk/public/tickets/:number ──────────────────────────────────────
// Voir un ticket spécifique (propriétaire uniquement)
exports.publicHelpdeskRouter.get('/tickets/:number', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Non connecté' });
            return;
        }
        const ticketNumber = parseInt(req.params.number, 10);
        if (isNaN(ticketNumber)) {
            res.status(400).json({ success: false, error: 'Numéro invalide' });
            return;
        }
        const ticket = await helpdesk_service_1.helpdeskService.getTicketByNumber(ticketNumber);
        if (!ticket) {
            res.status(404).json({ success: false, error: 'Ticket non trouvé' });
            return;
        }
        if (ticket.requesterId !== userId) {
            res.status(403).json({ success: false, error: 'Accès refusé' });
            return;
        }
        res.json({ success: true, data: ticket });
    }
    catch (err) {
        logger_1.logger.error('public helpdesk get ticket error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// ── GET /helpdesk/public/tickets/:number/messages ─────────────────────────────
// Messages visibles par l'utilisateur (sans les notes internes)
exports.publicHelpdeskRouter.get('/tickets/:number/messages', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Non connecté' });
            return;
        }
        const ticketNumber = parseInt(req.params.number, 10);
        if (isNaN(ticketNumber)) {
            res.status(400).json({ success: false, error: 'Numéro invalide' });
            return;
        }
        const ticket = await helpdesk_service_1.helpdeskService.getTicketByNumber(ticketNumber);
        if (!ticket) {
            res.status(404).json({ success: false, error: 'Ticket non trouvé' });
            return;
        }
        if (ticket.requesterId !== userId) {
            res.status(403).json({ success: false, error: 'Accès refusé' });
            return;
        }
        const messages = await helpdesk_service_1.helpdeskService.getMessages(ticket.id, { excludeInternal: true });
        res.json({ success: true, data: messages });
    }
    catch (err) {
        logger_1.logger.error('public helpdesk get messages error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// ── POST /helpdesk/public/tickets/:number/messages ────────────────────────────
// Répondre à son propre ticket (rouvre automatiquement si résolu)
exports.publicHelpdeskRouter.post('/tickets/:number/messages', auth_1.authMiddleware, (0, express_validator_1.body)('content').isString().trim().isLength({ min: 1, max: 5000 }), validate_1.validateRequest, async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ success: false, error: 'Non connecté' });
            return;
        }
        const ticketNumber = parseInt(req.params.number, 10);
        if (isNaN(ticketNumber)) {
            res.status(400).json({ success: false, error: 'Numéro invalide' });
            return;
        }
        const ticket = await helpdesk_service_1.helpdeskService.getTicketByNumber(ticketNumber);
        if (!ticket) {
            res.status(404).json({ success: false, error: 'Ticket non trouvé' });
            return;
        }
        if (ticket.requesterId !== userId) {
            res.status(403).json({ success: false, error: 'Accès refusé' });
            return;
        }
        if (ticket.status === 'closed') {
            res.status(400).json({ success: false, error: 'Ce ticket est fermé. Ouvrez un nouveau ticket.' });
            return;
        }
        const msg = await helpdesk_service_1.helpdeskService.addMessage(ticket.id, userId, req.body.content, false);
        // Si le ticket était résolu, le rouvrir
        if (ticket.status === 'resolved') {
            await helpdesk_service_1.helpdeskService.updateTicket(ticket.id, { status: 'open' });
        }
        res.status(201).json({ success: true, data: msg });
    }
    catch (err) {
        logger_1.logger.error('public helpdesk add message error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
//# sourceMappingURL=public-helpdesk.js.map