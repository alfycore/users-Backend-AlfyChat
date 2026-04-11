// ==========================================
// ALFYCHAT - CONTRÔLEUR AUTHENTIFICATION
// ==========================================

import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { AdminService } from '../services/admin.service';
import { twoFactorService } from '../services/twofa.service';
import { logger } from '../utils/logger';
import { AuthRequest } from '../types/express';

const authService = new AuthService();
const adminService = new AdminService();

/** Normalise les adresses IPv4-mapped IPv6 (::ffff:1.2.3.4 → 1.2.3.4) */
function normalizeIP(ip: string | undefined): string {
  if (!ip) return 'inconnu';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

export class AuthController {
  // Paramètres d'inscription publics
  async getRegisterSettings(req: Request, res: Response) {
    try {
      const settings = await adminService.getSiteSettings();
      res.json({
        registrationEnabled: settings.registration_enabled !== 'false',
        turnstileEnabled: settings.turnstile_enabled === 'true',
        turnstileSiteKey: settings.turnstile_site_key || null,
      });
    } catch (error) {
      logger.error('Erreur récupération paramètres inscription:', error);
      res.json({
        registrationEnabled: true,
        turnstileEnabled: false,
        turnstileSiteKey: null,
      });
    }
  }

  // Inscription
  async register(req: Request, res: Response) {
    try {
      const { email, username, password, displayName, inviteCode, turnstileToken, publicKey, encryptedPrivateKey, keySalt } = req.body;

      // Vérifier si l'inscription est ouverte
      const registrationEnabled = await adminService.isRegistrationEnabled();
      
      if (!registrationEnabled) {
        // Si les inscriptions sont fermées, un code d'invitation est requis
        if (!inviteCode) {
          return res.status(403).json({ 
            error: 'Les inscriptions sont fermées. Un lien d\'invitation est requis.',
            registrationClosed: true,
          });
        }

        // Valider le code d'invitation
        const inviteResult = await adminService.validateInviteCode(inviteCode, email);
        if (!inviteResult.valid) {
          return res.status(400).json({ error: inviteResult.error });
        }
      }

      // Vérifier le captcha Turnstile si activé
      const turnstileEnabled = await adminService.isTurnstileEnabled();
      if (turnstileEnabled) {
        if (!turnstileToken) {
          return res.status(400).json({ error: 'Veuillez compléter le captcha' });
        }
        const turnstileValid = await adminService.verifyTurnstileToken(turnstileToken);
        if (!turnstileValid) {
          return res.status(400).json({ error: 'Vérification captcha échouée. Réessayez.' });
        }
      }

      const result = await authService.register({
        email,
        username,
        password,
        displayName: displayName || username,
        ...(publicKey && { publicKey }),
        ...(encryptedPrivateKey && { encryptedPrivateKey }),
        ...(keySalt && { keySalt }),
      }, normalizeIP(req.ip), req.get('user-agent'));

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Si un code d'invitation a été utilisé, le marquer comme consommé
      if (inviteCode && result.user) {
        try {
          const inviteResult = await adminService.validateInviteCode(inviteCode, email);
          if (inviteResult.valid && inviteResult.linkId) {
            await adminService.markInviteLinkUsed(inviteResult.linkId, result.user.id);
          }
        } catch (e) {
          // Non bloquant - log seulement
          logger.error('Erreur marquage lien invitation:', e);
        }
      }

      res.status(201).json({
        user: result.user,
        tokens: result.tokens,
      });
    } catch (error) {
      logger.error('Erreur inscription:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Connexion
  async login(req: Request, res: Response) {
    try {
      const { email, password, turnstileToken } = req.body;

      // Vérifier le captcha Turnstile si activé
      const turnstileEnabled = await adminService.isTurnstileEnabled();
      if (turnstileEnabled) {
        if (!turnstileToken) {
          return res.status(400).json({ error: 'Veuillez compléter le captcha' });
        }
        const turnstileValid = await adminService.verifyTurnstileToken(turnstileToken);
        if (!turnstileValid) {
          return res.status(400).json({ error: 'Vérification captcha échouée. Réessayez.' });
        }
      }

      const result = await authService.login(email, password, normalizeIP(req.ip), req.get('user-agent'));

      if (!result.success) {
        if (result.emailNotVerified) {
          return res.status(403).json({ emailNotVerified: true });
        }
        return res.status(401).json({ error: result.error });
      }

      // 2FA requis → retourner un token intermédiaire
      if (result.twoFactorRequired) {
        return res.json({
          twoFactorRequired: true,
          twoFactorToken: result.twoFactorToken,
        });
      }

      res.json({
        user: result.user,
        tokens: result.tokens,
        ...(result.keySalt && { keySalt: result.keySalt }),
        ...(result.encryptedPrivateKey && { encryptedPrivateKey: result.encryptedPrivateKey }),
        ...(result.keyMissing && { keyMissing: true }),
      });
    } catch (error) {
      logger.error('Erreur connexion:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Rafraîchir le token
  async refresh(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token requis' });
      }

      const result = await authService.refreshTokens(refreshToken);

      if (!result.success) {
        return res.status(401).json({ error: result.error });
      }

      res.json(result.tokens);
    } catch (error) {
      logger.error('Erreur rafraîchissement token:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Déconnexion
  async logout(req: AuthRequest, res: Response) {
    try {
      const { refreshToken } = req.body;
      
      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur déconnexion:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Déconnexion de toutes les sessions
  async logoutAll(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      await authService.logoutAll(req.userId);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur déconnexion globale:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Vérifier le token
  async verify(req: AuthRequest, res: Response) {
    try {
      res.json({
        valid: true,
        userId: req.userId,
      });
    } catch (error) {
      logger.error('Erreur vérification token:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer l'utilisateur courant
  async me(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const user = await authService.getCurrentUser(req.userId);

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      res.json(user);
    } catch (error) {
      logger.error('Erreur récupération utilisateur courant:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Vérifier l'email
  async verifyEmail(req: Request, res: Response) {
    try {
      const { token } = req.query;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Token manquant' });
      }
      const result = await authService.verifyEmail(token);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, message: 'Email vérifié avec succès.' });
    } catch (error) {
      logger.error('Erreur vérification email:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Renvoyer l'email de vérification par adresse (non authentifié)
  async resendVerificationByEmail(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email requis' });
      await authService.resendVerificationEmailByAddress(email);
      // Toujours succès pour ne pas révéler si l'email existe
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur renvoi vérification par email:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Renvoyer l'email de vérification
  async resendVerification(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const result = await authService.resendVerificationEmail(req.userId);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, message: 'Email de vérification envoyé.' });
    } catch (error) {
      logger.error('Erreur renvoi vérification:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Finaliser la connexion avec code 2FA
  async loginWith2FA(req: Request, res: Response) {
    try {
      const { twoFactorToken, code } = req.body;
      if (!twoFactorToken || !code) {
        return res.status(400).json({ error: 'Données manquantes' });
      }
      const result = await authService.loginWith2FA(twoFactorToken, code, normalizeIP(req.ip), req.get('user-agent'));
      if (!result.success) {
        return res.status(401).json({ error: result.error });
      }
      res.json({
        user: result.user,
        tokens: result.tokens,
        ...(result.keySalt && { keySalt: result.keySalt }),
        ...(result.encryptedPrivateKey && { encryptedPrivateKey: result.encryptedPrivateKey }),
        ...(result.keyMissing && { keyMissing: true }),
      });
    } catch (error) {
      logger.error('Erreur connexion 2FA:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer ses propres clés E2EE
  async getKeys(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const keys = await authService.getUserE2EEKeys(req.userId);
      res.json(keys);
    } catch (error) {
      logger.error('Erreur récupération clés E2EE:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Sauvegarder les clés E2EE (pour les utilisateurs sans clé)
  async saveKeys(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const { publicKey, encryptedPrivateKey, keySalt } = req.body;
      if (!publicKey || !encryptedPrivateKey || !keySalt) {
        return res.status(400).json({ error: 'Données manquantes' });
      }
      await authService.saveUserKeys(req.userId, publicKey, encryptedPrivateKey, keySalt);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur sauvegarde clés E2EE:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Configurer le 2FA – étape 1 : générer secret + QR
  async setup2FA(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      // Récupérer l'email de l'utilisateur
      const user = await authService.getCurrentUser(req.userId);
      if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

      const result = await twoFactorService.generateSecret(req.userId, user.email ?? '');
      res.json({
        secret: result.secret,
        qrCodeDataUrl: result.qrCodeDataUrl,
        otpauthUrl: result.otpauthUrl,
      });
    } catch (error) {
      logger.error('Erreur setup 2FA:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Activer le 2FA – étape 2 : confirmer avec le code OTP
  async enable2FA(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Code requis' });
      }
      const result = await twoFactorService.enable(req.userId, code);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true, backupCodes: result.backupCodes });
    } catch (error) {
      logger.error('Erreur activation 2FA:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Désactiver le 2FA
  async disable2FA(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Code requis' });
      }
      const result = await twoFactorService.disable(req.userId, code);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur désactivation 2FA:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Statut 2FA de l'utilisateur courant
  async get2FAStatus(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const enabled = await twoFactorService.isEnabled(req.userId);
      res.json({ enabled });
    } catch (error) {
      logger.error('Erreur statut 2FA:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Demander une réinitialisation de mot de passe
  async requestPasswordReset(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email requis' });
      // Toujours succès pour éviter l'énumération
      await authService.requestPasswordReset(email);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur demande reset mot de passe:', error);
      res.json({ success: true }); // Toujours succès
    }
  }

  // Réinitialiser le mot de passe
  async resetPassword(req: Request, res: Response) {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: 'Token et mot de passe requis' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Le mot de passe doit comporter au moins 8 caractères' });
      }
      const result = await authService.resetPassword(token, password);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur reset mot de passe:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Lister les sessions actives
  async getSessions(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const sessions = await authService.getSessions(req.userId);
      res.json({ sessions });
    } catch (error) {
      logger.error('Erreur récupération sessions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Révoquer une session spécifique
  async revokeSession(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }
      const { id } = req.params;
      const result = await authService.revokeSession(req.userId, id);
      if (!result.success) {
        return res.status(404).json({ error: result.error });
      }
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur révocation session:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const authController = new AuthController();
