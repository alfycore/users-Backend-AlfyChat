// ==========================================
// ALFYCHAT - MIDDLEWARE D'AUTHENTIFICATION
// ==========================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';
import { getRedisClient } from '../redis';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
if (!INTERNAL_SECRET) throw new Error('INTERNAL_SECRET environment variable is required — refusing to start without it');

function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Bypass interne : requêtes provenant du gateway (x-internal-secret + x-user-id)
    const internalSecret = req.headers['x-internal-secret'] as string | undefined;
    if (internalSecret && safeCompare(internalSecret, INTERNAL_SECRET)) {
      const xUserId = req.headers['x-user-id'] as string | undefined;
      if (xUserId) {
        (req as any).userId = xUserId;
        return next();
      }
    }

    // x-user-id sans secret valide est IGNORÉ — pas de fallback silencieux

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
