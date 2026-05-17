"use strict";
// ==========================================
// ALFYCHAT - ROUTES ADMIN CENTRE D'AIDE
// CRUD complet, auth admin requis
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminSupportRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const admin_1 = require("../middleware/admin");
const validate_1 = require("../middleware/validate");
const support_service_1 = require("../services/support.service");
const logger_1 = require("../utils/logger");
exports.adminSupportRouter = (0, express_1.Router)();
exports.adminSupportRouter.use(auth_1.authMiddleware);
exports.adminSupportRouter.use(admin_1.adminMiddleware);
// ── Catégories ─────────────────────────────────────────────────────────────
exports.adminSupportRouter.get('/categories', async (_req, res) => {
    try {
        const cats = await support_service_1.supportService.getCategories(false);
        res.json({ success: true, data: cats });
    }
    catch (err) {
        logger_1.logger.error('admin support categories:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.post('/categories', (0, express_validator_1.body)('slug').isString().trim().isLength({ min: 1, max: 100 }), (0, express_validator_1.body)('title').isString().trim().isLength({ min: 1, max: 255 }), (0, express_validator_1.body)('description').optional().isString(), (0, express_validator_1.body)('iconName').optional().isString(), (0, express_validator_1.body)('color').optional().isString().matches(/^#[0-9a-fA-F]{6}$/), (0, express_validator_1.body)('sortOrder').optional().isInt({ min: 0 }), validate_1.validateRequest, async (req, res) => {
    try {
        const cat = await support_service_1.supportService.createCategory(req.body);
        res.status(201).json({ success: true, data: cat });
    }
    catch (err) {
        logger_1.logger.error('admin support create category:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.patch('/categories/:id', (0, express_validator_1.param)('id').isString(), validate_1.validateRequest, async (req, res) => {
    try {
        await support_service_1.supportService.updateCategory(req.params.id, req.body);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support update category:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.delete('/categories/:id', async (req, res) => {
    try {
        await support_service_1.supportService.deleteCategory(req.params.id);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support delete category:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// ── Articles ───────────────────────────────────────────────────────────────
exports.adminSupportRouter.get('/articles', async (req, res) => {
    try {
        const articles = await support_service_1.supportService.getArticles({
            categoryId: req.query.categoryId,
            search: req.query.search,
            publishedOnly: false,
            limit: Number(req.query.limit) || 100,
            offset: Number(req.query.offset) || 0,
        });
        res.json({ success: true, data: articles });
    }
    catch (err) {
        logger_1.logger.error('admin support articles:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.post('/articles', (0, express_validator_1.body)('slug').isString().trim().isLength({ min: 1, max: 255 }), (0, express_validator_1.body)('title').isString().trim().isLength({ min: 1, max: 255 }), (0, express_validator_1.body)('summary').optional().isString(), (0, express_validator_1.body)('content').optional().isString(), (0, express_validator_1.body)('categoryId').optional().isString(), (0, express_validator_1.body)('tags').optional().isArray(), (0, express_validator_1.body)('isPinned').optional().isBoolean(), (0, express_validator_1.body)('sortOrder').optional().isInt({ min: 0 }), validate_1.validateRequest, async (req, res) => {
    try {
        const article = await support_service_1.supportService.createArticle({ ...req.body, authorId: req.userId });
        res.status(201).json({ success: true, data: article });
    }
    catch (err) {
        logger_1.logger.error('admin support create article:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.patch('/articles/:id', (0, express_validator_1.param)('id').isString(), validate_1.validateRequest, async (req, res) => {
    try {
        await support_service_1.supportService.updateArticle(req.params.id, req.body);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support update article:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.delete('/articles/:id', async (req, res) => {
    try {
        await support_service_1.supportService.deleteArticle(req.params.id);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support delete article:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// ── Annonces ──────────────────────────────────────────────────────────────
exports.adminSupportRouter.get('/announcements', async (_req, res) => {
    try {
        const items = await support_service_1.supportService.getAnnouncements(false, 50);
        res.json({ success: true, data: items });
    }
    catch (err) {
        logger_1.logger.error('admin support announcements:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.post('/announcements', (0, express_validator_1.body)('type').isIn(['incident', 'maintenance', 'news']), (0, express_validator_1.body)('title').isString().trim().isLength({ min: 1, max: 255 }), (0, express_validator_1.body)('summary').optional().isString(), (0, express_validator_1.body)('content').optional().isString(), (0, express_validator_1.body)('isResolved').optional().isBoolean(), validate_1.validateRequest, async (req, res) => {
    try {
        const item = await support_service_1.supportService.createAnnouncement(req.body);
        res.status(201).json({ success: true, data: item });
    }
    catch (err) {
        logger_1.logger.error('admin support create announcement:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.patch('/announcements/:id', async (req, res) => {
    try {
        await support_service_1.supportService.updateAnnouncement(req.params.id, req.body);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support update announcement:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.delete('/announcements/:id', async (req, res) => {
    try {
        await support_service_1.supportService.deleteAnnouncement(req.params.id);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support delete announcement:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// ── Problèmes connus ──────────────────────────────────────────────────────
exports.adminSupportRouter.get('/known-issues', async (_req, res) => {
    try {
        const items = await support_service_1.supportService.getKnownIssues();
        res.json({ success: true, data: items });
    }
    catch (err) {
        logger_1.logger.error('admin support known-issues:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.post('/known-issues', (0, express_validator_1.body)('title').isString().trim().isLength({ min: 1, max: 255 }), (0, express_validator_1.body)('description').optional().isString(), (0, express_validator_1.body)('status').optional().isIn(['investigating', 'in_progress', 'resolved']), (0, express_validator_1.body)('categoryLabel').optional().isString().isLength({ max: 100 }), validate_1.validateRequest, async (req, res) => {
    try {
        const item = await support_service_1.supportService.createKnownIssue(req.body);
        res.status(201).json({ success: true, data: item });
    }
    catch (err) {
        logger_1.logger.error('admin support create known-issue:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.patch('/known-issues/:id', async (req, res) => {
    try {
        await support_service_1.supportService.updateKnownIssue(req.params.id, req.body);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support update known-issue:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
exports.adminSupportRouter.delete('/known-issues/:id', async (req, res) => {
    try {
        await support_service_1.supportService.deleteKnownIssue(req.params.id);
        res.json({ success: true });
    }
    catch (err) {
        logger_1.logger.error('admin support delete known-issue:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
//# sourceMappingURL=admin-support.js.map