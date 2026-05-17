"use strict";
// ==========================================
// ALFYCHAT - ROUTES WEB PUSH
// Gestion des subscriptions push pour les notifications navigateur fermé
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushRouter = void 0;
const express_1 = require("express");
const uuid_1 = require("uuid");
const web_push_1 = __importDefault(require("web-push"));
const auth_1 = require("../middleware/auth");
const database_1 = require("../database");
// Configure VAPID once at module load
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    web_push_1.default.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:no-reply@alfycore.org', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}
exports.pushRouter = (0, express_1.Router)();
/**
 * POST /push/subscribe
 * Enregistre une subscription Web Push pour l'utilisateur connecté.
 * Body : { endpoint, keys: { p256dh, auth }, userAgent? }
 */
exports.pushRouter.post('/subscribe', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const { endpoint, keys, userAgent } = req.body;
        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return res.status(400).json({ error: 'endpoint, keys.p256dh et keys.auth sont requis' });
        }
        const db = (0, database_1.getDatabaseClient)();
        // Upsert par endpoint (un endpoint = un navigateur/profil)
        const existing = await db.query(`SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, [userId, endpoint]);
        const rows = existing?.[0];
        if (rows && rows.length > 0) {
            await db.execute(`UPDATE push_subscriptions SET p256dh = ?, auth = ?, user_agent = ? WHERE id = ?`, [keys.p256dh, keys.auth, userAgent ?? null, rows[0].id]);
        }
        else {
            await db.execute(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), userId, endpoint, keys.p256dh, keys.auth, userAgent ?? null]);
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('POST /push/subscribe error:', error);
        res.status(500).json({ error: 'Erreur interne' });
    }
});
/**
 * DELETE /push/subscribe
 * Supprime la subscription Web Push pour l'endpoint donné.
 * Body : { endpoint }
 */
exports.pushRouter.delete('/subscribe', auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ error: 'endpoint requis' });
        }
        const db = (0, database_1.getDatabaseClient)();
        await db.execute(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, [userId, endpoint]);
        res.json({ success: true });
    }
    catch (error) {
        console.error('DELETE /push/subscribe error:', error);
        res.status(500).json({ error: 'Erreur interne' });
    }
});
/**
 * GET /push/subscriptions
 * [Interne] Retourne toutes les subscriptions d'un utilisateur.
 * Utilisé par le gateway pour envoyer des push notifications.
 */
exports.pushRouter.get('/subscriptions/:userId', async (req, res) => {
    // Vérification clé interne
    const internalSecret = req.headers['x-internal-secret'];
    if (!internalSecret || internalSecret !== process.env.INTERNAL_SECRET) {
        return res.status(403).json({ error: 'Accès refusé' });
    }
    try {
        const { userId } = req.params;
        const db = (0, database_1.getDatabaseClient)();
        const [rows] = await db.query(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`, [userId]);
        res.json({ subscriptions: rows ?? [] });
    }
    catch (error) {
        console.error('GET /push/subscriptions/:userId error:', error);
        res.status(500).json({ error: 'Erreur interne' });
    }
});
/**
 * POST /push/send
 * [Interne] Envoie une push notification à tous les appareils d'un utilisateur.
 * Body : { userId, title, body, url, type, conversationKey }
 */
exports.pushRouter.post('/send', async (req, res) => {
    const internalSecret = req.headers['x-internal-secret'];
    if (!internalSecret || internalSecret !== process.env.INTERNAL_SECRET) {
        return res.status(403).json({ error: 'Accès refusé' });
    }
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        return res.status(503).json({ error: 'Web Push non configuré (VAPID manquant)' });
    }
    try {
        const { userId, title, body, url, type, conversationKey } = req.body;
        if (!userId)
            return res.status(400).json({ error: 'userId requis' });
        const db = (0, database_1.getDatabaseClient)();
        const [rows] = await db.query(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`, [userId]);
        if (!rows || rows.length === 0) {
            return res.json({ sent: 0 });
        }
        const payload = JSON.stringify({ title: title || 'AlfyChat', body: body || '', url: url || '/', type: type || 'message', conversationKey: conversationKey || '' });
        const results = await Promise.allSettled(rows.map((sub) => web_push_1.default.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload).catch(async (err) => {
            // Subscription expirée ou invalide → supprimer
            if (err?.statusCode === 404 || err?.statusCode === 410) {
                await db.execute(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [sub.endpoint]).catch(() => { });
            }
            throw err;
        })));
        const sent = results.filter((r) => r.status === 'fulfilled').length;
        res.json({ sent, total: rows.length });
    }
    catch (error) {
        console.error('POST /push/send error:', error);
        res.status(500).json({ error: 'Erreur interne' });
    }
});
//# sourceMappingURL=push.js.map