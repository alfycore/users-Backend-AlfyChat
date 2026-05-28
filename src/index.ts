// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// Authentification, préférences, RGPD
// ==========================================

import 'dotenv/config';
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
});
app.use('/auth', limiter);

// Routes
app.use('/users', usersRouter);
app.use('/auth', authRouter);
app.use('/rgpd', rgpdRouter);
app.use('/admin', adminRouter);
app.use('/users/keys', keysRouter);
app.use('/helpdesk/public', publicHelpdeskRouter);
app.use('/helpdesk', helpdeskRouter);
app.use('/users/support', publicSupportRouter);
app.use('/admin/support', adminSupportRouter);
app.use('/push', pushRouter);

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

start();

export default app;
