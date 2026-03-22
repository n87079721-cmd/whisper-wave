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
  `);
}

function ensureIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(jid);
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_stats_user ON stats(user_id);
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
  const createdExpr = columns.has('created_at') ? "COALESCE(created_at, datetime('now'))" : "datetime('now')";

  db.prepare(`
    INSERT OR IGNORE INTO messages_new (id, user_id, contact_id, jid, content, type, direction, timestamp, status, duration, media_path, created_at)
    SELECT id, ${userExpr}, contact_id, jid, ${contentExpr}, ${typeExpr}, direction, timestamp, ${statusExpr}, ${durationExpr}, ${mediaPathExpr}, ${createdExpr}
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
