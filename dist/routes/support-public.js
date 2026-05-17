"use strict";
// ==========================================
// ALFYCHAT - ROUTES SUPPORT PUBLIQUES
// Lecture seule, pas d'auth requise
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicSupportRouter = void 0;
const express_1 = require("express");
const support_service_1 = require("../services/support.service");
const logger_1 = require("../utils/logger");
exports.publicSupportRouter = (0, express_1.Router)();
// GET /users/support/categories
exports.publicSupportRouter.get('/categories', async (_req, res) => {
    try {
        const cats = await support_service_1.supportService.getCategories(true);
        res.json({ success: true, data: cats });
    }
    catch (err) {
        logger_1.logger.error('support categories error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// GET /users/support/categories/:slug
exports.publicSupportRouter.get('/categories/:slug', async (req, res) => {
    try {
        const cat = await support_service_1.supportService.getCategoryBySlug(req.params.slug);
        if (!cat) {
            res.status(404).json({ success: false, error: 'Catégorie non trouvée' });
            return;
        }
        const articles = await support_service_1.supportService.getArticles({ categorySlug: req.params.slug, publishedOnly: true });
        res.json({ success: true, data: { ...cat, articles } });
    }
    catch (err) {
        logger_1.logger.error('support category slug error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// GET /users/support/articles/popular
exports.publicSupportRouter.get('/articles/popular', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 6, 20);
        const articles = await support_service_1.supportService.getPopularArticles(limit);
        res.json({ success: true, data: articles });
    }
    catch (err) {
        logger_1.logger.error('support popular articles error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// GET /users/support/articles/:slug
exports.publicSupportRouter.get('/articles/:slug', async (req, res) => {
    try {
        const article = await support_service_1.supportService.getArticleBySlug(req.params.slug, true);
        if (!article || !article.isPublished) {
            res.status(404).json({ success: false, error: 'Article non trouvé' });
            return;
        }
        res.json({ success: true, data: article });
    }
    catch (err) {
        logger_1.logger.error('support article slug error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// GET /users/support/announcements
exports.publicSupportRouter.get('/announcements', async (_req, res) => {
    try {
        const items = await support_service_1.supportService.getAnnouncements(true, 10);
        res.json({ success: true, data: items });
    }
    catch (err) {
        logger_1.logger.error('support announcements error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
// GET /users/support/known-issues
exports.publicSupportRouter.get('/known-issues', async (_req, res) => {
    try {
        const items = await support_service_1.supportService.getKnownIssues();
        res.json({ success: true, data: items });
    }
    catch (err) {
        logger_1.logger.error('support known-issues error:', err);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});
//# sourceMappingURL=support-public.js.map