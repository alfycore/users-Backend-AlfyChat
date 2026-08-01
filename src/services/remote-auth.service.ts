// ==========================================
// ALFYCHAT - CONNEXION À DISTANCE PAR QR CODE
// ==========================================
//
// Un poste non authentifié affiche un QR ; un téléphone déjà connecté le scanne
// et approuve. Le poste reçoit alors une session complète.
//
// ── Modèle de sécurité ──────────────────────────────────────────────────────
//
// 1. DEUX SECRETS DISTINCTS. Le QR ne contient que `deviceCode` (public).
//    `pollSecret` n'est remis qu'à l'appelant de `init` et n'apparaît jamais à
//    l'écran. Interroger l'état exige les deux : photographier le QR d'un
//    inconnu ne permet donc pas de récupérer sa session.
//
// 2. APPROBATION EXPLICITE. Le téléphone affiche l'IP et le navigateur du
//    demandeur avant d'approuver. C'est la contre-mesure à l'hameçonnage par
//    QR (un attaquant qui fait scanner son propre code est visible).
//
// 3. USAGE UNIQUE ET COURTE DURÉE. L'entrée vit 120 s dans Redis et est
//    détruite dès que les jetons sont remis.
//
// 4. LE SERVEUR NE VOIT JAMAIS LA CLÉ E2EE. Le navigateur génère une paire
//    éphémère et publie sa clé publique dans le QR ; le téléphone chiffre la
//    clé privée d'identité vers celle-ci. Ce service ne fait que convoyer un
//    blob opaque (`encryptedKeyPayload`) qu'il est incapable de déchiffrer.
// ────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import qrcode from 'qrcode';
import { getRedisClient } from '../redis';
import { authService } from './auth.service';
import { UserService } from './users.service';
import { User } from '../types/user';

const userService = new UserService();

/** Durée de vie d'un code, en secondes. Court : le QR est à l'écran. */
const TTL_SECONDS = 120;

/** Taille maximale du blob de clé chiffrée, pour borner ce qu'on stocke. */
const MAX_KEY_PAYLOAD = 8192;

/** Taille maximale de la clé publique éphémère transmise par le navigateur. */
const MAX_EPHEMERAL_KEY = 2048;

export type RemoteAuthStatus = 'pending' | 'scanned' | 'approved' | 'denied';

interface RemoteAuthOrigin {
  ip: string | null;
  userAgent: string | null;
  requestedAt: string;
}

interface RemoteAuthEntry {
  status: RemoteAuthStatus;
  /** sha256(pollSecret) — le secret lui-même n'est jamais stocké. */
  secretHash: string;
  /** Clé publique éphémère du navigateur, republiée au téléphone. */
  ephemeralPublicKey: string;
  origin: RemoteAuthOrigin;
  userId?: string;
  tokens?: Awaited<ReturnType<typeof authService.issueTokensForUser>>;
  user?: User;
  /** Clé privée E2EE chiffrée par le téléphone. Opaque pour le serveur. */
  encryptedKeyPayload?: string;
}

