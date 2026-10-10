// ==========================================
// ALFYCHAT - MIDDLEWARE D'AUTHENTIFICATION
// ==========================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';
import { getRedisClient } from '../redis';

export function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Vrai si la requête porte le secret interne valide (appel du gateway / d'un service). */
export function isInternalRequest(req: Request): boolean {
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
  return !!INTERNAL_SECRET && safeCompare(req.headers['x-internal-secret'] as string | undefined, INTERNAL_SECRET);
}

/** Décode un jeton d'accès (signature HS256, type `access`). Lève en cas d'échec. */
function verifyAccessToken(token: string): { userId: string; sid?: string } {
  const decoded = jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }) as any;
  if (decoded?.type && decoded.type !== 'access') throw new Error('wrong token type');
  return { userId: decoded.userId, sid: decoded.sid };
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const JWT_SECRET = process.env.JWT_SECRET;
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
  if (!JWT_SECRET || !INTERNAL_SECRET) {
    res.status(500).json({ error: 'Server misconfiguration: missing secrets' });
    return;
  }
  try {
    // Bypass interne : requêtes provenant du gateway (x-internal-secret + x-user-id)
    if (isInternalRequest(req)) {
      const xUserId = req.headers['x-user-id'] as string | undefined;
      if (xUserId) {
        (req as any).userId = xUserId;
        (req as any).isInternal = true;
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

    const decoded = verifyAccessToken(token);

    // Ajouter l'userId (et l'identifiant de session) à la requête
    (req as any).userId = decoded.userId;
    if (decoded.sid) (req as any).sessionId = decoded.sid;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expiré' });
      return;
    }
    res.status(401).json({ error: 'Token invalide' });
  }
}

/**
 * Authentification FACULTATIVE : renseigne `req.userId` si un jeton valide (ou
 * le secret interne + x-user-id) est présent, sans jamais refuser. Contrairement
 * à l'ancien code des routes publiques, n'accorde AUCUNE confiance à un
 * `x-user-id` nu ni à un paramètre de requête.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (isInternalRequest(req)) {
      (req as any).isInternal = true;
      const xUserId = req.headers['x-user-id'] as string | undefined;
      if (xUserId) (req as any).userId = xUserId;
      return next();
    }
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      (req as any).userId = verifyAccessToken(authHeader.slice(7)).userId;
    }
  } catch { /* jeton invalide : requête anonyme */ }
  next();
}
