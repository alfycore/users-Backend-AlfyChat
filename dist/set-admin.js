"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
(async () => {
    const username = process.argv[2] || 'wiltark';
    const pool = promise_1.default.createPool({
        host: process.env.DB_HOST || '51.254.243.250',
        port: Number(process.env.DB_PORT) || 3940,
        user: process.env.DB_USER || 'alfychat',
        password: process.env.DB_PASSWORD || 'CzeZiC0p2cLM82LhHVby',
        database: process.env.DB_NAME || 'alfyv2',
    });
    // Vérifier que l'utilisateur existe
    const [check] = await pool.execute('SELECT id, username, role FROM users WHERE username = ?', [username]);
    if (check.length === 0) {
        console.error(`❌ Utilisateur "${username}" introuvable en base.`);
        await pool.end();
        process.exit(1);
    }
    const [result] = await pool.execute("UPDATE users SET role='admin' WHERE username = ?", [username]);
    console.log(`✅ ${result.affectedRows} ligne(s) mise(s) à jour.`);
    const [rows] = await pool.execute('SELECT id, username, email, role FROM users WHERE username = ?', [username]);
    console.log('👤 Utilisateur :', rows[0]);
    await pool.end();
    process.exit(0);
})();
//# sourceMappingURL=set-admin.js.map