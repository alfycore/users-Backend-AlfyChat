// ==========================================
// ALFYCHAT - CONTRÔLEUR CONNEXION PAR QR CODE
// ==========================================

import { Request, Response } from 'express';
import { remoteAuthService } from '../services/remote-auth.service';
import { logger } from '../utils/logger';
import { AuthRequest } from '../types/express';
import { getClientIp } from '../utils/client-ip';

const APP_URL = process.env.PUBLIC_APP_URL || 'https://alfychat.app';

export class RemoteAuthController {
  // ── Le poste demande un code (public) ─────────────────────────────────────
  async init(req: Request, res: Response) {
    try {
      const { ephemeralPublicKey } = req.body as { ephemeralPublicKey?: string };
      if (!ephemeralPublicKey) {
        return res.status(400).json({ error: 'Clé éphémère requise' });
      }

      const result = await remoteAuthService.init({
        ephemeralPublicKey,
        // IP réelle du poste (avant : celle du gateway, ce qui rendait inutile
        // l'affichage d'origine censé déjouer l'hameçonnage par QR).
        ip: getClientIp(req),
        userAgent: req.get('user-agent') ?? null,
        appUrl: APP_URL,
      });

      res.json(result);
    } catch (error) {
      logger.error('Erreur remote-auth init:', error);
      res.status(400).json({ error: 'Impossible de générer le code' });
    }
  }

  // ── Le téléphone annonce le scan (authentifié) ────────────────────────────
  async claim(req: AuthRequest, res: Response) {
    try {
      const { deviceCode } = req.body as { deviceCode?: string };
      if (!deviceCode) return res.status(400).json({ error: 'Code requis' });
      if (!req.userId) return res.status(401).json({ error: 'Authentification requise' });

      const result = await remoteAuthService.claim(deviceCode, req.userId);
      if (!result.success) return res.status(410).json({ error: result.error });

      res.json({
        origin: result.origin,
        ephemeralPublicKey: result.ephemeralPublicKey,
      });
    } catch (error) {
      logger.error('Erreur remote-auth claim:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ── Le téléphone approuve (authentifié) ───────────────────────────────────
  async approve(req: AuthRequest, res: Response) {
    try {
      const { deviceCode, encryptedKeyPayload } = req.body as {
        deviceCode?: string;
        encryptedKeyPayload?: string;
      };
      if (!deviceCode) return res.status(400).json({ error: 'Code requis' });
      if (!req.userId) return res.status(401).json({ error: 'Authentification requise' });

      const result = await remoteAuthService.approve(deviceCode, req.userId, encryptedKeyPayload);
      if (!result.success) return res.status(410).json({ error: result.error });

      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur remote-auth approve:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ── Le téléphone refuse (authentifié) ─────────────────────────────────────
  async deny(req: AuthRequest, res: Response) {
    try {
      const { deviceCode } = req.body as { deviceCode?: string };
      if (!deviceCode) return res.status(400).json({ error: 'Code requis' });
      if (!req.userId) return res.status(401).json({ error: 'Authentification requise' });

      const result = await remoteAuthService.deny(deviceCode, req.userId);
      if (!result.success) return res.status(410).json({ error: result.error });

      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur remote-auth deny:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // ── Le poste interroge l'état (public, protégé par pollSecret) ────────────
  async poll(req: Request, res: Response) {
    try {
      const code = String(req.query.code ?? '');
      const secret = String(req.query.secret ?? '');
      if (!code || !secret) return res.status(400).json({ error: 'Paramètres manquants' });

      const result = await remoteAuthService.poll(code, secret);
      res.json(result);
    } catch (error) {
      logger.error('Erreur remote-auth poll:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const remoteAuthController = new RemoteAuthController();
