// ==========================================
// ALFYCHAT - IP CLIENT RÉELLE
// ==========================================
// Les requêtes arrivent du gateway : `req.ip` vaut donc l'IP du gateway pour
// tout le monde. Le limiteur de /auth (100 req / 15 min) était ainsi partagé
// par TOUTE la plateforme, et l'IP enregistrée dans les sessions / affichée
// lors d'une connexion par QR était celle du gateway.
//
// Le gateway transmet l'IP réelle dans `x-client-ip`, signée par HMAC avec le
// secret interne (`x-client-ip-sig`). Sans signature valide, on retombe sur
// `req.ip` : un appel direct au service ne peut pas choisir son IP.

import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

function normalizeIP(ip: string | undefined): string {
  if (!ip) return 'inconnu';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

export function getClientIp(req: Request): string {
  const ip = req.headers['x-client-ip'];
  const sig = req.headers['x-client-ip-sig'];
  const secret = process.env.INTERNAL_SECRET;
  if (typeof ip === 'string' && typeof sig === 'string' && secret && ip.length <= 64) {
    const expected = createHmac('sha256', secret).update(`client-ip:${ip}`).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return normalizeIP(ip);
  }
  return normalizeIP(req.ip);
}
