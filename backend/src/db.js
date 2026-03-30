import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_USERNAME = '__legacy__';
const LEGACY_PENDING_HASH = '__legacy_pending__';

export function initDatabase() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'wa-controller.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  ensureUsersTable(db);

  if (needsLegacyMigration(db)) {
    migrateLegacySchema(db);
  }

  ensureCurrentTables(db);
  ensureIndexes(db);

  // Double-check config table has user_id after migration (defensive)
  try {
    if (!hasColumn(db, 'config', 'user_id')) {
      console.log('⚠️ Config table still missing user_id after migration — forcing fix');
      db.pragma('foreign_keys = OFF');
      try {
        const rows = db.prepare('SELECT key, value FROM config').all();
        db.exec('DROP TABLE config');
        db.exec(`
          CREATE TABLE config (
            user_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            PRIMARY KEY (user_id, key)
          );
        `);
        // Re-insert with first user's ID
        const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
        if (firstUser && rows.length > 0) {
          const insert = db.prepare('INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)');
          for (const row of rows) {
            insert.run(firstUser.id, row.key, row.value);
          }
          console.log(`✅ Migrated ${rows.length} config rows for user ${firstUser.id}`);
        }
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
    console.error('Config migration fallback error:', err?.message);
  }

  return db;
}

function ensureUsersTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function ensureCurrentTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      jid TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      avatar_url TEXT,
      is_group INTEGER DEFAULT 0,
      last_seen TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, jid)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      jid TEXT NOT NULL,
      content TEXT,
      type TEXT DEFAULT 'text',
      direction TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      duration INTEGER,
      media_path TEXT,
       media_name TEXT,
       media_mime TEXT,
      is_edited INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS config (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event TEXT NOT NULL,
      data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS statuses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sender_jid TEXT NOT NULL,
      sender_phone TEXT,
      sender_name TEXT,
      content TEXT,
      media_type TEXT DEFAULT 'text',
      media_path TEXT,
      timestamp TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS call_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      caller_jid TEXT NOT NULL,
      caller_phone TEXT,
      caller_name TEXT,
      is_video INTEGER DEFAULT 0,
      is_group INTEGER DEFAULT 0,
      status TEXT DEFAULT 'missed',
      timestamp TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS custom_sounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      sound_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      duration INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Add archive + unread columns if missing
  try {
    const cols = getColumnNames(db, 'contacts');
    if (!cols.has('is_archived')) {
      db.exec("ALTER TABLE contacts ADD COLUMN is_archived INTEGER DEFAULT 0");
    }
    if (!cols.has('unread_count')) {
      db.exec("ALTER TABLE contacts ADD COLUMN unread_count INTEGER DEFAULT 0");
    }
  } catch {}

  try {
    const messageCols = getColumnNames(db, 'messages');
    if (!messageCols.has('media_name')) {
      db.exec("ALTER TABLE messages ADD COLUMN media_name TEXT");
    }
    if (!messageCols.has('media_mime')) {
      db.exec("ALTER TABLE messages ADD COLUMN media_mime TEXT");
    }
    if (!messageCols.has('is_view_once')) {
      db.exec("ALTER TABLE messages ADD COLUMN is_view_once INTEGER DEFAULT 0");
    }
    if (!messageCols.has('is_deleted')) {
      db.exec("ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0");
    }
    if (!messageCols.has('is_edited')) {
      db.exec("ALTER TABLE messages ADD COLUMN is_edited INTEGER DEFAULT 0");
    }
    if (!messageCols.has('is_starred')) {
      db.exec("ALTER TABLE messages ADD COLUMN is_starred INTEGER DEFAULT 0");
    }
    if (!messageCols.has('reply_to_id')) {
      db.exec("ALTER TABLE messages ADD COLUMN reply_to_id TEXT");
    }
    if (!messageCols.has('reply_to_content')) {
      db.exec("ALTER TABLE messages ADD COLUMN reply_to_content TEXT");
    }
    if (!messageCols.has('reply_to_sender')) {
      db.exec("ALTER TABLE messages ADD COLUMN reply_to_sender TEXT");
    }
  } catch {}
}

function ensureIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user_contact ON messages(user_id, contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_user_contact_time ON messages(user_id, contact_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(jid);
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_user_updated ON contacts(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stats_user ON stats(user_id);
    CREATE INDEX IF NOT EXISTS idx_statuses_user ON statuses(user_id);
    CREATE INDEX IF NOT EXISTS idx_statuses_expires ON statuses(expires_at);
    CREATE INDEX IF NOT EXISTS idx_call_logs_user ON call_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_call_logs_timestamp ON call_logs(user_id, timestamp DESC);
  `);
}

function needsLegacyMigration(db) {
  return (
    !hasColumn(db, 'contacts', 'user_id') ||
    !hasColumn(db, 'messages', 'user_id') ||
    !hasColumn(db, 'config', 'user_id') ||
    !hasColumn(db, 'stats', 'user_id')
  );
}

function tableExists(db, tableName) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
}

function getColumnNames(db, tableName) {
  if (!tableExists(db, tableName)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function hasColumn(db, tableName, columnName) {
  return getColumnNames(db, tableName).has(columnName);
}

function countRows(db, tableName) {
  if (!tableExists(db, tableName)) return 0;
  return db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get().count;
}

function hasLegacyData(db) {
  return ['contacts', 'messages', 'config', 'stats'].some((tableName) => countRows(db, tableName) > 0);
}

function getLegacyOwnerUserId(db) {
  if (!hasLegacyData(db)) return null;

  const existingLegacy = db.prepare(
    'SELECT id FROM users WHERE username = ? AND password_hash = ? LIMIT 1'
  ).get(LEGACY_USERNAME, LEGACY_PENDING_HASH);

  if (existingLegacy) return existingLegacy.id;

  const users = db.prepare('SELECT id FROM users ORDER BY created_at ASC, id ASC').all();
  if (users.length === 1) return users[0].id;

  const legacyUserId = uuid();
  db.prepare(
    'INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)'
  ).run(legacyUserId, LEGACY_USERNAME, LEGACY_PENDING_HASH, 'Migrated legacy data');

  return legacyUserId;
}

function migrateLegacySchema(db) {
  const legacyUserId = getLegacyOwnerUserId(db);

  console.log('🧱 Running SQLite legacy schema migration');

  db.pragma('foreign_keys = OFF');

  try {
    const migrate = db.transaction(() => {
      migrateContactsTable(db, legacyUserId);
      migrateMessagesTable(db, legacyUserId);
      migrateConfigTable(db, legacyUserId);
      migrateStatsTable(db, legacyUserId);
    });

    migrate();
    console.log('✅ SQLite legacy schema migration complete');
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function migrateContactsTable(db, legacyUserId) {
  const columns = getColumnNames(db, 'contacts');
  if (columns.size === 0) return;

  db.exec(`
    DROP TABLE IF EXISTS contacts_new;
    CREATE TABLE contacts_new (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      jid TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      avatar_url TEXT,
      is_group INTEGER DEFAULT 0,
      last_seen TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, jid)
    );
  `);

  const userExpr = columns.has('user_id') ? 'COALESCE(user_id, @legacyUserId)' : '@legacyUserId';
  const jidExpr = columns.has('jid') ? 'jid' : 'id';
  const nameExpr = columns.has('name') ? 'name' : 'NULL';
  const phoneExpr = columns.has('phone') ? 'phone' : 'NULL';
  const avatarExpr = columns.has('avatar_url') ? 'avatar_url' : 'NULL';
  const groupExpr = columns.has('is_group') ? 'COALESCE(is_group, 0)' : '0';
  const lastSeenExpr = columns.has('last_seen') ? 'last_seen' : 'NULL';
  const updatedExpr = columns.has('updated_at') ? "COALESCE(updated_at, datetime('now'))" : "datetime('now')";

  db.prepare(`
    INSERT OR IGNORE INTO contacts_new (id, user_id, jid, name, phone, avatar_url, is_group, last_seen, updated_at)
    SELECT id, ${userExpr}, ${jidExpr}, ${nameExpr}, ${phoneExpr}, ${avatarExpr}, ${groupExpr}, ${lastSeenExpr}, ${updatedExpr}
    FROM contacts
  `).run({ legacyUserId });

  db.exec('DROP TABLE contacts; ALTER TABLE contacts_new RENAME TO contacts;');
}

function migrateMessagesTable(db, legacyUserId) {
  const columns = getColumnNames(db, 'messages');
  if (columns.size === 0) return;

  db.exec(`
    DROP TABLE IF EXISTS messages_new;
    CREATE TABLE messages_new (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      jid TEXT NOT NULL,
      content TEXT,
      type TEXT DEFAULT 'text',
      direction TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      duration INTEGER,
      media_path TEXT,
      media_name TEXT,
      media_mime TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );
  `);

  const userExpr = columns.has('user_id') ? 'COALESCE(user_id, @legacyUserId)' : '@legacyUserId';
  const contentExpr = columns.has('content') ? 'content' : 'NULL';
  const typeExpr = columns.has('type') ? "COALESCE(type, 'text')" : "'text'";
  const statusExpr = columns.has('status') ? "COALESCE(status, 'sent')" : "'sent'";
  const durationExpr = columns.has('duration') ? 'duration' : 'NULL';
  const mediaPathExpr = columns.has('media_path') ? 'media_path' : 'NULL';
  const mediaNameExpr = columns.has('media_name') ? 'media_name' : 'NULL';
  const mediaMimeExpr = columns.has('media_mime') ? 'media_mime' : 'NULL';
  const createdExpr = columns.has('created_at') ? "COALESCE(created_at, datetime('now'))" : "datetime('now')";

  db.prepare(`
    INSERT OR IGNORE INTO messages_new (id, user_id, contact_id, jid, content, type, direction, timestamp, status, duration, media_path, media_name, media_mime, created_at)
    SELECT id, ${userExpr}, contact_id, jid, ${contentExpr}, ${typeExpr}, direction, timestamp, ${statusExpr}, ${durationExpr}, ${mediaPathExpr}, ${mediaNameExpr}, ${mediaMimeExpr}, ${createdExpr}
    FROM messages
  `).run({ legacyUserId });

  db.exec('DROP TABLE messages; ALTER TABLE messages_new RENAME TO messages;');
}

function migrateConfigTable(db, legacyUserId) {
  const columns = getColumnNames(db, 'config');
  if (columns.size === 0) return;

  db.exec(`
    DROP TABLE IF EXISTS config_new;
    CREATE TABLE config_new (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const userExpr = columns.has('user_id') ? 'COALESCE(user_id, @legacyUserId)' : '@legacyUserId';
  const valueExpr = columns.has('value') ? 'value' : 'NULL';

  db.prepare(`
    INSERT OR REPLACE INTO config_new (user_id, key, value)
    SELECT ${userExpr}, key, ${valueExpr}
    FROM config
  `).run({ legacyUserId });

  db.exec('DROP TABLE config; ALTER TABLE config_new RENAME TO config;');
}

function migrateStatsTable(db, legacyUserId) {
  const columns = getColumnNames(db, 'stats');
  if (columns.size === 0) return;

  db.exec(`
    DROP TABLE IF EXISTS stats_new;
    CREATE TABLE stats_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event TEXT NOT NULL,
      data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const userExpr = columns.has('user_id') ? 'COALESCE(user_id, @legacyUserId)' : '@legacyUserId';
  const dataExpr = columns.has('data') ? 'data' : 'NULL';
  const createdExpr = columns.has('created_at') ? "COALESCE(created_at, datetime('now'))" : "datetime('now')";

  db.prepare(`
    INSERT OR IGNORE INTO stats_new (id, user_id, event, data, created_at)
    SELECT id, ${userExpr}, event, ${dataExpr}, ${createdExpr}
    FROM stats
  `).run({ legacyUserId });

  db.exec('DROP TABLE stats; ALTER TABLE stats_new RENAME TO stats;');
}
