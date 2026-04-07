"use strict";
// ==========================================
// ALFYCHAT - CONTRÔLEUR RGPD
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.rgpdController = exports.RgpdController = void 0;
const rgpd_service_1 = require("../services/rgpd.service");
const logger_1 = require("../utils/logger");
const rgpdService = new rgpd_service_1.RgpdService();
class RgpdController {
    // Exporter les données utilisateur
    async exportData(req, res) {
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
        }
        catch (error) {
            logger_1.logger.error('Erreur export données RGPD:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Demander la suppression du compte
    async requestDeletion(req, res) {
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
        }
        catch (error) {
            logger_1.logger.error('Erreur demande suppression RGPD:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Annuler la demande de suppression
    async cancelDeletion(req, res) {
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
        }
        catch (error) {
            logger_1.logger.error('Erreur annulation suppression RGPD:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Récupérer les consentements
    async getConsents(req, res) {
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
        }
        catch (error) {
            logger_1.logger.error('Erreur récupération consentements:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Mettre à jour un consentement
    async updateConsent(req, res) {
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
        }
        catch (error) {
            logger_1.logger.error('Erreur mise à jour consentement:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Anonymiser les données
    async anonymize(req, res) {
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
        }
        catch (error) {
            logger_1.logger.error('Erreur anonymisation RGPD:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
}
exports.RgpdController = RgpdController;
exports.rgpdController = new RgpdController();
//# sourceMappingURL=rgpd.controller.js.map