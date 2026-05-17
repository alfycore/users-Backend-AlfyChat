"use strict";
// ==========================================
// ALFYCHAT - CLIENT D'ENREGISTREMENT SERVICE
// Chaque microservice l'importe pour se déclarer au gateway
// et envoyer ses métriques périodiquement.
//
// Usage (dans le index.ts d'un service) :
//   import { startServiceRegistration } from './utils/service-client';
//   startServiceRegistration('messages');
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackRequest = trackRequest;
exports.collectServiceMetrics = collectServiceMetrics;
exports.startServiceRegistration = startServiceRegistration;
exports.serviceMetricsMiddleware = serviceMetricsMiddleware;
const os_1 = __importDefault(require("os"));
const v8_1 = __importDefault(require("v8"));
// Compteur de requêtes fenêtre 20min
const WINDOW_MS = 20 * 60 * 1000;
const _requestTs = [];
let _bytesOut = [];
/** Middleware Express à appeler dans chaque service pour compter les requêtes */
function trackRequest(bytes = 0) {
    const now = Date.now();
    _requestTs.push(now);
    if (bytes > 0)
        _bytesOut.push({ ts: now, bytes });
}
/** Collecte les métriques du process Node */
function collectServiceMetrics() {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    // Purge
    while (_requestTs.length && _requestTs[0] < cutoff)
        _requestTs.shift();
    _bytesOut = _bytesOut.filter((e) => e.ts >= cutoff);
    const mem = process.memoryUsage();
    const heapLimit = v8_1.default.getHeapStatistics().heap_size_limit;
    const cpus = os_1.default.cpus();
    let idle = 0, total = 0;
    for (const c of cpus) {
        for (const val of Object.values(c.times))
            total += val;
        idle += c.times.idle;
    }
    const cpuUsage = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
    const totalBytes = _bytesOut.reduce((s, e) => s + e.bytes, 0);
    return {
        ramUsage: mem.heapUsed,
        ramMax: heapLimit,
        cpuUsage,
        cpuMax: 100,
        bandwidthUsage: Math.round(totalBytes / (WINDOW_MS / 1000)),
        requestCount20min: _requestTs.length,
    };
}
/**
 * Démarre l'enregistrement + heartbeat auprès du gateway via le nouveau système LB.
 * Utilise SERVICE_KEY (sk_...) pour s'authentifier.
 * À appeler une fois dans le callback de `app.listen()`.
 */
function startServiceRegistration(serviceType) {
    const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
    const SERVICE_KEY = process.env.SERVICE_KEY || '';
    const SERVICE_ID = process.env.SERVICE_ID || '';
    const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';
    const SERVICE_ENDPOINT = process.env.SERVICE_ENDPOINT || '';
    let _registeredId = null;
    let _heartbeatTimer = null;
    async function register() {
        if (!SERVICE_KEY && !INTERNAL_SECRET) {
            console.warn(`[ServiceClient] SERVICE_KEY et INTERNAL_SECRET absents — service "${serviceType}" non enregistré`);
            return;
        }
        if (!SERVICE_ENDPOINT) {
            console.warn(`[ServiceClient] SERVICE_ENDPOINT absent — impossible de s'enregistrer`);
            return;
        }
        const useKey = !!SERVICE_KEY;
        const regHeaders = { 'Content-Type': 'application/json' };
        if (useKey)
            regHeaders['X-Service-Key'] = SERVICE_KEY;
        else
            regHeaders['X-Internal-Secret'] = INTERNAL_SECRET;
        const regBody = { endpoint: SERVICE_ENDPOINT };
        if (!useKey && SERVICE_ID)
            regBody.serviceId = SERVICE_ID;
        try {
            const res = await fetch(`${GATEWAY_URL}/api/lb/register`, {
                method: 'POST',
                headers: regHeaders,
                body: JSON.stringify(regBody),
                signal: AbortSignal.timeout(8000),
            });
            const data = await res.json();
            if (res.ok && data.serviceId) {
                _registeredId = data.serviceId;
                console.info(`[ServiceClient] Connecté — serviceId: ${_registeredId} via ${data.gatewayId}`);
                startHeartbeat();
            }
            else {
                console.error(`[ServiceClient] Enregistrement refusé: ${data.error ?? JSON.stringify(data)}`);
                console.warn(`[ServiceClient] → Vérifiez SERVICE_KEY dans votre .env et que le service est créé dans l'admin panel`);
            }
        }
        catch (err) {
            console.error('[ServiceClient] Erreur réseau lors de l\'enregistrement:', err);
            setTimeout(register, 15_000);
        }
    }
    async function heartbeat() {
        if (!_registeredId)
            return;
        if (!SERVICE_KEY && !INTERNAL_SECRET)
            return;
        const hbHeaders = { 'Content-Type': 'application/json' };
        if (SERVICE_KEY)
            hbHeaders['X-Service-Key'] = SERVICE_KEY;
        else
            hbHeaders['X-Internal-Secret'] = INTERNAL_SECRET;
        const hbBody = { metrics: collectServiceMetrics() };
        if (!SERVICE_KEY)
            hbBody.serviceId = _registeredId;
        try {
            const res = await fetch(`${GATEWAY_URL}/api/lb/heartbeat`, {
                method: 'POST',
                headers: hbHeaders,
                body: JSON.stringify(hbBody),
                signal: AbortSignal.timeout(5000),
            });
            if (res.status === 403) {
                if (_heartbeatTimer) {
                    clearInterval(_heartbeatTimer);
                    _heartbeatTimer = null;
                }
                return;
            }
            if (res.status === 404) {
                console.warn('[ServiceClient] Service inconnu du gateway — ré-enregistrement...');
                _registeredId = null;
                if (_heartbeatTimer) {
                    clearInterval(_heartbeatTimer);
                    _heartbeatTimer = null;
                }
                setTimeout(register, 3000);
            }
        }
        catch { /* non bloquant */ }
    }
    function startHeartbeat() {
        if (_heartbeatTimer)
            clearInterval(_heartbeatTimer);
        _heartbeatTimer = setInterval(heartbeat, 30_000);
        if (_heartbeatTimer.unref)
            _heartbeatTimer.unref();
    }
    // Démarrage différé pour laisser le serveur s'initialiser
    setTimeout(register, 2_000);
    // Ré-essai si pas encore enregistré après 15s
    setTimeout(() => { if (!_registeredId)
        register(); }, 15_000);
}
/**
 * Middleware Express léger pour compter les requêtes et le débit.
 * À placer en début de pipeline : app.use(serviceMetricsMiddleware)
 */
function serviceMetricsMiddleware(req, res, next) {
    const origJson = res.json?.bind(res);
    const origSend = res.send?.bind(res);
    const track = (body) => {
        try {
            const bytes = typeof body === 'string' ? Buffer.byteLength(body) :
                Buffer.isBuffer(body) ? body.length :
                    Buffer.byteLength(JSON.stringify(body));
            trackRequest(bytes);
        }
        catch {
            trackRequest(0);
        }
    };
    if (origJson)
        res.json = (b) => { track(b); return origJson(b); };
    if (origSend)
        res.send = (b) => { track(b); return origSend(b); };
    trackRequest(0);
    next();
}
//# sourceMappingURL=service-client.js.map