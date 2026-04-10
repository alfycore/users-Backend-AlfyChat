// ==========================================
// ALFYCHAT - DATABASE CLIENT (USERS SERVICE)
// ==========================================

import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

let pool: Pool | null = null;

export function getDatabaseClient(config?: DatabaseConfig) {
  if (!pool && config) {
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 30,
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 10000,
      idleTimeout: 60000,
    });
  }
  
  if (!pool) {
    throw new Error('Database not initialized');
  }

  return {
    async query<T extends RowDataPacket[]>(sql: string, params?: any[]): Promise<T[]> {
      const [rows] = await pool!.execute<T>(sql, params);
      return [rows];
    },

    async execute(sql: string, params?: any[]): Promise<ResultSetHeader> {
      const [result] = await pool!.execute<ResultSetHeader>(sql, params);
      return result;
    },

    async transaction<T>(callback: (conn: PoolConnection) => Promise<T>): Promise<T> {
      const connection = await pool!.getConnection();
      await connection.beginTransaction();

      try {
        const result = await callback(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

export async function runMigrations(db: ReturnType<typeof getDatabaseClient>): Promise<void> {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      username VARCHAR(32) UNIQUE NOT NULL,
      display_name VARCHAR(64),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      banner_url TEXT,
      bio TEXT,
      card_color VARCHAR(7) DEFAULT '#5865F2',
      show_badges BOOLEAN DEFAULT TRUE,
      role ENUM('user', 'moderator', 'admin') DEFAULT 'user',
      status ENUM('online', 'idle', 'dnd', 'invisible', 'offline') DEFAULT 'offline',
      is_online BOOLEAN DEFAULT FALSE,
      email_verified BOOLEAN DEFAULT FALSE,
      tutorial_completed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_username (username),
      INDEX idx_email (email),
      INDEX idx_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id VARCHAR(36) PRIMARY KEY,
      theme ENUM('light', 'dark', 'system') DEFAULT 'system',
      language VARCHAR(10) DEFAULT 'fr',
      encryption_level TINYINT DEFAULT 2,
      notifications_desktop BOOLEAN DEFAULT TRUE,
      notifications_sound BOOLEAN DEFAULT TRUE,
      notifications_mentions BOOLEAN DEFAULT TRUE,
      notifications_dm BOOLEAN DEFAULT TRUE,
      privacy_show_online BOOLEAN DEFAULT TRUE,
      privacy_allow_dm ENUM('everyone', 'friends', 'none') DEFAULT 'friends',
      privacy_allow_friend_requests BOOLEAN DEFAULT TRUE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS rgpd_consents (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      consent_type VARCHAR(50) NOT NULL,
      granted BOOLEAN DEFAULT FALSE,
      granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_consent (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS rgpd_deletion_requests (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      scheduled_deletion_at DATETIME NOT NULL,
      status ENUM('pending', 'processing', 'completed') DEFAULT 'pending',
      completed_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      refresh_token VARCHAR(500) NOT NULL,
      expires_at DATETIME NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_sessions (user_id),
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];

  for (const sql of migrations) {
    await db.execute(sql);
  }

  // Table pour badges personnalisés
  await db.execute(
    `CREATE TABLE IF NOT EXISTS custom_badges (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      icon_type ENUM('bootstrap', 'svg') DEFAULT 'bootstrap',
      icon_value TEXT NOT NULL,
      color VARCHAR(7) NOT NULL,
      display_order INT DEFAULT 999,
      is_active BOOLEAN DEFAULT TRUE,
      created_by VARCHAR(36),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_active (is_active),
      INDEX idx_order (display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Table pour les paramètres du site (inscription, etc.)
  await db.execute(
    `CREATE TABLE IF NOT EXISTS site_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Insérer les valeurs par défaut si elles n'existent pas
  await db.execute(
    `INSERT IGNORE INTO site_settings (setting_key, setting_value) VALUES ('registration_enabled', 'true')`
  );
  await db.execute(
    `INSERT IGNORE INTO site_settings (setting_key, setting_value) VALUES ('turnstile_enabled', 'false')`
  );

  // Table pour les liens d'inscription à usage unique
  await db.execute(
    `CREATE TABLE IF NOT EXISTS invite_links (
      id VARCHAR(36) PRIMARY KEY,
      code VARCHAR(64) UNIQUE NOT NULL,
      email VARCHAR(255) NOT NULL,
      created_by VARCHAR(36) NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      used_by VARCHAR(36) DEFAULT NULL,
      used_at TIMESTAMP NULL DEFAULT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_code (code),
      INDEX idx_email (email),
      INDEX idx_used (used)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Migrations incrémentales — ajout des colonnes manquantes
  const alterations = [
    { column: 'banner_url', sql: `ALTER TABLE users ADD COLUMN banner_url TEXT AFTER avatar_url` },
    { column: 'card_color', sql: `ALTER TABLE users ADD COLUMN card_color VARCHAR(7) DEFAULT '#5865F2' AFTER bio` },
    { column: 'show_badges', sql: `ALTER TABLE users ADD COLUMN show_badges BOOLEAN DEFAULT TRUE AFTER card_color` },
    { column: 'badges', sql: `ALTER TABLE users ADD COLUMN badges JSON DEFAULT NULL AFTER show_badges` },
    { column: 'role', sql: `ALTER TABLE users ADD COLUMN role ENUM('user', 'moderator', 'admin') DEFAULT 'user' AFTER show_badges` },
    { column: 'tutorial_completed', sql: `ALTER TABLE users ADD COLUMN tutorial_completed BOOLEAN DEFAULT FALSE AFTER email_verified` },
    { column: 'hidden_badge_ids', sql: `ALTER TABLE users ADD COLUMN hidden_badge_ids JSON DEFAULT NULL AFTER badges` },
  ];

  for (const alt of alterations) {
    try {
      await db.execute(alt.sql);
    } catch (err: any) {
      // Ignorer si la colonne existe déjà (ER_DUP_FIELDNAME)
      if (err.code !== 'ER_DUP_FIELDNAME') {
        // ignore silently
      }
    }
  }

  // Changer avatar_url de VARCHAR(500) à TEXT si nécessaire
  try {
    await db.execute(`ALTER TABLE users MODIFY COLUMN avatar_url TEXT`);
  } catch {
    // ignore
  }

  // Migrations incrémentales — nouvelles colonnes user_preferences
  const prefsAlterations = [
    `ALTER TABLE user_preferences ADD COLUMN birthday DATE NULL`,
    `ALTER TABLE user_preferences ADD COLUMN timezone VARCHAR(100) DEFAULT 'UTC'`,
    `ALTER TABLE user_preferences ADD COLUMN interests JSON NULL`,
    `ALTER TABLE user_preferences ADD COLUMN mic_mode VARCHAR(20) DEFAULT 'vad'`,
    `ALTER TABLE user_preferences ADD COLUMN font_family VARCHAR(50) DEFAULT 'geist'`,
    `ALTER TABLE user_preferences ADD COLUMN dnd_enabled BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE user_preferences ADD COLUMN notif_keywords JSON NULL`,
    `ALTER TABLE user_preferences ADD COLUMN quiet_start TEXT NULL`,
    `ALTER TABLE user_preferences ADD COLUMN quiet_end TEXT NULL`,
    `ALTER TABLE user_preferences ADD COLUMN vacation_start DATE NULL`,
    `ALTER TABLE user_preferences ADD COLUMN vacation_end DATE NULL`,
  ];
  for (const sql of prefsAlterations) {
    try {
      await db.execute(sql);
    } catch {
      // Ignorer si la colonne existe déjà
    }
  }

  // ==========================================
  // SIGNAL PROTOCOL — Tables E2EE (clés publiques uniquement)
  // Le serveur ne stocke JAMAIS les clés privées
  // ==========================================

  // Bundle de clés Signal (identity key + signed prekey)
  await db.execute(
    `CREATE TABLE IF NOT EXISTS signal_key_bundles (
      user_id VARCHAR(36) PRIMARY KEY,
      registration_id INT UNSIGNED NOT NULL,
      identity_key TEXT NOT NULL,
      signed_prekey_id INT UNSIGNED NOT NULL,
      signed_prekey_public TEXT NOT NULL,
      signed_prekey_signature TEXT NOT NULL,
      encrypted_private_bundle MEDIUMTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Migration : ajouter la colonne encrypted_private_bundle si elle n'existe pas encore
  try {
    await db.execute(
      `ALTER TABLE signal_key_bundles
       ADD COLUMN encrypted_private_bundle MEDIUMTEXT NULL`
    );
  } catch (e: any) {
    if (e?.errno !== 1060) console.log('ALTER migration warning:', e?.message);
  }

  // Migration : ajouter la colonne ecdh_key (clé publique P-256 pour ECDH direct)
  try {
    await db.execute(
      `ALTER TABLE signal_key_bundles
       ADD COLUMN ecdh_key TEXT NULL`
    );
  } catch (e: any) {
    if (e?.errno !== 1060) console.log('ALTER migration warning:', e?.message);
  }

  // One-time prekeys (consommées une par une lors de chaque nouvelle session X3DH)
  await db.execute(
    `CREATE TABLE IF NOT EXISTS signal_one_time_prekeys (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      prekey_id INT UNSIGNED NOT NULL,
      prekey_public TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_prekey (user_id, prekey_id),
      INDEX idx_user_id (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // ==========================================
  // VÉRIFICATION EMAIL — Tokens
  // ==========================================
  await db.execute(
    `CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      token VARCHAR(128) UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_token (token),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // ==========================================
  // 2FA TOTP — Colonnes sur la table users
  // ==========================================
  const twoFaAlterations = [
    `ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) NULL`,
    `ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN totp_backup_codes TEXT NULL`,
  ];
  for (const sql of twoFaAlterations) {
    try {
      await db.execute(sql);
    } catch (e: any) {
      if (e?.errno !== 1060) console.log('2FA migration warning:', e?.message);
    }
  }

  // ==========================================
  // E2EE Curve25519 — Colonnes sur la table users
  // ==========================================
  const e2eeAlterations = [
    `ALTER TABLE users ADD COLUMN public_key TEXT NULL`,
    `ALTER TABLE users ADD COLUMN encrypted_private_key TEXT NULL`,
    `ALTER TABLE users ADD COLUMN key_salt VARCHAR(64) NULL`,
  ];
  for (const sql of e2eeAlterations) {
    try {
      await db.execute(sql);
    } catch (e: any) {
      if (e?.errno !== 1060) console.log('E2EE migration warning:', e?.message);
    }
  }

  // ==========================================
  // CUSTOM STATUS (ALTER pour les DBs existantes)
  // ==========================================
  {
    const sqls = [
      `ALTER TABLE users ADD COLUMN custom_status VARCHAR(100) NULL DEFAULT NULL`,
    ];
    for (const sql of sqls) {
      try {
        await db.execute(sql);
      } catch (e: any) {
        if (e?.errno !== 1060) console.log('custom_status migration warning:', e?.message);
      }
    }
  }

  // ==========================================
  // CHANGELOGS
  // ==========================================
  await db.execute(
    `CREATE TABLE IF NOT EXISTS changelogs (
      id VARCHAR(36) PRIMARY KEY,
      version VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      type ENUM('feature', 'fix', 'improvement', 'security', 'breaking') DEFAULT 'feature',
      banner_url TEXT NULL,
      created_by VARCHAR(36) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created_at (created_at),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Migrations: banner_url column for changelogs
  try {
    await db.execute(`ALTER TABLE changelogs ADD COLUMN banner_url TEXT NULL DEFAULT NULL`);
  } catch (e: any) {
    if (e?.errno !== 1060) console.log('[DB] changelogs.banner_url already exists');
  }
}
