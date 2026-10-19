// ==========================================
// ALFYCHAT - CONTRÔLEUR CLÉS SIGNAL (E2EE)
// ==========================================

import { Request, Response } from 'express';
import { signalKeysService } from '../services/keys.service';
import { AuthRequest } from '../types/express';
import { getRedisClient } from '../redis';

/**
 * Chaque lecture d'un bundle consomme une one-time prekey du destinataire. La
 * route était publique et illimitée : n'importe qui pouvait vider le stock de
 * prékeys d'un compte (dégradant la confidentialité persistante de ses
 * prochaines sessions X3DH). Au-delà du quota, le bundle est servi SANS
 * prekey (X3DH reste possible, sans consommer).
 */
const PREKEY_PAIR_QUOTA = 5;        // par (demandeur, cible) et par heure
const PREKEY_REQUESTER_QUOTA = 60;  // par demandeur et par heure

async function mayConsumePrekey(requesterId: string, targetId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const pairKey = `prekeyfetch:${requesterId}:${targetId}`;
    const reqKey = `prekeyfetch:${requesterId}`;
    const pair = Number(await redis.get(pairKey) ?? 0);
    const total = Number(await redis.get(reqKey) ?? 0);
    if (pair >= PREKEY_PAIR_QUOTA || total >= PREKEY_REQUESTER_QUOTA) return false;
    await redis.set(pairKey, String(pair + 1), 3600);
    await redis.set(reqKey, String(total + 1), 3600);
    return true;
  } catch {
    return false;
  }
}

export class SignalKeysController {
  /**
   * PUT /api/users/keys
   * Publier ou mettre à jour le bundle de clés Signal de l'utilisateur courant.
   */
  async publishBundle(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { registrationId, identityKey, ecdhKey, signedPrekey, prekeys } = req.body;

      if (!registrationId || !identityKey || signedPrekey?.keyId === undefined || !signedPrekey?.publicKey || !signedPrekey?.signature) {
        return res.status(400).json({ error: 'Bundle Signal incomplet' });
      }

      await signalKeysService.publishBundle(userId, {
        registrationId,
        identityKey,
        ecdhKey,
        signedPrekey,
        prekeys: prekeys ?? [],
      });

      const count = await signalKeysService.getPrekeyCount(userId);
      res.json({ success: true, prekeyCount: count });
    } catch (error) {
      console.error('[Signal] Erreur publication bundle:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * GET /api/users/keys/status
   * Statut des clés de l'utilisateur courant (nombre de prekeys restantes).
   */
  async getStatus(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const [count, bundleInfo] = await Promise.all([
        signalKeysService.getPrekeyCount(userId),
        signalKeysService.getBundleInfo(userId),
      ]);
      res.json({ hasBundle: bundleInfo.hasBundle, hasEcdhKey: bundleInfo.hasEcdhKey, prekeyCount: count });
    } catch (error) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * GET /api/users/keys/:userId
   * Récupérer le bundle de clés d'un autre utilisateur (pour initier une session X3DH).
   * Consomme une one-time prekey.
   */
  async getBundle(req: AuthRequest, res: Response) {
    try {
      const { userId } = req.params;
      const requesterId = req.userId!;
      const consume = requesterId !== userId && await mayConsumePrekey(requesterId, userId);
      const bundle = await signalKeysService.getBundle(userId, consume);

      if (!bundle) {
        return res.status(404).json({ error: 'Aucun bundle Signal pour cet utilisateur' });
      }

      res.json(bundle);
    } catch (error) {
      console.error('[Signal] Erreur récupération bundle:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * POST /api/users/keys/prekeys
   * Recharger les one-time prekeys (appelé quand le stock est faible).
   */
  async addPrekeys(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { prekeys } = req.body;

      if (!Array.isArray(prekeys) || prekeys.length === 0) {
        return res.status(400).json({ error: 'prekeys requis (tableau non vide)' });
      }

      await signalKeysService.addOneTimePrekeys(userId, prekeys);
      const count = await signalKeysService.getPrekeyCount(userId);

      res.json({ success: true, prekeyCount: count });
    } catch (error) {
      console.error('[Signal] Erreur ajout prekeys:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * POST /api/users/keys/ecdh/batch  { userIds: string[] }
   * Clés ECDH publiques par lot (groupes chiffrés) — n'en consomme aucune.
   */
  async getEcdhKeys(req: AuthRequest, res: Response) {
    try {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const raw: unknown[] = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
      const userIds = [...new Set(raw.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))].slice(0, 100);
      const keys = await signalKeysService.getEcdhKeys(userIds);
      res.json({ keys });
    } catch (error) {
      console.error('[Signal] Erreur lecture clés ECDH:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * PATCH /api/users/keys/ecdh
   * Met à jour uniquement la clé ECDH P-256 du bundle existant.
   */
  async updateECDHKey(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { ecdhKey } = req.body;

      if (!ecdhKey || typeof ecdhKey !== 'string') {
        return res.status(400).json({ error: 'ecdhKey requis (string base64)' });
      }

      const hasBundle = await signalKeysService.hasBundle(userId);
      if (!hasBundle) {
        return res.status(400).json({ error: 'Aucun bundle Signal existant' });
      }

      await signalKeysService.updateECDHKey(userId, ecdhKey);
      res.json({ success: true });
    } catch (error) {
      console.error('[Signal] Erreur mise à jour clé ECDH:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * PUT /api/users/keys/private-bundle
   * Stocke le bundle de clés privées chiffré avec le mot de passe utilisateur.
   * Le serveur ne peut pas déchiffrer ce blob.
   */
  async uploadPrivateBundle(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const { encryptedBundle } = req.body;

      if (!encryptedBundle || typeof encryptedBundle !== 'string') {
        return res.status(400).json({ error: 'encryptedBundle requis (string)' });
      }

      // S'assurer qu'un bundle public existe (pré-requis)
      const hasBundle = await signalKeysService.hasBundle(userId);
      if (!hasBundle) {
        return res.status(400).json({ error: 'Aucun bundle Signal public trouvé. Publiez d\'abord vos clés publiques.' });
      }

      await signalKeysService.storePrivateBundle(userId, encryptedBundle);
      res.json({ success: true });
    } catch (error) {
      console.error('[Signal] Erreur stockage bundle privé:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  /**
   * GET /api/users/keys/private-bundle
   * Récupère le bundle de clés privées chiffré de l'utilisateur courant.
   * Retourne null si aucun bundle chiffré n'a encore été stocké.
   */
  async downloadPrivateBundle(req: AuthRequest, res: Response) {
    try {
      const userId = req.userId!;
      const encryptedBundle = await signalKeysService.getPrivateBundle(userId);

      if (!encryptedBundle) {
        return res.json({ encryptedBundle: null });
      }

      res.json({ encryptedBundle });
    } catch (error) {
      console.error('[Signal] Erreur récupération bundle privé:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const signalKeysController = new SignalKeysController();
