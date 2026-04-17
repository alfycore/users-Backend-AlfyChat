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
      connectionLimit: 10,
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
      role ENUM('user', 'moderator', 'admin', 'support_l1', 'support_l2', 'technician') DEFAULT 'user',
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
      icon_type ENUM('bootstrap', 'svg', 'flaticon') DEFAULT 'bootstrap',
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
    { column: 'role', sql: `ALTER TABLE users ADD COLUMN role ENUM('user', 'moderator', 'admin', 'support_l1', 'support_l2', 'technician') DEFAULT 'user' AFTER show_badges` },
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
    `ALTER TABLE user_preferences ADD COLUMN layout_prefs JSON NULL`,
    `ALTER TABLE user_preferences ADD COLUMN wallpaper TEXT NULL`,
  ];
  for (const sql of prefsAlterations) {
    try {
      await db.execute(sql);
    } catch {
      // Ignorer si la colonne existe déjà
    }
  }

  // Migration — Ajouter 'flaticon' à l'ENUM icon_type des badges personnalisés
  try {
    await db.execute(`ALTER TABLE custom_badges MODIFY COLUMN icon_type ENUM('bootstrap', 'svg', 'flaticon') DEFAULT 'bootstrap'`);
  } catch {
    // ignore si déjà à jour
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

  // ==========================================
  // NOUVELLES FEATURES — PRIVACY & CUSTOMISATION
  // ==========================================

  // Profile card: image personnalisée affichée sur le profil
  // Music presence: JSON { title, artist, coverUrl, platform, startedAt }
  const newUserCols = [
    `ALTER TABLE users ADD COLUMN profile_card_url TEXT NULL`,
    `ALTER TABLE users ADD COLUMN music_presence JSON NULL`,
  ];
  for (const sql of newUserCols) {
    try { await db.execute(sql); } catch (e: any) {
      if (e?.errno !== 1060) console.log('User new cols migration warning:', e?.message);
    }
  }

  // activity_visibility_exceptions: masquer le statut en ligne à certains users
  await db.execute(
    `CREATE TABLE IF NOT EXISTS activity_visibility_exceptions (
      user_id VARCHAR(36) NOT NULL,
      hidden_from_user_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, hidden_from_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (hidden_from_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // user_favorites: emojis/stickers/gifs favoris avec ordre personnalisable
  await db.execute(
    `CREATE TABLE IF NOT EXISTS user_favorites (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      type ENUM('emoji', 'sticker', 'gif') NOT NULL,
      value VARCHAR(500) NOT NULL,
      position INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_fav (user_id, type, value),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_type (user_id, type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // pinned_conversations: DMs épinglés en haut de la liste
  await db.execute(
    `CREATE TABLE IF NOT EXISTS pinned_conversations (
      user_id VARCHAR(36) NOT NULL,
      conversation_id VARCHAR(100) NOT NULL,
      pin_order INT DEFAULT 0,
      pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, conversation_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_pinned (user_id, pin_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // ==========================================
  // HELPDESK — Tickets de support
  // ==========================================
  await db.execute(
    `CREATE TABLE IF NOT EXISTS helpdesk_tickets (
      id VARCHAR(36) PRIMARY KEY,
      ticket_number INT UNSIGNED AUTO_INCREMENT UNIQUE,
      subject VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status ENUM('open', 'pending', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
      priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
      category ENUM('general', 'technical', 'billing', 'account', 'abuse', 'feature', 'other') DEFAULT 'general',
      requester_id VARCHAR(36) NOT NULL,
      assigned_to VARCHAR(36) NULL,
      closed_at TIMESTAMP NULL DEFAULT NULL,
      resolved_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_status (status),
      INDEX idx_priority (priority),
      INDEX idx_requester (requester_id),
      INDEX idx_assigned (assigned_to),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS helpdesk_messages (
      id VARCHAR(36) PRIMARY KEY,
      ticket_id VARCHAR(36) NOT NULL,
      author_id VARCHAR(36) NOT NULL,
      content TEXT NOT NULL,
      is_internal BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES helpdesk_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_ticket (ticket_id),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // Migration role ENUM pour inclure les rôles support
  try {
    await db.execute(`ALTER TABLE users MODIFY COLUMN role ENUM('user', 'moderator', 'admin', 'support_l1', 'support_l2', 'technician') DEFAULT 'user'`);
  } catch (e: any) {
    if (e?.errno !== 1060) console.log('[DB] role enum migration:', e?.message);
  }

  // ==========================================
  // CENTRE D'AIDE — Contenu éditable
  // ==========================================

  // Catégories du centre d'aide
  await db.execute(`
    CREATE TABLE IF NOT EXISTS support_categories (
      id VARCHAR(36) PRIMARY KEY,
      slug VARCHAR(100) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      icon_name VARCHAR(80) DEFAULT 'circle-help',
      color VARCHAR(20) DEFAULT '#6366f1',
      sort_order INT DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_slug (slug),
      INDEX idx_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Articles du centre d'aide
  await db.execute(`
    CREATE TABLE IF NOT EXISTS support_articles (
      id VARCHAR(36) PRIMARY KEY,
      category_id VARCHAR(36) NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      summary TEXT,
      content MEDIUMTEXT,
      tags JSON NULL,
      is_published BOOLEAN DEFAULT TRUE,
      is_pinned BOOLEAN DEFAULT FALSE,
      view_count INT UNSIGNED DEFAULT 0,
      sort_order INT DEFAULT 0,
      author_id VARCHAR(36) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES support_categories(id) ON DELETE SET NULL,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_category (category_id),
      INDEX idx_slug (slug),
      INDEX idx_published (is_published),
      INDEX idx_views (view_count)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Annonces & incidents
  await db.execute(`
    CREATE TABLE IF NOT EXISTS support_announcements (
      id VARCHAR(36) PRIMARY KEY,
      type ENUM('incident','maintenance','news') DEFAULT 'news',
      title VARCHAR(255) NOT NULL,
      summary TEXT,
      content TEXT NULL,
      is_resolved BOOLEAN DEFAULT FALSE,
      is_published BOOLEAN DEFAULT TRUE,
      published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_published (is_published),
      INDEX idx_pub_date (published_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Problèmes connus
  await db.execute(`
    CREATE TABLE IF NOT EXISTS support_known_issues (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      status ENUM('investigating','in_progress','resolved') DEFAULT 'investigating',
      category_label VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migration : requester_id nullable pour tickets invités + email
  try {
    await db.execute(`ALTER TABLE helpdesk_tickets MODIFY COLUMN requester_id VARCHAR(36) NULL`);
  } catch (e: any) { if (e?.errno !== 1265 && e?.errno !== 1292) console.log('[DB] helpdesk requester_id:', e?.message); }
  try {
    await db.execute(`ALTER TABLE helpdesk_tickets ADD COLUMN requester_email VARCHAR(255) NULL DEFAULT NULL`);
  } catch (e: any) { if (e?.errno !== 1060) console.log('[DB] helpdesk requester_email already exists'); }

  // ── Données initiales (INSERT IGNORE) ──────────────────────────────────
  // Catégories par défaut
  const cats: Array<[string,string,string,string,string,string,number]> = [
    ['cat-securite', 'securite', 'Sécurité, confidentialité et politiques',
     'Gardez un environnement sûr et sécurisé pour vous et vos amis.', 'shield', '#6366f1', 1],
    ['cat-compte', 'compte', 'Paramètres du compte',
     'Personnalisez votre profil, vos options de sécurité, vos notifications et plus encore.', 'settings', '#0ea5e9', 2],
    ['cat-serveurs', 'serveurs', 'Paramètres du serveur',
     'Presque aussi passionnant que de la décoration intérieure.', 'server', '#8b5cf6', 3],
    ['cat-general', 'general', 'Questions générales',
     'Premières questions, fonctionnement d\'AlfyChat, accès et inscription.', 'circle-help', '#22c55e', 4],
  ];
  for (const [id, slug, title, desc, icon, color, order] of cats) {
    await db.execute(
      `INSERT IGNORE INTO support_categories (id, slug, title, description, icon_name, color, sort_order) VALUES (?,?,?,?,?,?,?)`,
      [id, slug, title, desc, icon, color, order]
    );
  }

  // Articles par défaut — Sécurité
  const articlesSecurite: Array<[string,string,string,string,string,string,number]> = [
    ['art-e2ee', 'activer-e2ee', 'Activer le chiffrement de bout en bout (E2EE)',
     'Activez le chiffrement de niveau 3 (Signal Protocol) sur vos conversations directes.',
     `AlfyChat propose trois niveaux de chiffrement. Le niveau 3 (E2EE complet) utilise le **protocole Signal** : vos clés ne quittent jamais votre appareil.\n\nPour l'activer : ouvrez **Paramètres > Sécurité > Chiffrement**. Cochez "Activer le chiffrement de bout en bout" et confirmez avec votre mot de passe.\n\n> ⚠️ En niveau 3, si vous perdez votre phrase de récupération, l'accès à vos messages anciens est définitivement perdu. Sauvegardez-la hors ligne.`,
     '["E2EE","Signal Protocol","Chiffrement"]', 1],
    ['art-signaler', 'signaler-abus', 'Signaler un utilisateur ou un contenu abusif',
     'Procédure pour signaler un comportement inapproprié, du harcèlement ou du contenu illégal.',
     `Pour signaler un **utilisateur** : faites un clic droit sur son avatar > **Signaler**. Sélectionnez la raison et ajoutez un commentaire optionnel.\n\nPour signaler un **message** : cliquez sur les trois points à côté du message > **Signaler ce message**.\n\nVotre signalement est traité sous 24 heures ouvrées par notre équipe de modération. Vous recevrez une notification par email.`,
     '["Signalement","Modération","Abus"]', 2],
    ['art-rgpd', 'vie-privee', 'Vie privée et données personnelles',
     'Ce que nous collectons, comment nous l\'utilisons et vos droits RGPD.',
     `AlfyChat collecte uniquement les données nécessaires : email, nom d'utilisateur, messages et fichiers partagés. **Aucune donnée de profilage publicitaire**.\n\nVos données sont hébergées en France (OVH Cloud), jamais transférées hors UE sans votre consentement explicite.\n\nVous pouvez exercer vos droits RGPD (accès, rectification, effacement, portabilité) depuis **Paramètres > Mon compte > Données personnelles**.`,
     '["RGPD","Données","Vie privée"]', 3],
    ['art-suspension', 'compte-suspendu', 'Que faire si mon compte est suspendu ?',
     'Comprendre les raisons d\'une suspension et comment contester une décision.',
     `Un compte peut être suspendu pour violation des CGU : harcèlement, spam, partage de contenu illégal ou usurpation d'identité.\n\nVous recevez un email détaillant la raison et la durée de la suspension. Les suspensions temporaires vont de **24h à 30 jours**. Les permanentes nécessitent des infractions graves.\n\nPour contester : répondez à l'email de notification ou ouvrez un ticket en sélectionnant **"Contestation de suspension"**.`,
     '["Suspension","Modération","Contestation"]', 4],
    ['art-2fa', 'activer-2fa', 'Activer l\'authentification à deux facteurs (2FA)',
     'Sécurisez votre compte avec une seconde couche de vérification TOTP.',
     `La 2FA est fortement recommandée pour protéger votre compte contre les accès non autorisés.\n\nPour l'activer : **Paramètres > Sécurité > Authentification à deux facteurs**. Scannez le QR code avec Google Authenticator, Authy ou toute autre app TOTP.\n\nConservez vos codes de secours dans un endroit sûr. En cas de perte, la récupération nécessite une **vérification d'identité manuelle** par notre équipe.`,
     '["2FA","TOTP","Sécurité"]', 5],
    ['art-motdepasse', 'changer-mot-de-passe', 'Modifier son mot de passe ou récupérer l\'accès',
     'Changer son mot de passe, réinitialiser l\'accès ou gérer une connexion suspecte.',
     `Pour changer votre mot de passe : **Paramètres > Sécurité > Changer le mot de passe**. Vous devez confirmer l'ancien.\n\nSi vous avez oublié votre mot de passe, utilisez le lien **"Mot de passe oublié"** sur la page de connexion. Un lien de réinitialisation est envoyé par email (valable **30 minutes**).\n\nSi vous suspectez une connexion suspecte, déconnectez toutes les sessions actives depuis **Paramètres > Sécurité > Sessions actives**.`,
     '["Mot de passe","Récupération","Sessions"]', 6],
  ];
  for (const [id, slug, title, summary, content, tags, order] of articlesSecurite) {
    await db.execute(
      `INSERT IGNORE INTO support_articles (id, category_id, slug, title, summary, content, tags, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
      [id, 'cat-securite', slug, title, summary, content, tags, order]
    );
  }

  // Articles par défaut — Compte
  const articlesCompte: Array<[string,string,string,string,string,string,number]> = [
    ['art-profil', 'modifier-profil', 'Modifier son profil (avatar, pseudo, bio)',
     'Changer votre photo de profil, nom d\'affichage, statut personnalisé et bio.',
     `Rendez-vous dans **Paramètres > Mon profil**. Vous pouvez modifier votre nom d'affichage, votre pseudo (une fois tous les 30 jours), votre bio et votre statut personnalisé.\n\nPour changer votre avatar : cliquez sur votre avatar actuel > **Modifier la photo**. Formats acceptés : JPG, PNG, GIF animé (max 8 Mo). L'image est automatiquement optimisée en WebP.\n\nVotre pseudo (@username) doit être unique et ne peut être changé que **tous les 30 jours**.`,
     '["Profil","Avatar","Pseudo"]', 1],
    ['art-email', 'changer-email', 'Changer son adresse email ou mot de passe',
     'Mettre à jour vos identifiants de connexion en toute sécurité.',
     `Pour changer votre **email** : **Paramètres > Compte > Adresse email**. Entrez la nouvelle adresse et confirmez avec votre mot de passe. Un email de vérification sera envoyé.\n\nPour changer votre **mot de passe** : **Paramètres > Sécurité > Mot de passe**. Le nouveau doit comporter au moins 10 caractères, une majuscule et un caractère spécial.\n\nSi vous avez activé la 2FA, les changements d'email nécessitent également une confirmation 2FA.`,
     '["Email","Mot de passe","Sécurité"]', 2],
    ['art-notifs', 'notifications', 'Gérer les notifications et alertes',
     'Personnaliser quand et comment AlfyChat vous notifie.',
     `Accédez à **Paramètres > Notifications**. Vous pouvez activer/désactiver les notifications pour : messages directs, mentions, réponses, réactions, appels entrants.\n\nVous pouvez désactiver les emails marketing depuis **Paramètres > Notifications > Emails**.\n\nChaque serveur possède ses propres paramètres de notification (clic droit sur le serveur > **Paramètres de notification**).`,
     '["Notifications","Push","Email"]', 3],
    ['art-apparence', 'apparence', 'Apparence : thème, langue et accessibilité',
     'Choisir le thème sombre ou clair, la langue et les options d\'accessibilité.',
     `Rendez-vous dans **Paramètres > Apparence**. AlfyChat propose un thème sombre, clair et automatique (suit les préférences système).\n\nLa langue peut être changée depuis **Paramètres > Apparence > Langue**. AlfyChat est disponible en français, anglais, espagnol et allemand.\n\nPour l'accessibilité, vous pouvez augmenter la taille du texte, activer le mode contraste élevé et désactiver les animations depuis **Paramètres > Accessibilité**.`,
     '["Thème","Langue","Accessibilité"]', 4],
    ['art-export', 'exporter-donnees', 'Exporter mes données personnelles',
     'Télécharger une copie de toutes vos données conformément au RGPD.',
     `AlfyChat vous permet d'exporter l'intégralité de vos données : messages, fichiers, informations de profil, historique d'activité.\n\nPour demander une exportation : **Paramètres > Mon compte > Données personnelles > Exporter mes données**. L'archive vous sera envoyée par email sous **48 heures ouvrées**.\n\nL'archive est au format ZIP avec des fichiers JSON. Les messages chiffrés en niveau 3 ne peuvent pas être inclus (les clés ne sont pas stockées par nos serveurs).`,
     '["RGPD","Export","Données"]', 5],
    ['art-supprimer', 'supprimer-compte', 'Supprimer définitivement son compte',
     'Procédure de suppression irréversible de votre compte et de toutes vos données.',
     `> ⚠️ La suppression de compte est **irréversible**. Toutes vos données seront effacées dans les **30 jours** suivant la demande.\n\nPour supprimer votre compte : **Paramètres > Mon compte > Supprimer mon compte**. Vous devrez confirmer avec votre mot de passe et répondre à un email de confirmation.\n\nPendant les 30 jours suivant la demande, votre compte est désactivé mais récupérable. Reconnectez-vous pour annuler la suppression.`,
     '["Suppression","RGPD","Compte"]', 6],
  ];
  for (const [id, slug, title, summary, content, tags, order] of articlesCompte) {
    await db.execute(
      `INSERT IGNORE INTO support_articles (id, category_id, slug, title, summary, content, tags, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
      [id, 'cat-compte', slug, title, summary, content, tags, order]
    );
  }

  // Articles par défaut — Serveurs
  const articlesServeurs: Array<[string,string,string,string,string,string,number]> = [
    ['art-creer-srv', 'creer-serveur', 'Créer et configurer un serveur',
     'Démarrer votre propre communauté : créer un serveur, le personnaliser et inviter des membres.',
     `Pour créer un serveur : cliquez sur **"+"** dans la barre de navigation > **Créer un serveur**. Choisissez un nom, une icône et une catégorie.\n\nConfigurez votre serveur depuis **Paramètres du serveur** (clic droit sur l'icône) : description publique, région de voix, langue par défaut.\n\nVotre serveur est privé par défaut. Pour le rendre découvrable dans l'annuaire, accédez à **Paramètres > Découvrabilité** (nécessite au minimum **10 membres**).`,
     '["Serveur","Création","Configuration"]', 1],
    ['art-invitations', 'invitations-serveur', 'Créer et gérer des liens d\'invitation',
     'Générer des liens d\'invitation permanents ou temporaires avec des limites d\'utilisation.',
     `Pour inviter des membres : clic droit sur un salon > **Inviter des personnes**. Personnalisez la durée (1h à permanent) et le nombre maximum d'utilisations.\n\nLes liens sont liés à un salon spécifique. Les nouveaux membres rejoindront directement ce salon.\n\nGérez tous les liens actifs depuis **Paramètres du serveur > Invitations**. Vous pouvez révoquer un lien à tout moment.`,
     '["Invitation","Liens","Partage"]', 2],
    ['art-roles', 'membres-roles', 'Gérer les membres et les rôles',
     'Attribuer des rôles, définir des permissions et modérer les membres.',
     `Pour créer un rôle : **Paramètres du serveur > Rôles > Créer un rôle**. Définissez un nom, une couleur et les permissions associées.\n\nLes permissions peuvent être définies au niveau du serveur ou par salon. Les **permissions de salon ont priorité** sur les rôles globaux.\n\nPour assigner un rôle : cliquez sur le membre > **Gérer les rôles**. Un membre peut avoir plusieurs rôles cumulatifs.`,
     '["Rôles","Permissions","Membres"]', 3],
    ['art-moderation', 'moderation-automatique', 'Configurer la modération automatique',
     'Protéger votre serveur avec des filtres anti-spam et des sanctions automatiques.',
     `AlfyChat propose une modération automatique depuis **Paramètres du serveur > Modération**. Filtrez les liens, les mentions excessives et les mots interdits.\n\nConfigurez des niveaux de vérification pour les nouveaux membres : aucun, email vérifié, ou compte de plus de 5 minutes.\n\nActions automatiques disponibles : suppression de message, avertissement, expulsion temporaire ou bannissement.`,
     '["Modération","Anti-spam","Filtres"]', 4],
    ['art-bots', 'ajouter-bots', 'Ajouter et configurer des bots',
     'Intégrer des bots AlfyChat ou tiers pour enrichir votre serveur.',
     `Pour ajouter un bot officiel : **Paramètres du serveur > Intégrations > Bots**. Parcourez la bibliothèque de bots AlfyChat ou entrez un identifiant de bot.\n\nVous pouvez développer votre propre bot via l'**API AlfyChat**. La documentation est disponible sur docs.alfycore.pro.\n\nChaque bot possède ses propres permissions. Limitez-les au strict nécessaire : **principe du moindre privilège**.`,
     '["Bots","Intégrations","API"]', 5],
    ['art-transfert', 'transfert-propriete', 'Transférer la propriété du serveur',
     'Passer le statut de propriétaire à un autre membre de confiance.',
     `Seul le propriétaire peut transférer la propriété. Allez dans **Paramètres du serveur > Membres** > cliquez sur le membre cible > **Transférer la propriété**.\n\nUn email de confirmation vous sera envoyé. Après le transfert, vous redevenez un membre avec vos rôles existants.\n\n> ⚠️ Le transfert est immédiat. Assurez-vous de faire confiance au nouveau propriétaire, car il aura accès à tous les paramètres, y compris la **suppression du serveur**.`,
     '["Propriétaire","Transfert","Administration"]', 6],
  ];
  for (const [id, slug, title, summary, content, tags, order] of articlesServeurs) {
    await db.execute(
      `INSERT IGNORE INTO support_articles (id, category_id, slug, title, summary, content, tags, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
      [id, 'cat-serveurs', slug, title, summary, content, tags, order]
    );
  }

  // Annonces initiales
  const announcements: Array<[string,string,string,string,string,boolean]> = [
    ['ann-001', 'incident', 'Résolution — Latence accrue sur les messages',
     "L'incident de latence observé entre 14h et 16h (heure de Paris) a été résolu. Les services fonctionnent normalement.",
     '2026-04-15 18:00:00', true],
    ['ann-002', 'maintenance', 'Maintenance planifiée — 20 avril 2026 à 2h du matin',
     "Une maintenance de 30 minutes est prévue pour la mise à jour des serveurs de médias. Un bref ralentissement est possible.",
     '2026-04-14 10:00:00', false],
    ['ann-003', 'news', 'Nouveauté — Chiffrement Signal Protocol disponible',
     "Le protocole Signal est maintenant disponible pour tous les utilisateurs. Activez-le dans Paramètres > Sécurité.",
     '2026-04-10 12:00:00', false],
  ];
  for (const [id, type, title, summary, pubDate, resolved] of announcements) {
    await db.execute(
      `INSERT IGNORE INTO support_announcements (id, type, title, summary, is_resolved, published_at) VALUES (?,?,?,?,?,?)`,
      [id, type, title, summary, resolved, pubDate]
    );
  }

  // Problèmes connus initiaux
  const knownIssues: Array<[string,string,string,string]> = [
    ['issue-001', 'Notifications de bureau ne s\'affichent pas sur Firefox',
     'investigating', 'Applications de bureau'],
    ['issue-002', 'Chargement lent des messages historiques sur mobile',
     'in_progress', 'Application mobile'],
    ['issue-003', 'Avatar non mis à jour après modification du profil',
     'resolved', 'Profil utilisateur'],
  ];
  for (const [id, title, status, catLabel] of knownIssues) {
    await db.execute(
      `INSERT IGNORE INTO support_known_issues (id, title, status, category_label) VALUES (?,?,?,?)`,
      [id, title, status, catLabel]
    );
  }
}

