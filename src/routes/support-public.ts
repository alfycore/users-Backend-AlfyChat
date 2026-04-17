// ==========================================
// ALFYCHAT - ROUTES SUPPORT PUBLIQUES
// Lecture seule, pas d'auth requise
// ==========================================

import { Router, Request, Response } from 'express';
import { supportService } from '../services/support.service';
import { logger } from '../utils/logger';

export const publicSupportRouter = Router();

// GET /users/support/categories
publicSupportRouter.get('/categories', async (_req: Request, res: Response) => {
  try {
    const cats = await supportService.getCategories(true);
    res.json({ success: true, data: cats });
  } catch (err) {
    logger.error('support categories error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /users/support/categories/:slug
publicSupportRouter.get('/categories/:slug', async (req: Request, res: Response) => {
  try {
    const cat = await supportService.getCategoryBySlug(req.params.slug);
    if (!cat) { res.status(404).json({ success: false, error: 'Catégorie non trouvée' }); return; }
    const articles = await supportService.getArticles({ categorySlug: req.params.slug, publishedOnly: true });
    res.json({ success: true, data: { ...cat, articles } });
  } catch (err) {
    logger.error('support category slug error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /users/support/articles/popular
publicSupportRouter.get('/articles/popular', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 6, 20);
    const articles = await supportService.getPopularArticles(limit);
    res.json({ success: true, data: articles });
  } catch (err) {
    logger.error('support popular articles error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /users/support/articles/:slug
publicSupportRouter.get('/articles/:slug', async (req: Request, res: Response) => {
  try {
    const article = await supportService.getArticleBySlug(req.params.slug, true);
    if (!article || !article.isPublished) {
      res.status(404).json({ success: false, error: 'Article non trouvé' }); return;
    }
    res.json({ success: true, data: article });
  } catch (err) {
    logger.error('support article slug error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /users/support/announcements
publicSupportRouter.get('/announcements', async (_req: Request, res: Response) => {
  try {
    const items = await supportService.getAnnouncements(true, 10);
    res.json({ success: true, data: items });
  } catch (err) {
    logger.error('support announcements error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// GET /users/support/known-issues
publicSupportRouter.get('/known-issues', async (_req: Request, res: Response) => {
  try {
    const items = await supportService.getKnownIssues();
    res.json({ success: true, data: items });
  } catch (err) {
    logger.error('support known-issues error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});
