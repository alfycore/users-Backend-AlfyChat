// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// Authentification, préférences, RGPD
// ==========================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { usersRouter } from './routes/users';
import { authRouter } from './routes/auth';
import { rgpdRouter } from './routes/rgpd';
import { adminRouter } from './routes/admin';
import { keysRouter } from './routes/keys';
import { startServiceRegistration, serviceMetricsMiddleware, collectServiceMetrics } from './utils/service-client';
import { getDatabaseClient, runMigrations } from './database';
import { getRedisClient } from './redis';
import { logger } from './utils/logger';

dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.GATEWAY_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(helmet());
app.use(express.json());
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

    // Exécuter les migrations
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
