// ==========================================
// ALFYCHAT — Hachage de mot de passe
// ==========================================
// `bcryptjs` est une réimplémentation en JavaScript pur : pas de binding natif,
// pas de thread pool. Un hash au coût 12 représente 250 à 400 ms de CPU
// BLOQUANT sur le thread principal — pendant lesquelles le service users ne
// répond plus à personne, ni aux profils, ni aux vérifications de modération
// que le gateway appelle à chaque connexion socket.
//
// Le module natif `bcrypt` produit et vérifie exactement le même format de
// hash ($2a$/$2b$), mais délègue le calcul au thread pool de libuv : l'event
// loop reste libre. On le charge s'il est disponible, sinon on retombe sur
// `bcryptjs` — aucun risque de rupture si le binaire natif ne compile pas sur
// la plateforme de déploiement.

import bcryptjs from 'bcryptjs';

type BcryptLike = {
  hash(data: string, rounds: number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
};

let impl: BcryptLike = bcryptjs as unknown as BcryptLike;
let usingNative = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const native = require('bcrypt');
  if (native && typeof native.hash === 'function' && typeof native.compare === 'function') {
    impl = native as BcryptLike;
    usingNative = true;
  }
} catch {
  // Module natif absent ou non compilé pour cette plateforme — repli JS.
}

export const PASSWORD_ROUNDS = 12;

/** Indique quelle implémentation est active (journalisé au démarrage). */
export const passwordBackend = usingNative ? 'bcrypt (natif)' : 'bcryptjs (JS pur — bloque l\'event loop)';

export function hashPassword(plain: string): Promise<string> {
  return impl.hash(plain, PASSWORD_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return impl.compare(plain, hash);
}

/**
 * Hash factice, utilisé pour égaliser le temps de réponse quand l'email n'existe
 * pas. Sans lui, une adresse inconnue répond immédiatement là où une adresse
 * connue coûte ~300 ms de bcrypt : l'écart est parfaitement mesurable et
 * transforme le message d'erreur générique en oracle d'existence de compte.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1eqRTfEUKmO2yTIbEKQ0rD7z4hcuaEy';

/** Consomme le même temps CPU qu'une vérification réelle, puis retourne false. */
export async function burnPasswordComparison(plain: string): Promise<false> {
  try {
    await impl.compare(plain, DUMMY_HASH);
  } catch {
    // peu importe le résultat : seul le temps passé compte
  }
  return false;
}
