// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// Authentification, préférences, RGPD
// ==========================================

import 'dotenv/config';
import path from 'path';
import { registerGlobalErrorHandlers } from './utils/error-reporter';
registerGlobalErrorHandlers();
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { usersRouter } from './routes/users';

import { rgpdRouter } from './routes/rgpd';
import { adminRouter } from './routes/admin';
import { keysRouter } from './routes/keys';
import { helpdeskRouter } from './routes/helpdesk';
import { publicHelpdeskRouter } from './routes/public-helpdesk';
import { publicSupportRouter } from './routes/support-public';
import { adminSupportRouter } from './routes/admin-support';
import { adminDevRouter } from './routes/admin-dev';
import { moderationRouter } from './routes/moderation';
import { moderationService } from './services/moderation.service';
import { startServiceRegistration, serviceMetricsMiddleware, collectServiceMetrics } from './utils/service-client';
import { getDatabaseClient, runMigrations } from './database';
import { getRedisClient } from './redis';
import { logger } from './utils/logger';
import { authRouter } from './routes/auth';
import { pushRouter } from './routes/push';
const app = express();
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: process.env.GATEWAY_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(serviceMetricsMiddleware);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
  // La connexion par QR sonde /auth/remote/poll toutes les 2 s pendant 120 s,
  // soit ~60 appels : sous ce plafond de 100, deux tentatives suffiraient à
  // bloquer la connexion classique de l'utilisateur. Ces routes portent leur
  // propre limiteur, plus adapté (voir routes/auth.ts).
  skip: (req) => req.path.startsWith('/remote/'),
});
app.use('/auth', limiter);

// Routes
app.use('/users', usersRouter);
app.use('/auth', authRouter);
app.use('/rgpd', rgpdRouter);
// Doit précéder /admin pour que /admin/moderation et /admin/dev ne soient pas captés par adminRouter
app.use('/admin/moderation', moderationRouter);
app.use('/admin/dev', adminDevRouter);
app.use('/admin', adminRouter);
app.use('/users/keys', keysRouter);
app.use('/helpdesk/public', publicHelpdeskRouter);
app.use('/helpdesk', helpdeskRouter);
app.use('/users/support', publicSupportRouter);
app.use('/admin/support', adminSupportRouter);
app.use('/push', pushRouter);
// Le gateway ne proxifie que `/api/users/*` (il retire juste le préfixe `/api`) :
// sans ce second montage, `/api/users/push/...` retombait sur usersRouter, qui
// n'a aucune route push, et finissait en 404 — les abonnements aux
// notifications étaient donc injoignables depuis le web comme depuis le mobile.
// Même procédé que `/users/keys` et `/users/support` ci-dessus.
app.use('/users/push', pushRouter);

// ── Endpoint interne — stats publiques (protégé par x-internal-secret) ───────
app.get('/internal/stats', async (req, res) => {
  const secret = req.headers['x-internal-secret'] as string | undefined;
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';
  if (!secret || secret !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  try {
    const db = getDatabaseClient();
    const [[totalRow]] = await db.query('SELECT COUNT(*) as count FROM users') as any;
    const [[onlineRow]] = await db.query('SELECT COUNT(*) as count FROM users WHERE is_online = TRUE') as any;
    res.json({ totalUsers: totalRow.count, onlineUsers: onlineRow.count });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Endpoint interne — statut de modération (protégé par x-internal-secret) ──
// Utilisé par le gateway pour refuser les connexions WS des comptes bannis.
app.get('/internal/moderation/:userId', async (req, res) => {
  const secret = req.headers['x-internal-secret'] as string | undefined;
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';
  if (!secret || secret !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  try {
    res.json(await moderationService.getStatus(req.params.userId));
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'users' });
});

app.get('/metrics', (req, res) => {
  res.json({
    service: 'users',
    serviceId: process.env.SERVICE_ID || 'users-default',
    location: (process.env.SERVICE_LOCATION || 'EU').toUpperCase(),
    ...collectServiceMetrics(),
    uptime: process.uptime(),
  });
});

// Initialisation
async function start() {
  try {
    // Connexion à la base de données
    const db = getDatabaseClient({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'alfychat',
      password: process.env.DB_PASSWORD || 'alfychat',
      database: process.env.DB_NAME || 'alfychat',
    });

    // Migrations automatiques au démarrage
    await runMigrations(db);

    // Charger les termes interdits personnalisés dans le filtre de pseudos
    await moderationService.reloadTerms();

    // Connexion à Redis
    getRedisClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      logger.info(`🚀 Service Users démarré sur le port ${PORT}`);
      startServiceRegistration('users');
    });
  } catch (error) {
    logger.error('Erreur au démarrage:', error);
    process.exit(1);
  }
}

// -- HTML error pages (browser content-negotiation) --------------------------
app.get('/', (req, res, next) => {
  if (req.accepts(['html', 'json']) === 'html')
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  next();
});
app.use((req, res) => {
  if (req.accepts(['html', 'json']) === 'html')
    return res.status(404).sendFile(path.join(__dirname, '../public/errors/404.html'));
  res.status(404).json({ error: 'Route not found', path: req.path });
});
app.use((err: any, req: any, res: any, _next: any) => {
  if (req.accepts(['html', 'json']) === 'html')
    return res.status(500).sendFile(path.join(__dirname, '../public/errors/500.html'));
  res.status(500).json({ error: 'Internal server error' });
});

start();

export default app;
