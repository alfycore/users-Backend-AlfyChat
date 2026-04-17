// ==========================================
// ALFYCHAT - ROUTES ADMIN CENTRE D'AIDE
// CRUD complet, auth admin requis
// ==========================================

import { Router, Response } from 'express';
import { body, param } from 'express-validator';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import { validateRequest } from '../middleware/validate';
import { supportService } from '../services/support.service';
import { AuthRequest } from '../types/express';
import { logger } from '../utils/logger';

export const adminSupportRouter = Router();
adminSupportRouter.use(authMiddleware);
adminSupportRouter.use(adminMiddleware);

// ── Catégories ─────────────────────────────────────────────────────────────

adminSupportRouter.get('/categories', async (_req: AuthRequest, res: Response) => {
  try {
    const cats = await supportService.getCategories(false);
    res.json({ success: true, data: cats });
  } catch (err) {
    logger.error('admin support categories:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

adminSupportRouter.post('/categories',
  body('slug').isString().trim().isLength({ min: 1, max: 100 }),
  body('title').isString().trim().isLength({ min: 1, max: 255 }),
  body('description').optional().isString(),
  body('iconName').optional().isString(),
  body('color').optional().isString().matches(/^#[0-9a-fA-F]{6}$/),
  body('sortOrder').optional().isInt({ min: 0 }),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const cat = await supportService.createCategory(req.body);
      res.status(201).json({ success: true, data: cat });
    } catch (err) {
      logger.error('admin support create category:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);

adminSupportRouter.patch('/categories/:id',
  param('id').isString(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      await supportService.updateCategory(req.params.id, req.body);
      res.json({ success: true });
    } catch (err) {
      logger.error('admin support update category:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);

adminSupportRouter.delete('/categories/:id', async (req: AuthRequest, res: Response) => {
  try {
    await supportService.deleteCategory(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('admin support delete category:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ── Articles ───────────────────────────────────────────────────────────────

adminSupportRouter.get('/articles', async (req: AuthRequest, res: Response) => {
  try {
    const articles = await supportService.getArticles({
      categoryId: req.query.categoryId as string | undefined,
      search: req.query.search as string | undefined,
      publishedOnly: false,
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
    });
    res.json({ success: true, data: articles });
  } catch (err) {
    logger.error('admin support articles:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

adminSupportRouter.post('/articles',
  body('slug').isString().trim().isLength({ min: 1, max: 255 }),
  body('title').isString().trim().isLength({ min: 1, max: 255 }),
  body('summary').optional().isString(),
  body('content').optional().isString(),
  body('categoryId').optional().isString(),
  body('tags').optional().isArray(),
  body('isPinned').optional().isBoolean(),
  body('sortOrder').optional().isInt({ min: 0 }),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const article = await supportService.createArticle({ ...req.body, authorId: req.userId });
      res.status(201).json({ success: true, data: article });
    } catch (err) {
      logger.error('admin support create article:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);

adminSupportRouter.patch('/articles/:id',
  param('id').isString(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      await supportService.updateArticle(req.params.id, req.body);
      res.json({ success: true });
    } catch (err) {
      logger.error('admin support update article:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);

adminSupportRouter.delete('/articles/:id', async (req: AuthRequest, res: Response) => {
  try {
    await supportService.deleteArticle(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('admin support delete article:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ── Annonces ──────────────────────────────────────────────────────────────

adminSupportRouter.get('/announcements', async (_req: AuthRequest, res: Response) => {
  try {
    const items = await supportService.getAnnouncements(false, 50);
    res.json({ success: true, data: items });
  } catch (err) {
    logger.error('admin support announcements:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

adminSupportRouter.post('/announcements',
  body('type').isIn(['incident', 'maintenance', 'news']),
  body('title').isString().trim().isLength({ min: 1, max: 255 }),
  body('summary').optional().isString(),
  body('content').optional().isString(),
  body('isResolved').optional().isBoolean(),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const item = await supportService.createAnnouncement(req.body);
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      logger.error('admin support create announcement:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);

adminSupportRouter.patch('/announcements/:id', async (req: AuthRequest, res: Response) => {
  try {
    await supportService.updateAnnouncement(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    logger.error('admin support update announcement:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

adminSupportRouter.delete('/announcements/:id', async (req: AuthRequest, res: Response) => {
  try {
    await supportService.deleteAnnouncement(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('admin support delete announcement:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ── Problèmes connus ──────────────────────────────────────────────────────

adminSupportRouter.get('/known-issues', async (_req: AuthRequest, res: Response) => {
  try {
    const items = await supportService.getKnownIssues();
    res.json({ success: true, data: items });
  } catch (err) {
    logger.error('admin support known-issues:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

adminSupportRouter.post('/known-issues',
  body('title').isString().trim().isLength({ min: 1, max: 255 }),
  body('description').optional().isString(),
  body('status').optional().isIn(['investigating', 'in_progress', 'resolved']),
  body('categoryLabel').optional().isString().isLength({ max: 100 }),
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const item = await supportService.createKnownIssue(req.body);
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      logger.error('admin support create known-issue:', err);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  }
);

adminSupportRouter.patch('/known-issues/:id', async (req: AuthRequest, res: Response) => {
  try {
    await supportService.updateKnownIssue(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    logger.error('admin support update known-issue:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

adminSupportRouter.delete('/known-issues/:id', async (req: AuthRequest, res: Response) => {
  try {
    await supportService.deleteKnownIssue(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('admin support delete known-issue:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});