function redisKey(deviceCode: string): string {
  return `remote-auth:${deviceCode}`;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Comparaison à temps constant de deux empreintes hexadécimales. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class RemoteAuthService {
  private get redis() {
    return getRedisClient();
  }

  private async read(deviceCode: string): Promise<RemoteAuthEntry | null> {
    if (!/^[a-f0-9]{32}$/.test(deviceCode)) return null;
    const raw = await this.redis.get(redisKey(deviceCode));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RemoteAuthEntry;
    } catch {
      return null;
    }
  }

  private async write(deviceCode: string, entry: RemoteAuthEntry): Promise<void> {
    await this.redis.set(redisKey(deviceCode), JSON.stringify(entry), TTL_SECONDS);
  }

  // ── 1. Le poste demande un code ───────────────────────────────────────────
  async init(params: {
    ephemeralPublicKey: string;
    ip: string | null;
    userAgent: string | null;
    /** Base publique pour le repli HTTPS encodé dans le QR. */
    appUrl: string;
  }): Promise<{
    deviceCode: string;
    pollSecret: string;
    qrPayload: string;
    qrCodeDataUrl: string;
    expiresIn: number;
  }> {
    if (!params.ephemeralPublicKey || params.ephemeralPublicKey.length > MAX_EPHEMERAL_KEY) {
      throw new Error('Clé éphémère invalide');
    }

    const deviceCode = crypto.randomBytes(16).toString('hex');
    const pollSecret = crypto.randomBytes(32).toString('hex');

    await this.write(deviceCode, {
      status: 'pending',
      secretHash: sha256(pollSecret),
      ephemeralPublicKey: params.ephemeralPublicKey,
      origin: {
        ip: params.ip,
        userAgent: params.userAgent,
        requestedAt: new Date().toISOString(),
      },
    });

    // Le scanner de l'app lit cette chaîne telle quelle : pas de dépendance au
    // routage de liens profonds de l'OS. Le repli HTTPS sert aux appareils photo
    // génériques, qui n'ouvriraient pas un schéma personnalisé.
    const qrPayload = `alfychat://remote-auth?code=${deviceCode}`;
    const qrCodeDataUrl = await qrcode.toDataURL(qrPayload, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
    });

    return {
      deviceCode,
      pollSecret,
      qrPayload,
      qrCodeDataUrl,
      expiresIn: TTL_SECONDS,
    };
  }

  // ── 2. Le téléphone annonce le scan ───────────────────────────────────────
  async claim(
    deviceCode: string,
    userId: string,
  ): Promise<
    | { success: true; origin: RemoteAuthOrigin; ephemeralPublicKey: string }
    | { success: false; error: string }
  > {
    const entry = await this.read(deviceCode);
    if (!entry) return { success: false, error: 'Code inconnu ou expiré' };
    if (entry.status !== 'pending') {
      return { success: false, error: 'Ce code a déjà été utilisé' };
    }

    entry.status = 'scanned';
    entry.userId = userId;
    await this.write(deviceCode, entry);

    return {
      success: true,
      origin: entry.origin,
      ephemeralPublicKey: entry.ephemeralPublicKey,
    };
  }

  // ── 3. Le téléphone approuve ──────────────────────────────────────────────
  async approve(
    deviceCode: string,
    userId: string,
    encryptedKeyPayload?: string,
  ): Promise<{ success: true } | { success: false; error: string }> {
    const entry = await this.read(deviceCode);
    if (!entry) return { success: false, error: 'Code inconnu ou expiré' };
    if (entry.status !== 'scanned') {
      return { success: false, error: 'Ce code doit d’abord être scanné' };
    }
    // Le compte qui approuve doit être celui qui a scanné.
    if (entry.userId !== userId) {
      return { success: false, error: 'Ce code appartient à une autre session' };
    }
    if (encryptedKeyPayload && encryptedKeyPayload.length > MAX_KEY_PAYLOAD) {
      return { success: false, error: 'Charge de clé trop volumineuse' };
    }

    const user = await userService.findById(userId);
    if (!user) return { success: false, error: 'Utilisateur introuvable' };

    // La session créée est attribuée à l'appareil DEMANDEUR (le poste), pas au
    // téléphone : c'est bien lui qui apparaîtra dans « Sessions actives ».
    const tokens = await authService.issueTokensForUser(
      userId,
      entry.origin.ip,
      entry.origin.userAgent,
    );

    entry.status = 'approved';
    entry.tokens = tokens;
    entry.user = user;
    if (encryptedKeyPayload) entry.encryptedKeyPayload = encryptedKeyPayload;
    await this.write(deviceCode, entry);

    return { success: true };
  }

  // ── 4. Le téléphone refuse ────────────────────────────────────────────────
  async deny(
    deviceCode: string,
    userId: string,
  ): Promise<{ success: true } | { success: false; error: string }> {
    const entry = await this.read(deviceCode);
    if (!entry) return { success: false, error: 'Code inconnu ou expiré' };
    if (entry.status === 'approved') {
      return { success: false, error: 'Ce code a déjà été approuvé' };
    }
    // Un code encore `pending` peut être refusé par n'importe quel compte
    // authentifié qui l'a sous les yeux ; une fois scanné, seul le scanneur.
    if (entry.userId && entry.userId !== userId) {
      return { success: false, error: 'Ce code appartient à une autre session' };
    }

    entry.status = 'denied';
    entry.userId = userId;
    await this.write(deviceCode, entry);
    return { success: true };
  }

  // ── 5. Le poste interroge l'état ──────────────────────────────────────────
  async poll(
    deviceCode: string,
    pollSecret: string,
  ): Promise<
    | { status: 'pending' | 'scanned' | 'denied' }
    | {
        status: 'approved';
        tokens: NonNullable<RemoteAuthEntry['tokens']>;
        user: User;
        encryptedKeyPayload?: string;
      }
    | { status: 'expired' }
  > {
    const entry = await this.read(deviceCode);
    if (!entry) return { status: 'expired' };

    // Sans le secret privé, la connaissance du seul QR ne donne rien.
    if (!pollSecret || !safeEqualHex(sha256(pollSecret), entry.secretHash)) {
      return { status: 'expired' };
    }

    if (entry.status !== 'approved') {
      return { status: entry.status };
    }
    if (!entry.tokens || !entry.user) {
      return { status: 'expired' };
    }

    // Usage unique : les jetons ne sont remis qu'une fois, puis l'entrée meurt.
    await this.redis.del(redisKey(deviceCode));

    return {
      status: 'approved',
      tokens: entry.tokens,
      user: entry.user,
      ...(entry.encryptedKeyPayload && { encryptedKeyPayload: entry.encryptedKeyPayload }),
    };
  }
}

export const remoteAuthService = new RemoteAuthService();
