"use strict";
// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// Authentification, préférences, RGPD
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = __importDefault(require("dotenv"));
const users_1 = require("./routes/users");
const auth_1 = require("./routes/auth");
const rgpd_1 = require("./routes/rgpd");
const admin_1 = require("./routes/admin");
const keys_1 = require("./routes/keys");
const database_1 = require("./database");
const redis_1 = require("./redis");
const logger_1 = require("./utils/logger");
dotenv_1.default.config();
const app = (0, express_1.default)();
// Middleware
app.use((0, cors_1.default)({
    origin: process.env.GATEWAY_URL || 'http://localhost:3000',
    credentials: true,
}));
app.use((0, helmet_1.default)());
app.use(express_1.default.json());
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Trop de requêtes, réessayez plus tard' },
});
app.use('/auth', limiter);
// Routes
app.use('/users', users_1.usersRouter);
app.use('/auth', auth_1.authRouter);
app.use('/rgpd', rgpd_1.rgpdRouter);
app.use('/admin', admin_1.adminRouter);
app.use('/users/keys', keys_1.keysRouter);
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'users' });
});
// Initialisation
async function start() {
    try {
        // Connexion à la base de données
        const db = (0, database_1.getDatabaseClient)({
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '3306'),
            user: process.env.DB_USER || 'alfychat',
            password: process.env.DB_PASSWORD || 'alfychat',
            database: process.env.DB_NAME || 'alfychat',
        });
        // Exécuter les migrations
        await (0, database_1.runMigrations)(db);
        // Connexion à Redis
        (0, redis_1.getRedisClient)({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
        });
        const PORT = process.env.PORT || 3001;
        app.listen(PORT, () => {
            logger_1.logger.info(`🚀 Service Users démarré sur le port ${PORT}`);
        });
    }
    catch (error) {
        logger_1.logger.error('Erreur au démarrage:', error);
        process.exit(1);
    }
}
start();
exports.default = app;
//# sourceMappingURL=index.js.map