// ==========================================
// ALFYCHAT - CONTRÔLEUR RGPD
// ==========================================

import { Response } from 'express';
import { RgpdService } from '../services/rgpd.service';
import { logger } from '../utils/logger';
import { AuthRequest } from '../types/express';

const rgpdService = new RgpdService();

export class RgpdController {
  // Exporter les données utilisateur
  async exportData(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const data = await rgpdService.exportUserData(userId);
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="alfychat-data-${userId}.json"`);
      res.json(data);
    } catch (error) {
      logger.error('Erreur export données RGPD:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Demander la suppression du compte
  async requestDeletion(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const result = await rgpdService.requestDeletion(userId);
      
      res.json({
        success: true,
        scheduledDeletionAt: result.scheduledDeletionAt,
        message: 'Votre compte sera supprimé dans 30 jours. Vous pouvez annuler cette demande.',
      });
    } catch (error) {
      logger.error('Erreur demande suppression RGPD:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Annuler la demande de suppression
  async cancelDeletion(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      await rgpdService.cancelDeletion(userId);
      res.json({ success: true, message: 'Demande de suppression annulée' });
    } catch (error) {
      logger.error('Erreur annulation suppression RGPD:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer les consentements
  async getConsents(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      const consents = await rgpdService.getConsents(userId);
      res.json(consents);
    } catch (error) {
      logger.error('Erreur récupération consentements:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Mettre à jour un consentement
  async updateConsent(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { userId } = req.params;
      const { consentType, granted } = req.body;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      await rgpdService.updateConsent(userId, consentType, granted);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur mise à jour consentement:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Anonymiser les données
  async anonymize(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { userId } = req.params;

      if (req.userId !== userId) {
        return res.status(403).json({ error: 'Non autorisé' });
      }

      await rgpdService.anonymizeUser(userId);
      res.json({ success: true, message: 'Données anonymisées' });
    } catch (error) {
      logger.error('Erreur anonymisation RGPD:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const rgpdController = new RgpdController();
