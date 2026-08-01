// ==========================================
// ALFYCHAT - CONTRÔLEUR MODÉRATION
// ==========================================

import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { moderationService, SanctionType } from '../services/moderation.service';
import { userService } from '../services/users.service';
import { logger } from '../utils/logger';

/** Rôles autorisés à sanctionner un membre du staff */
const CAN_SANCTION_STAFF = ['admin'];

/** Rôles considérés comme staff (non sanctionnables par un pair) */
const STAFF_ROLES = ['admin', 'moderator', 'support_l1', 'support_l2', 'technician'];

export class ModerationController {
  /**
   * Vérifie qu'un modérateur a le droit de sanctionner une cible donnée.
   * Empêche l'auto-sanction, la sanction d'un admin, et l'escalade entre pairs.
   */
  private async authorizeTarget(
    req: AuthRequest,
    targetUserId: string
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    if (!req.userId) {
      return { ok: false, status: 401, error: 'Non authentifié' };
    }
    if (req.userId === targetUserId) {
      return { ok: false, status: 400, error: 'Vous ne pouvez pas vous sanctionner vous-même' };
    }

    const target = await userService.findById(targetUserId);
    if (!target) {
      return { ok: false, status: 404, error: 'Utilisateur introuvable' };
    }

    const targetRole = (target as any).role ?? 'user';
    const actorRole = req.userRole ?? 'user';

    // Un admin ne peut jamais être sanctionné via cette API
    if (targetRole === 'admin') {
      return { ok: false, status: 403, error: 'Un administrateur ne peut pas être sanctionné' };
    }

    // Seul un admin peut sanctionner un autre membre du staff
    if (STAFF_ROLES.includes(targetRole) && !CAN_SANCTION_STAFF.includes(actorRole)) {
      return {
        ok: false,
        status: 403,
        error: 'Seul un administrateur peut sanctionner un membre du staff',
      };
    }

    return { ok: true };
  }

  // ============ SANCTIONS ============

  /** POST /admin/moderation/users/:userId/sanctions */
  async createSanction(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const { type, reason, durationMinutes } = req.body as {
        type: SanctionType;
        reason: string;
        durationMinutes?: number | null;
      };

      const auth = await this.authorizeTarget(req, userId);
      if (!auth.ok) {
        return res.status(auth.status).json({ error: auth.error });
      }

      const sanction = await moderationService.applySanction({
        userId,
        type,
        reason,
        durationMinutes: durationMinutes ?? null,
        issuedBy: req.userId!,
      });

      logger.warn(
        `[MODÉRATION] ${type} sur ${userId} par ${req.userId} — ${reason}`
      );

      res.status(201).json(sanction);
    } catch (error) {
      logger.error('Erreur création sanction:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** DELETE /admin/moderation/sanctions/:sanctionId */
  async revokeSanction(req: AuthRequest, res: Response) {
    try {
      const { sanctionId } = req.params;
      const { reason } = req.body as { reason?: string };

      const result = await moderationService.revokeSanction(
        sanctionId,
        req.userId!,
        reason
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      logger.warn(`[MODÉRATION] Sanction ${sanctionId} levée par ${req.userId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur levée de sanction:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** POST /admin/moderation/users/:userId/unban — lève tous les bans actifs */
  async unbanUser(req: AuthRequest, res: Response) {
    try {
      const count = await moderationService.revokeActiveSanctions(
        req.params.userId,
        'ban',
        req.userId!,
        req.body?.reason
      );
      logger.warn(`[MODÉRATION] Débannissement de ${req.params.userId} par ${req.userId}`);
      res.json({ success: true, revoked: count });
    } catch (error) {
      logger.error('Erreur débannissement:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** POST /admin/moderation/users/:userId/unmute — lève tous les mutes actifs */
  async unmuteUser(req: AuthRequest, res: Response) {
    try {
      const count = await moderationService.revokeActiveSanctions(
        req.params.userId,
        'mute',
        req.userId!,
        req.body?.reason
      );
      res.json({ success: true, revoked: count });
    } catch (error) {
      logger.error('Erreur démute:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** GET /admin/moderation/sanctions */
  async listSanctions(req: AuthRequest, res: Response) {
    try {
      const sanctions = await moderationService.listSanctions({
        userId: (req.query.userId as string) || undefined,
        type: (req.query.type as SanctionType) || undefined,
        activeOnly: req.query.activeOnly === 'true',
        limit: parseInt(req.query.limit as string) || 100,
        offset: parseInt(req.query.offset as string) || 0,
      });
      res.json(sanctions);
    } catch (error) {
      logger.error('Erreur liste des sanctions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** GET /admin/moderation/users/:userId — dossier de modération d'un compte */
  async getUserModeration(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const [status, history] = await Promise.all([
        moderationService.getStatus(userId),
        moderationService.listSanctions({ userId, limit: 100 }),
      ]);
      res.json({ status, history });
    } catch (error) {
      logger.error('Erreur dossier de modération:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** GET /admin/moderation/stats */
  async getStats(req: AuthRequest, res: Response) {
    try {
      res.json(await moderationService.getStats());
    } catch (error) {
      logger.error('Erreur stats modération:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ============ TERMES INTERDITS ============

  /** GET /admin/moderation/terms */
  async listTerms(req: AuthRequest, res: Response) {
    try {
      res.json(await moderationService.listTerms());
    } catch (error) {
      logger.error('Erreur liste des termes:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** POST /admin/moderation/terms */
  async addTerm(req: AuthRequest, res: Response) {
    try {
      const { term, matchType } = req.body;
      const result = await moderationService.addTerm(
        term,
        matchType || 'word',
        req.userId!
      );
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.status(201).json({ success: true });
    } catch (error) {
      logger.error('Erreur ajout de terme:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /** DELETE /admin/moderation/terms/:termId */
  async deleteTerm(req: AuthRequest, res: Response) {
    try {
      await moderationService.deleteTerm(req.params.termId);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur suppression de terme:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const moderationController = new ModerationController();
