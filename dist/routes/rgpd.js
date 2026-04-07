"use strict";
// ==========================================
// ALFYCHAT - ROUTES RGPD
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.rgpdRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const rgpd_controller_1 = require("../controllers/rgpd.controller");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
exports.rgpdRouter = (0, express_1.Router)();
// Toutes les routes RGPD nécessitent une authentification
exports.rgpdRouter.use(auth_1.authMiddleware);
// Exporter les données (Article 20 RGPD)
exports.rgpdRouter.get('/:userId/export', rgpd_controller_1.rgpdController.exportData.bind(rgpd_controller_1.rgpdController));
// Demander la suppression (Article 17 RGPD)
exports.rgpdRouter.post('/:userId/delete', rgpd_controller_1.rgpdController.requestDeletion.bind(rgpd_controller_1.rgpdController));
// Annuler la demande de suppression
exports.rgpdRouter.delete('/:userId/delete', rgpd_controller_1.rgpdController.cancelDeletion.bind(rgpd_controller_1.rgpdController));
// Récupérer les consentements
exports.rgpdRouter.get('/:userId/consents', rgpd_controller_1.rgpdController.getConsents.bind(rgpd_controller_1.rgpdController));
// Mettre à jour un consentement
exports.rgpdRouter.patch('/:userId/consents', (0, express_validator_1.body)('consentType').isIn(['necessary', 'analytics', 'marketing']), (0, express_validator_1.body)('granted').isBoolean(), validate_1.validateRequest, rgpd_controller_1.rgpdController.updateConsent.bind(rgpd_controller_1.rgpdController));
// Anonymiser les données
exports.rgpdRouter.post('/:userId/anonymize', rgpd_controller_1.rgpdController.anonymize.bind(rgpd_controller_1.rgpdController));
//# sourceMappingURL=rgpd.js.map