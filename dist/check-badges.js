"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
async function main() {
    const pool = promise_1.default.createPool({
        host: 'localhost',
        user: 'alfychat',
        password: 'alfychat123',
        database: 'alfyv2',
    });
    const [rows] = await pool.execute('SELECT username, badges FROM users WHERE badges IS NOT NULL AND LENGTH(badges) > 5 LIMIT 5');
    for (const row of rows) {
        console.log('User:', row.username);
        console.log('Badges (raw):', row.badges);
        console.log('Type:', typeof row.badges);
        try {
            const parsed = typeof row.badges === 'string' ? JSON.parse(row.badges) : row.badges;
            console.log('Parsed:', JSON.stringify(parsed, null, 2));
        }
        catch (e) {
            console.log('Parse error:', e);
        }
        console.log('---');
    }
    await pool.end();
}
main().catch(console.error);
//# sourceMappingURL=check-badges.js.map