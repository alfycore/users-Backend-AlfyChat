// ==========================================
// ALFYCHAT - ROUTES WEB PUSH
// Gestion des subscriptions push pour les notifications navigateur fermé
// ==========================================

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth';
import { getDatabaseClient } from '../database';

export const pushRouter = Router();

/**
 * POST /push/subscribe
 * Enregistre une subscription Web Push pour l'utilisateur connecté.
 * Body : { endpoint, keys: { p256dh, auth }, userAgent? }
 */
pushRouter.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { endpoint, keys, userAgent } = req.body as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      userAgent?: string;
    };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'endpoint, keys.p256dh et keys.auth sont requis' });
    }

    const db = getDatabaseClient();

    // Upsert par endpoint (un endpoint = un navigateur/profil)
    const existing: any = await db.query(
      `SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`,
      [userId, endpoint],
    );
    const rows = (existing as any)?.[0];

    if (rows && rows.length > 0) {
      await db.execute(
        `UPDATE push_subscriptions SET p256dh = ?, auth = ?, user_agent = ? WHERE id = ?`,
        [keys.p256dh, keys.auth, userAgent ?? null, rows[0].id],
      );
    } else {
      await db.execute(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), userId, endpoint, keys.p256dh, keys.auth, userAgent ?? null],
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('POST /push/subscribe error:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

/**
 * DELETE /push/subscribe
 * Supprime la subscription Web Push pour l'endpoint donné.
 * Body : { endpoint }
 */
pushRouter.delete('/subscribe', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { endpoint } = req.body as { endpoint?: string };

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint requis' });
    }

    const db = getDatabaseClient();

    await db.execute(
      `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`,
      [userId, endpoint],
    );

    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /push/subscribe error:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

/**
 * GET /push/subscriptions
 * [Interne] Retourne toutes les subscriptions d'un utilisateur.
 * Utilisé par le gateway pour envoyer des push notifications.
 */
pushRouter.get('/subscriptions/:userId', async (req, res) => {
  // Vérification clé interne
  const internalSecret = req.headers['x-internal-secret'];
  if (!internalSecret || internalSecret !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const { userId } = req.params;
    const db = getDatabaseClient();

    const [rows]: any = await db.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
      [userId],
    );

    res.json({ subscriptions: rows ?? [] });
  } catch (error) {
    console.error('GET /push/subscriptions/:userId error:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});
