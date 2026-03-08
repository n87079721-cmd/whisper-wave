import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function initDatabase() {
  const dbPath = path.join(__dirname, '..', 'data', 'wa-controller.db');

  // Ensure data directory exists
  import('fs').then(fs => {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      jid TEXT UNIQUE NOT NULL,
      name TEXT,
      phone TEXT,
      avatar_url TEXT,
      is_group INTEGER DEFAULT 0,
      last_seen TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
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
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(jid);
  `);

  return db;
}
