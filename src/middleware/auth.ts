// ==========================================
// ALFYCHAT - MIDDLEWARE D'AUTHENTIFICATION
// ==========================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getRedisClient } from '../redis';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Bypass interne : requêtes provenant du gateway (x-internal-secret + x-user-id)
    const internalSecret = req.headers['x-internal-secret'] as string | undefined;
    if (INTERNAL_SECRET && internalSecret && internalSecret === INTERNAL_SECRET) {
      const xUserId = req.headers['x-user-id'] as string | undefined;
      if (xUserId) {
        (req as any).userId = xUserId;
        return next();
      }
    }

    // Fallback réseau interne : x-user-id seul (quand INTERNAL_SECRET n'est pas configuré)
    if (!INTERNAL_SECRET) {
      const xUserId = req.headers['x-user-id'] as string | undefined;
      if (xUserId) {
        (req as any).userId = xUserId;
        return next();
      }
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token d\'authentification requis' });
      return;
    }

    const token = authHeader.replace('Bearer ', '');

    // Vérifier si le token est blacklisté
    const redis = getRedisClient();
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      res.status(401).json({ error: 'Token invalide' });
      return;
    }

    // Vérifier le token
    const decoded = jwt.verify(token, JWT_SECRET as string) as unknown as { userId: string };
    
    // Ajouter l'userId à la requête
    (req as any).userId = decoded.userId;
    
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expiré' });
      return;
    }
    res.status(401).json({ error: 'Token invalide' });
  }
}
