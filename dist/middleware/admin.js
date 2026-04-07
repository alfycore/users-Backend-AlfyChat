"use strict";
// ==========================================
// ALFYCHAT - MIDDLEWARE ADMIN
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMiddleware = adminMiddleware;
const users_service_1 = require("../services/users.service");
const logger_1 = require("../utils/logger");
async function adminMiddleware(req, res, next) {
    try {
        if (!req.userId) {
            res.status(401).json({ error: 'Non authentifié' });
            return;
        }
        const user = await users_service_1.userService.findById(req.userId);
        if (!user) {
            res.status(401).json({ error: 'Utilisateur non trouvé' });
            return;
        }
        // Vérifier le rôle admin
        if (user.role !== 'admin') {
            logger_1.logger.warn(`Tentative d'accès admin non autorisée: ${user.username} (${user.id})`);
            res.status(403).json({ error: 'Accès réservé aux administrateurs' });
            return;
        }
        // Enregistrer le rôle dans la requête
        req.userRole = user.role;
        next();
    }
    catch (error) {
        logger_1.logger.error('Erreur middleware admin:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
}
//# sourceMappingURL=admin.js.map