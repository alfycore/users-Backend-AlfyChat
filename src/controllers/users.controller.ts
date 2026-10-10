// ==========================================
// ALFYCHAT - CONTRÔLEUR UTILISATEURS
// ==========================================

import { Request, Response } from 'express';
import { UserService, ProfanityError } from '../services/users.service';
import { logger } from '../utils/logger';
import { AuthRequest } from '../types/express';
import { BadgeType } from '../types/badges';
import { getDatabaseClient } from '../database';
import { checkUsername } from '../utils/username-filter';
import { authService } from '../services/auth.service';

/** Rôle relu en base (req.userRole n'était jamais renseigné : routes inutilisables). */
async function isAdminUser(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const [rows] = await getDatabaseClient().query('SELECT role FROM users WHERE id = ?', [userId]);
  return (rows as any[])[0]?.role === 'admin';
}

const userService = new UserService();

/**
 * URL de média acceptable pour un profil : chemin relatif servi par la
 * plateforme, ou http(s) sans caractères de contrôle. Les champs étaient
 * acceptés tels quels (`javascript:`, `data:`…).
 */
export function isAcceptableMediaUrl(value: unknown): boolean {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 500) return false;
  if (/^\/(api\/media|uploads)\/[A-Za-z0-9/_.%-]+$/.test(value) && !value.includes('..')) return true;
  return /^https?:\/\/[^\s<>"'`\\]+$/i.test(value);
}

/** Champs de profil visibles par des tiers (jamais l'e-mail ni le rôle interne). */
function publicProfile(user: any) {
  const { email: _email, ...rest } = user ?? {};
  return rest;
}

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
      // Identité du lecteur : jeton vérifié (optionalAuth) uniquement. Le
      // `x-user-id` nu et le paramètre `?viewerId=` étaient falsifiables et
      // permettaient de contourner un blocage.
      const viewerId = (req as any).userId as string | undefined;
      const isInternal = (req as any).isInternal === true;

      const user = await userService.findById(userId);

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      // Soi-même ou appel interne : profil complet.
      if (viewerId === userId || (isInternal && !viewerId)) {
        return res.json(user);
      }

      // Un tiers ne voit JAMAIS l'adresse e-mail : la route est publique et
      // la renvoyait pour n'importe quel identifiant.
      let view: any = publicProfile(user);

      if (viewerId) {
        // Vérifier si le viewer est bloqué par cet utilisateur → 404 anonyme
        const blocked = await userService.isBlockedBy(viewerId, userId);
        if (blocked) {
          return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        // Masquer le statut en ligne si l'utilisateur a caché son activité au viewer
        if (await userService.isActivityHiddenFrom(userId, viewerId)) {
          view = { ...view, status: 'offline', isOnline: false };
        }
      }

      // Réglage « afficher mon statut en ligne » (enregistré mais jamais appliqué).
      if (!(await userService.showsOnlineStatus(userId))) {
        view = { ...view, status: 'offline', isOnline: false, customStatus: null, statusEmoji: null };
      }

      res.json(view);
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

      // Liste bornée et assainie (taille illimitée auparavant).
      const userIds = [...new Set(ids.split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)))].slice(0, 100);
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

      const users = await userService.search(q.slice(0, 64), Math.min(Math.max(parseInt(limit as string) || 20, 1), 50));
      res.json(users);
    } catch (error) {
      logger.error('Erreur recherche utilisateurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour le profil
  /** Variante de updateProfile pour PATCH /me : la cible est toujours l'appelant. */
  async updateOwnProfile(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { displayName, avatarUrl, bannerUrl, bio, cardColor, showBadges, hiddenBadgeIds, tutorialCompleted } = req.body;
      if ((avatarUrl !== undefined && !isAcceptableMediaUrl(avatarUrl)) || (bannerUrl !== undefined && !isAcceptableMediaUrl(bannerUrl))) {
        return res.status(400).json({ error: 'URL d\'image invalide' });
      }
      if (cardColor !== undefined && cardColor !== null && !/^#[0-9a-f]{6}$/i.test(String(cardColor))) {
        return res.status(400).json({ error: 'Couleur invalide' });
      }
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
      if (error instanceof ProfanityError) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Erreur mise à jour profil:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async updateProfile(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;

      // Vérifier que l'utilisateur modifie son propre profil
      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const { displayName, avatarUrl, bannerUrl, bio, cardColor, showBadges, hiddenBadgeIds, tutorialCompleted } = req.body;
      if ((avatarUrl !== undefined && !isAcceptableMediaUrl(avatarUrl)) || (bannerUrl !== undefined && !isAcceptableMediaUrl(bannerUrl))) {
        return res.status(400).json({ error: 'URL d\'image invalide' });
      }
      if (cardColor !== undefined && cardColor !== null && !/^#[0-9a-f]{6}$/i.test(String(cardColor))) {
        return res.status(400).json({ error: 'Couleur invalide' });
      }
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
      if (error instanceof ProfanityError) {
        return res.status(400).json({ error: error.message });
      }
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

      const { status, customStatus, text, emoji } = req.body;
      const resolvedText: string | null | undefined = text ?? customStatus;
      const resolvedEmoji: string | null | undefined = emoji ?? null;

      await userService.updateStatus(userId, status, resolvedText, resolvedEmoji);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour statut:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour le statut personnalisé
  async updateCustomStatus(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      // N'importe quel compte modifiait le statut personnalisé de n'importe qui.
      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }
      const { customStatus } = req.body;

      await userService.updateCustomStatus(userId, customStatus ?? null);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour statut personnalisé:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour last seen
  async updateLastSeen(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      // Idem : forçait n'importe quel compte « hors ligne ».
      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }
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
      // Préférences = date de naissance, fuseau, vacances, réglages de
      // confidentialité… elles étaient lisibles pour n'importe quel compte.
      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }
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

      // Les autres sessions restaient valides 365 jours après un changement de
      // mot de passe : un voleur de session gardait l'accès. On ne garde que
      // la session courante (si elle est connue).
      await authService.revokeSessions(userId, req.sessionId);

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

      // Un pseudo refusé par le filtre est signalé comme indisponible,
      // avec le motif, pour que le formulaire d'inscription réagisse en direct.
      const filter = checkUsername(username);
      if (!filter.ok) {
        return res.json({ available: false, blocked: true, reason: filter.reason });
      }

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

      if (!(await isAdminUser(req.userId))) {
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

      if (!(await isAdminUser(req.userId))) {
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
