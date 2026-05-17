"use strict";
// ==========================================
// ALFYCHAT - MIDDLEWARE ADMIN
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMiddleware = adminMiddleware;
exports.staffMiddleware = staffMiddleware;
const users_service_1 = require("../services/users.service");
const logger_1 = require("../utils/logger");
const ADMIN_ROLES = ['admin', 'support_l1', 'support_l2', 'technician', 'moderator'];
const SUPERADMIN_ROLES = ['admin'];
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
        const role = user.role;
        // Vérifier le rôle admin
        if (role !== 'admin') {
            logger_1.logger.warn(`Tentative d'accès admin non autorisée: ${user.username} (${user.id})`);
            res.status(403).json({ error: 'Accès réservé aux administrateurs' });
            return;
        }
        // Enregistrer le rôle dans la requête
        req.userRole = role;
        next();
    }
    catch (error) {
        logger_1.logger.error('Erreur middleware admin:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
}
/** Middleware acceptant admin + tous les rôles staff (support, technicien, modérateur) */
async function staffMiddleware(req, res, next) {
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
        const role = user.role;
        if (!ADMIN_ROLES.includes(role)) {
            logger_1.logger.warn(`Tentative d'accès staff non autorisée: ${user.username} (${user.id})`);
            res.status(403).json({ error: 'Accès réservé au staff' });
            return;
        }
        req.userRole = role;
        next();
    }
    catch (error) {
        logger_1.logger.error('Erreur middleware staff:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
}
//# sourceMappingURL=admin.js.map