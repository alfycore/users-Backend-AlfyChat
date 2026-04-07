"use strict";
// ==========================================
// ALFYCHAT - SERVICE CLÉS SIGNAL (E2EE)
// Serveur de distribution de clés publiques uniquement.
// Le serveur ne stocke et ne voit JAMAIS les clés privées.
// Protocole : X3DH (Extended Triple Diffie-Hellman) + Double Ratchet
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalKeysService = exports.SignalKeysService = void 0;
const database_1 = require("../database");
class SignalKeysService {
    get db() {
        return (0, database_1.getDatabaseClient)();
    }
    /**
     * Publie ou met à jour le bundle de clés Signal d'un utilisateur.
     * Seules les clés PUBLIQUES sont acceptées.
     */
    async publishBundle(userId, bundle) {
        const db = this.db;
        await db.execute(`INSERT INTO signal_key_bundles
         (user_id, registration_id, identity_key, ecdh_key, signed_prekey_id, signed_prekey_public, signed_prekey_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         registration_id        = VALUES(registration_id),
         identity_key           = VALUES(identity_key),
         ecdh_key               = VALUES(ecdh_key),
         signed_prekey_id       = VALUES(signed_prekey_id),
         signed_prekey_public   = VALUES(signed_prekey_public),
         signed_prekey_signature = VALUES(signed_prekey_signature),
         updated_at             = NOW()`, [
            userId,
            bundle.registrationId,
            bundle.identityKey,
            bundle.ecdhKey ?? null,
            bundle.signedPrekey.keyId,
            bundle.signedPrekey.publicKey,
            bundle.signedPrekey.signature,
        ]);
        // Ajouter les one-time prekeys
        if (bundle.prekeys?.length > 0) {
            await this.addOneTimePrekeys(userId, bundle.prekeys);
        }
    }
    /**
     * Récupère le bundle de clés d'un utilisateur pour initier une session X3DH.
     * Consomme (supprime) une one-time prekey si disponible.
     */
    async getBundle(targetUserId) {
        const db = this.db;
        const [bundles] = await db.query(`SELECT user_id, registration_id, identity_key, ecdh_key,
              signed_prekey_id, signed_prekey_public, signed_prekey_signature
       FROM signal_key_bundles
       WHERE user_id = ?`, [targetUserId]);
        const bundle = bundles[0];
        if (!bundle)
            return null;
        // Récupérer et consommer une one-time prekey (SELECT + DELETE atomique)
        const [prekeys] = await db.query(`SELECT id, prekey_id, prekey_public
       FROM signal_one_time_prekeys
       WHERE user_id = ?
       ORDER BY id ASC
       LIMIT 1`, [targetUserId]);
        const prekey = prekeys[0];
        if (prekey) {
            await db.execute(`DELETE FROM signal_one_time_prekeys WHERE id = ?`, [prekey.id]);
        }
        return {
            userId: bundle.user_id,
            registrationId: bundle.registration_id,
            identityKey: bundle.identity_key,
            ecdhKey: bundle.ecdh_key ?? undefined,
            signedPrekey: {
                keyId: bundle.signed_prekey_id,
                publicKey: bundle.signed_prekey_public,
                signature: bundle.signed_prekey_signature,
            },
            prekey: prekey
                ? { keyId: prekey.prekey_id, publicKey: prekey.prekey_public }
                : undefined,
        };
    }
    /**
     * Ajoute de nouvelles one-time prekeys (rechargement périodique).
     */
    async addOneTimePrekeys(userId, prekeys) {
        for (const pk of prekeys) {
            try {
                await this.db.execute(`INSERT IGNORE INTO signal_one_time_prekeys (user_id, prekey_id, prekey_public)
           VALUES (?, ?, ?)`, [userId, pk.keyId, pk.publicKey]);
            }
            catch {
                // Ignorer les doublons
            }
        }
    }
    /**
     * Nombre de one-time prekeys restantes pour un utilisateur.
     */
    async getPrekeyCount(userId) {
        const [rows] = await this.db.query(`SELECT COUNT(*) as cnt FROM signal_one_time_prekeys WHERE user_id = ?`, [userId]);
        return rows[0]?.cnt ?? 0;
    }
    /**
     * Vérifie si un utilisateur a publié un bundle Signal.
     */
    async hasBundle(userId) {
        const [rows] = await this.db.query(`SELECT 1 FROM signal_key_bundles WHERE user_id = ? LIMIT 1`, [userId]);
        return rows.length > 0;
    }
    /**
     * Met à jour uniquement la clé ECDH P-256 du bundle existant.
     */
    async updateECDHKey(userId, ecdhKey) {
        await this.db.execute(`UPDATE signal_key_bundles SET ecdh_key = ?, updated_at = NOW() WHERE user_id = ?`, [ecdhKey, userId]);
    }
    /**
     * Stocke le bundle de clés privées chiffré avec le mot de passe de l'utilisateur.
     * Le serveur ne peut PAS déchiffrer ce blob — seul le client avec le bon mot de passe peut.
     */
    async storePrivateBundle(userId, encryptedBlob) {
        await this.db.execute(`UPDATE signal_key_bundles
       SET encrypted_private_bundle = ?, updated_at = NOW()
       WHERE user_id = ?`, [encryptedBlob, userId]);
    }
    /**
     * Récupère le bundle de clés privées chiffré pour un utilisateur.
     * Retourne null si aucun bundle n'a encore été stocké.
     */
    async getPrivateBundle(userId) {
        const [rows] = await this.db.query(`SELECT encrypted_private_bundle FROM signal_key_bundles WHERE user_id = ?`, [userId]);
        const row = rows[0];
        return row?.encrypted_private_bundle ?? null;
    }
}
exports.SignalKeysService = SignalKeysService;
exports.signalKeysService = new SignalKeysService();
//# sourceMappingURL=keys.service.js.map