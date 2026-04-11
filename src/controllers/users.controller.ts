// ==========================================
// ALFYCHAT - CONTRÔLEUR UTILISATEURS
// ==========================================

import { Request, Response } from 'express';
import { UserService } from '../services/users.service';
import { logger } from '../utils/logger';
import { AuthRequest } from '../types/express';
import { BadgeType } from '../types/badges';
import { getDatabaseClient } from '../database';

const userService = new UserService();

export class UserController {
  // Récupérer la clé publique E2EE d'un utilisateur
  async getPublicKey(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const db = getDatabaseClient();
      const [rows] = await db.query(
        'SELECT public_key FROM users WHERE id = ?',
        [userId]
      );
      const users = rows as any[];
      if (users.length === 0 || !users[0].public_key) {
        return res.status(404).json({ error: 'Clé publique introuvable' });
      }
      res.json({ publicKey: users[0].public_key });
    } catch (error) {
      logger.error('Erreur récupération clé publique:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer un utilisateur par ID
  async getUser(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const user = await userService.findById(userId);

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      res.json(user);
    } catch (error) {
      logger.error('Erreur récupération utilisateur:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer plusieurs utilisateurs
  async getUsers(req: Request, res: Response) {
    try {
      const { ids } = req.query;
      
      if (!ids || typeof ids !== 'string') {
        return res.status(400).json({ error: 'IDs requis' });
      }

      const userIds = ids.split(',');
      const users = await userService.findByIds(userIds);

      res.json(users);
    } catch (error) {
      logger.error('Erreur récupération utilisateurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Rechercher des utilisateurs
  async searchUsers(req: Request, res: Response) {
    try {
      const { q, limit = '20' } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: 'Requête de recherche requise' });
      }

      const users = await userService.search(q, parseInt(limit as string));
      res.json(users);
    } catch (error) {
      logger.error('Erreur recherche utilisateurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour le profil
  async updateProfile(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      // Vérifier que l'utilisateur modifie son propre profil
      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const { displayName, avatarUrl, bannerUrl, bio, cardColor, showBadges, hiddenBadgeIds, tutorialCompleted } = req.body;
      await userService.updateProfile(userId, { 
        displayName, 
        avatarUrl, 
        bannerUrl, 
        bio, 
        cardColor, 
        showBadges,
        hiddenBadgeIds,
        tutorialCompleted,
      });

      const updatedUser = await userService.findById(userId);
      res.json({ success: true, data: updatedUser });
    } catch (error) {
      logger.error('Erreur mise à jour profil:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour le statut
  async updateStatus(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      // Vérifier que l'utilisateur modifie son propre statut
      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const { status, customStatus } = req.body;

      await userService.updateStatus(userId, status, customStatus);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour statut:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour le statut personnalisé
  async updateCustomStatus(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { customStatus } = req.body;

      await userService.updateCustomStatus(userId, customStatus ?? null);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour statut personnalisé:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour last seen
  async updateLastSeen(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      await userService.updateLastSeen(userId);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour last seen:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer les préférences
  async getPreferences(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const prefs = await userService.getPreferences(userId);

      if (!prefs) {
        return res.status(404).json({ error: 'Préférences non trouvées' });
      }

      res.json(prefs);
    } catch (error) {
      logger.error('Erreur récupération préférences:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour les préférences
  async updatePreferences(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      await userService.updatePreferences(userId, req.body);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour préférences:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Changer le mot de passe
  async changePassword(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const { currentPassword, newPassword, encryptedPrivateKey, keySalt } = req.body;
      const result = await userService.changePassword(userId, currentPassword, newPassword, encryptedPrivateKey, keySalt);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur changement mot de passe:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Vérifier la disponibilité d'un nom d'utilisateur
  async checkUsernameAvailable(req: Request, res: Response) {
    try {
      const { username } = req.params;
      const available = await userService.checkUsernameAvailable(username);
      res.json({ available });
    } catch (error) {
      logger.error('Erreur vérification username:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Changer le nom d'utilisateur
  async changeUsername(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const { newUsername, password } = req.body;
      const result = await userService.changeUsername(userId, newUsername, password);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      const updatedUser = await userService.findById(userId);
      res.json({ success: true, data: updatedUser });
    } catch (error) {
      logger.error('Erreur changement username:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ============ GESTION DES BADGES ============

  // Récupérer les badges d'un utilisateur
  async getBadges(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const badges = await userService.getBadges(userId);
      res.json(badges);
    } catch (error) {
      logger.error('Erreur récupération badges:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Attribuer un badge (admin seulement)
  async addBadge(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const { badgeType } = req.body;

      if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      }

      await userService.addBadge(userId, badgeType as BadgeType);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur attribution badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Retirer un badge (admin seulement)
  async removeBadge(req: AuthRequest, res: Response) {
    try {
      const { userId, badgeId } = req.params;

      if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      }

      await userService.removeBadge(userId, badgeId);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur retrait badge:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Basculer l'affichage des badges
  async toggleBadgesVisibility(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const { show } = req.body;
      await userService.toggleBadgesVisibility(userId, show);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur bascule badges:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const userController = new UserController();
