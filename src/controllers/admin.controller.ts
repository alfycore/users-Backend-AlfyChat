// ==========================================
// ALFYCHAT - CONTRÔLEUR ADMIN
// ==========================================

import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { adminService, CreateBadgeData } from '../services/admin.service';
import { userService } from '../services/users.service';
import { logger } from '../utils/logger';

export class AdminController {
  // ============ BADGES PERSONNALISÉS ============

  async getAllBadges(req: AuthRequest, res: Response) {
    try {
      const badges = await adminService.getAllCustomBadges();
      res.json(badges);
    } catch (error) {
      logger.error('Erreur récupération badges:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async createBadge(req: AuthRequest, res: Response) {
    try {
      const data: CreateBadgeData = req.body;
      
      if (!data.name || !data.iconType || !data.iconValue || !data.color) {
        return res.status(400).json({ error: 'Données manquantes' });
      }

      const badge = await adminService.createCustomBadge(data, req.userId!);
      logger.info(`Badge créé: ${badge.name} par ${req.userId}`);
      
      res.json(badge);
    } catch (error) {
      logger.error('Erreur création badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async updateBadge(req: AuthRequest, res: Response) {
    try {
      const { badgeId } = req.params;
      const data: Partial<CreateBadgeData> = req.body;

      await adminService.updateCustomBadge(badgeId, data);
      logger.info(`Badge mis à jour: ${badgeId} par ${req.userId}`);
      
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async toggleBadgeStatus(req: AuthRequest, res: Response) {
    try {
      const { badgeId } = req.params;
      const { isActive } = req.body;

      await adminService.toggleBadgeStatus(badgeId, isActive);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur toggle badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async deleteBadge(req: AuthRequest, res: Response) {
    try {
      const { badgeId } = req.params;

      await adminService.deleteCustomBadge(badgeId);
      logger.info(`Badge supprimé: ${badgeId} par ${req.userId}`);
      
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur suppression badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ============ ATTRIBUTION DE BADGES ============

  async assignBadgeToUser(req: AuthRequest, res: Response) {
    try {
      const { userId, badgeId } = req.params;

      await adminService.assignBadgeToUser(userId, badgeId);
      logger.info(`Badge ${badgeId} attribué à ${userId} par ${req.userId}`);
      
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur attribution badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async removeBadgeFromUser(req: AuthRequest, res: Response) {
    try {
      const { userId, badgeId } = req.params;

      await adminService.removeBadgeFromUser(userId, badgeId);
      logger.info(`Badge ${badgeId} retiré de ${userId} par ${req.userId}`);
      
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur retrait badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ============ GESTION DES UTILISATEURS ============

  async getAllUsers(req: AuthRequest, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;

      const users = await adminService.getAllUsers(limit, offset);
      res.json(users);
    } catch (error) {
      logger.error('Erreur récupération utilisateurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async searchUsers(req: AuthRequest, res: Response) {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: 'Requête de recherche requise' });
      }

      const users = await adminService.searchUsers(q);
      res.json(users);
    } catch (error) {
      logger.error('Erreur recherche utilisateurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async updateUserRole(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (!['user', 'moderator', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide' });
      }

      await adminService.updateUserRole(userId, role);
      logger.info(`Rôle ${role} attribué à ${userId} par ${req.userId}`);
      
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour rôle:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async getStats(req: AuthRequest, res: Response) {
    try {
      const stats = await adminService.getUserStats();
      res.json(stats);
    } catch (error) {
      logger.error('Erreur récupération stats:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ============ PARAMÈTRES DU SITE ============

  async getSiteSettings(req: AuthRequest, res: Response) {
    try {
      const settings = await adminService.getSiteSettings();
      res.json(settings);
    } catch (error) {
      logger.error('Erreur récupération paramètres:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async updateSiteSetting(req: AuthRequest, res: Response) {
    try {
      const { key, value } = req.body;
      const allowedKeys = ['registration_enabled', 'turnstile_enabled', 'turnstile_site_key'];
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ error: 'Paramètre non autorisé' });
      }
      await adminService.updateSiteSetting(key, value);
      logger.info(`Paramètre ${key} = ${value} mis à jour par ${req.userId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour paramètre:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ============ LIENS D'INSCRIPTION ============

  async createInviteLink(req: AuthRequest, res: Response) {
    try {
      const { email, expiresInHours } = req.body;
      const link = await adminService.createInviteLink(email, req.userId!, expiresInHours);
      logger.info(`Lien d'invitation créé pour ${email} par ${req.userId}`);
      res.json(link);
    } catch (error) {
      logger.error('Erreur création lien invitation:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async getInviteLinks(req: AuthRequest, res: Response) {
    try {
      const links = await adminService.getInviteLinks();
      res.json(links);
    } catch (error) {
      logger.error('Erreur récupération liens invitation:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async deleteInviteLink(req: AuthRequest, res: Response) {
    try {
      const { linkId } = req.params;
      await adminService.deleteInviteLink(linkId);
      logger.info(`Lien d'invitation ${linkId} supprimé par ${req.userId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur suppression lien invitation:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const adminController = new AdminController();
