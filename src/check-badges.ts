import mysql from 'mysql2/promise';

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'alfychat',
    password: 'alfychat123',
    database: 'alfyv2',
  });

  const [rows] = await pool.execute(
    'SELECT username, badges FROM users WHERE badges IS NOT NULL AND LENGTH(badges) > 5 LIMIT 5'
  );

  for (const row of rows as any[]) {
    console.log('User:', row.username);
    console.log('Badges (raw):', row.badges);
    console.log('Type:', typeof row.badges);
    try {
      const parsed = typeof row.badges === 'string' ? JSON.parse(row.badges) : row.badges;
      console.log('Parsed:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Parse error:', e);
    }
    console.log('---');
  }

  await pool.end();
}

main().catch(console.error);
