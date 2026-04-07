// ==========================================
// ALFYCHAT - MIDDLEWARE ADMIN
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/express';
import { userService } from '../services/users.service';
import { logger } from '../utils/logger';

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

    // Vérifier le rôle admin
    if ((user as any).role !== 'admin') {
      logger.warn(`Tentative d'accès admin non autorisée: ${user.username} (${user.id})`);
      res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      return;
    }

    // Enregistrer le rôle dans la requête
    req.userRole = (user as any).role;
    
    next();
  } catch (error) {
    logger.error('Erreur middleware admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}
