// ==========================================
// ALFYCHAT - MIDDLEWARE ADMIN
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/express';
import { userService } from '../services/users.service';
import { logger } from '../utils/logger';

const ADMIN_ROLES = ['admin', 'support_l1', 'support_l2', 'technician', 'moderator'] as const;
const SUPERADMIN_ROLES = ['admin'] as const;

export async function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }

    const user = await userService.findById(req.userId);
    
    if (!user) {
      res.status(401).json({ error: 'Utilisateur non trouvé' });
      return;
    }

    const role = (user as any).role as string;

    // Vérifier le rôle admin
    if (role !== 'admin') {
      logger.warn(`Tentative d'accès admin non autorisée: ${user.username} (${user.id})`);
      res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      return;
    }

    // Enregistrer le rôle dans la requête
    req.userRole = role as any;
    
    next();
  } catch (error) {
    logger.error('Erreur middleware admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}

/** Middleware acceptant admin + tous les rôles staff (support, technicien, modérateur) */
export async function staffMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }

    const user = await userService.findById(req.userId);
    
    if (!user) {
      res.status(401).json({ error: 'Utilisateur non trouvé' });
      return;
    }

    const role = (user as any).role as string;

    if (!(ADMIN_ROLES as readonly string[]).includes(role)) {
      logger.warn(`Tentative d'accès staff non autorisée: ${user.username} (${user.id})`);
      res.status(403).json({ error: 'Accès réservé au staff' });
      return;
    }

    req.userRole = role as any;
    next();
  } catch (error) {
    logger.error('Erreur middleware staff:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}
