// ==========================================
// ALFYCHAT - ROUTES WEB PUSH
// Gestion des subscriptions push pour les notifications navigateur fermé
// ==========================================

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import webpush from 'web-push';
import { authMiddleware } from '../middleware/auth';
import { getDatabaseClient } from '../database';

// Configure VAPID once at module load
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:no-reply@alfycore.org',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

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

/**
 * POST /push/expo-subscribe
 * Enregistre un Expo Push Token pour l'utilisateur connecté.
 * Body : { token, userAgent? }
 */
pushRouter.post('/expo-subscribe', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { token, userAgent } = req.body as { token?: string; userAgent?: string };

    if (!token || !token.startsWith('ExponentPushToken[')) {
      return res.status(400).json({ error: 'token Expo Push valide requis' });
    }

    const db = getDatabaseClient();

    // Upsert : endpoint = le token Expo lui-même, p256dh/auth = null
    const existing: any = await db.query(
      `SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`,
      [userId, token],
    );
    const rows = (existing as any)?.[0];

    if (rows && rows.length > 0) {
      await db.execute(
        `UPDATE push_subscriptions SET user_agent = ? WHERE id = ?`,
        [userAgent ?? null, rows[0].id],
      );
    } else {
      await db.execute(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES (?, ?, ?, NULL, NULL, ?)`,
        [uuidv4(), userId, token, userAgent ?? null],
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('POST /push/expo-subscribe error:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

/**
 * POST /push/send
 * [Interne] Envoie une push notification à tous les appareils d'un utilisateur.
 * Body : { userId, title, body, url, type, conversationKey }
 */
pushRouter.post('/send', async (req, res) => {
  const internalSecret = req.headers['x-internal-secret'];
  if (!internalSecret || internalSecret !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const { userId, title, body, url, type, conversationKey } = req.body as {
      userId?: string;
      title?: string;
      body?: string;
      url?: string;
      type?: string;
      conversationKey?: string;
    };

    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const db = getDatabaseClient();
    const [rows]: any = await db.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
      [userId],
    );

    if (!rows || rows.length === 0) {
      return res.json({ sent: 0 });
    }

    // Séparer les Expo Push Tokens des subscriptions VAPID classiques
    const expoRows = rows.filter((s: any) => s.endpoint?.startsWith('ExponentPushToken['));
    const vapidRows = rows.filter((s: any) => !s.endpoint?.startsWith('ExponentPushToken['));

    const sendJobs: Promise<any>[] = [];

    // ── Expo Push ──
    if (expoRows.length > 0) {
      const expoMessages = expoRows.map((sub: any) => ({
        to: sub.endpoint,
        title: title || 'AlfyChat',
        body: body || '',
        data: { url: url || '/', type: type || 'message', conversationKey: conversationKey || '' },
        sound: 'default',
        priority: type === 'mention' ? 'high' : 'default',
        channelId: 'default',
      }));

      sendJobs.push(
        fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(expoMessages),
        }).then(async (r) => {
          if (!r.ok) throw new Error(`Expo push HTTP ${r.status}`);
          const json = await r.json() as { data: Array<{ status: string; id?: string; details?: any }> };
          // Nettoyer les tokens invalides
          const toDelete = expoRows.filter((_: any, i: number) =>
            json.data?.[i]?.details?.error === 'DeviceNotRegistered'
          );
          for (const sub of toDelete) {
            await db.execute(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [sub.endpoint]).catch(() => {});
          }
          return json.data?.filter((d: any) => d.status === 'ok').length ?? 0;
        }).catch(() => 0),
      );
    }

    // ── VAPID Web Push ──
    if (vapidRows.length > 0 && (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)) {
      console.warn('[push/send] VAPID non configuré — skip %d subscription(s) VAPID', vapidRows.length);
    }

    const vapidPayload = JSON.stringify({ title: title || 'AlfyChat', body: body || '', url: url || '/', type: type || 'message', conversationKey: conversationKey || '' });

    for (const sub of (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? vapidRows : [])) {
      if (!sub.p256dh || !sub.auth) continue;
      sendJobs.push(
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          vapidPayload,
        ).catch(async (err: any) => {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await db.execute(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [sub.endpoint]).catch(() => {});
          }
          throw err;
        }),
      );
    }

    const results = await Promise.allSettled(sendJobs);
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    res.json({ sent, total: rows.length });
  } catch (error) {
    console.error('POST /push/send error:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});
