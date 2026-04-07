"use strict";
// ==========================================
// ALFYCHAT - CONTRÔLEUR CLÉS SIGNAL (E2EE)
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalKeysController = exports.SignalKeysController = void 0;
const keys_service_1 = require("../services/keys.service");
class SignalKeysController {
    /**
     * PUT /api/users/keys
     * Publier ou mettre à jour le bundle de clés Signal de l'utilisateur courant.
     */
    async publishBundle(req, res) {
        try {
            const userId = req.userId;
            const { registrationId, identityKey, ecdhKey, signedPrekey, prekeys } = req.body;
            if (!registrationId || !identityKey || signedPrekey?.keyId === undefined || !signedPrekey?.publicKey || !signedPrekey?.signature) {
                return res.status(400).json({ error: 'Bundle Signal incomplet' });
            }
            await keys_service_1.signalKeysService.publishBundle(userId, {
                registrationId,
                identityKey,
                ecdhKey,
                signedPrekey,
                prekeys: prekeys ?? [],
            });
            const count = await keys_service_1.signalKeysService.getPrekeyCount(userId);
            res.json({ success: true, prekeyCount: count });
        }
        catch (error) {
            console.error('[Signal] Erreur publication bundle:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    /**
     * GET /api/users/keys/status
     * Statut des clés de l'utilisateur courant (nombre de prekeys restantes).
     */
    async getStatus(req, res) {
        try {
            const userId = req.userId;
            const [count, hasBundle] = await Promise.all([
                keys_service_1.signalKeysService.getPrekeyCount(userId),
                keys_service_1.signalKeysService.hasBundle(userId),
            ]);
            res.json({ hasBundle, prekeyCount: count });
        }
        catch (error) {
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    /**
     * GET /api/users/keys/:userId
     * Récupérer le bundle de clés d'un autre utilisateur (pour initier une session X3DH).
     * Consomme une one-time prekey.
     */
    async getBundle(req, res) {
        try {
            const { userId } = req.params;
            const bundle = await keys_service_1.signalKeysService.getBundle(userId);
            if (!bundle) {
                return res.status(404).json({ error: 'Aucun bundle Signal pour cet utilisateur' });
            }
            res.json(bundle);
        }
        catch (error) {
            console.error('[Signal] Erreur récupération bundle:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    /**
     * POST /api/users/keys/prekeys
     * Recharger les one-time prekeys (appelé quand le stock est faible).
     */
    async addPrekeys(req, res) {
        try {
            const userId = req.userId;
            const { prekeys } = req.body;
            if (!Array.isArray(prekeys) || prekeys.length === 0) {
                return res.status(400).json({ error: 'prekeys requis (tableau non vide)' });
            }
            await keys_service_1.signalKeysService.addOneTimePrekeys(userId, prekeys);
            const count = await keys_service_1.signalKeysService.getPrekeyCount(userId);
            res.json({ success: true, prekeyCount: count });
        }
        catch (error) {
            console.error('[Signal] Erreur ajout prekeys:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    /**
     * PATCH /api/users/keys/ecdh
     * Met à jour uniquement la clé ECDH P-256 du bundle existant.
     */
    async updateECDHKey(req, res) {
        try {
            const userId = req.userId;
            const { ecdhKey } = req.body;
            if (!ecdhKey || typeof ecdhKey !== 'string') {
                return res.status(400).json({ error: 'ecdhKey requis (string base64)' });
            }
            const hasBundle = await keys_service_1.signalKeysService.hasBundle(userId);
            if (!hasBundle) {
                return res.status(400).json({ error: 'Aucun bundle Signal existant' });
            }
            await keys_service_1.signalKeysService.updateECDHKey(userId, ecdhKey);
            res.json({ success: true });
        }
        catch (error) {
            console.error('[Signal] Erreur mise à jour clé ECDH:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    /**
     * PUT /api/users/keys/private-bundle
     * Stocke le bundle de clés privées chiffré avec le mot de passe utilisateur.
     * Le serveur ne peut pas déchiffrer ce blob.
     */
    async uploadPrivateBundle(req, res) {
        try {
            const userId = req.userId;
            const { encryptedBundle } = req.body;
            if (!encryptedBundle || typeof encryptedBundle !== 'string') {
                return res.status(400).json({ error: 'encryptedBundle requis (string)' });
            }
            // S'assurer qu'un bundle public existe (pré-requis)
            const hasBundle = await keys_service_1.signalKeysService.hasBundle(userId);
            if (!hasBundle) {
                return res.status(400).json({ error: 'Aucun bundle Signal public trouvé. Publiez d\'abord vos clés publiques.' });
            }
            await keys_service_1.signalKeysService.storePrivateBundle(userId, encryptedBundle);
            res.json({ success: true });
        }
        catch (error) {
            console.error('[Signal] Erreur stockage bundle privé:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    /**
     * GET /api/users/keys/private-bundle
     * Récupère le bundle de clés privées chiffré de l'utilisateur courant.
     * Retourne null si aucun bundle chiffré n'a encore été stocké.
     */
    async downloadPrivateBundle(req, res) {
        try {
            const userId = req.userId;
            const encryptedBundle = await keys_service_1.signalKeysService.getPrivateBundle(userId);
            if (!encryptedBundle) {
                return res.json({ encryptedBundle: null });
            }
            res.json({ encryptedBundle });
        }
        catch (error) {
            console.error('[Signal] Erreur récupération bundle privé:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
}
exports.SignalKeysController = SignalKeysController;
exports.signalKeysController = new SignalKeysController();
//# sourceMappingURL=keys.controller.js.map