import mysql from 'mysql2/promise';

(async () => {
  const username = process.argv[2] || 'wiltark';

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'alfychat',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'alfychat',
  });

  // Vérifier que l'utilisateur existe
  const [check] = await pool.execute(
    'SELECT id, username, role FROM users WHERE username = ?',
    [username]
  );
  if ((check as any[]).length === 0) {
    console.error(`❌ Utilisateur "${username}" introuvable en base.`);
    await pool.end();
    process.exit(1);
  }

  const [result] = await pool.execute(
    "UPDATE users SET role='admin' WHERE username = ?",
    [username]
  );
  console.log(`✅ ${(result as any).affectedRows} ligne(s) mise(s) à jour.`);

  const [rows] = await pool.execute(
    'SELECT id, username, email, role FROM users WHERE username = ?',
    [username]
  );
  console.log('👤 Utilisateur :', (rows as any[])[0]);

  await pool.end();
  process.exit(0);
})();

