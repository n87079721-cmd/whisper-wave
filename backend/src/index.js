import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db.js';
import { createApiRouter } from './api.js';
import { autoReconnectAll, shutdownAllWhatsAppClients } from './whatsapp.js';
import { startTelegramPolling, isTelegramConfigured } from './telegram.js';
import { getTelegramCallbackHandlers, startConversationStarterLoop } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '25mb' }));

// Initialize database
const db = initDatabase();

// One-time backfill: reset legacy default of 5 minutes on the manual-mute knob
// to 0 so existing accounts behave the same as freshly-created ones. We only
// touch rows still holding the legacy default; users who explicitly set a
// value (including 5) by clicking the slider stay untouched.
try {
  const beforeRows = db.prepare("SELECT user_id FROM config WHERE key = 'ai_manual_mute_minutes' AND value = '5'").all();
  if (beforeRows.length) {
    db.prepare("DELETE FROM config WHERE key = 'ai_manual_mute_minutes' AND value = '5'").run();
    console.log(`🧹 Cleared legacy ai_manual_mute_minutes='5' on ${beforeRows.length} account(s) — now defaults to 0`);
  }
} catch (err) {
  console.warn('manual-mute backfill skipped:', err?.message);
}

// One-time contact dedup: merge @lid duplicates into the canonical
// @s.whatsapp.net row when they share the same real name (per user). Strict
// user-id scoping is preserved — we never touch rows across accounts.
try {
  const users = db.prepare('SELECT id FROM users').all();
  let totalMerged = 0;
  for (const u of users) {
    const dupes = db.prepare(`
      SELECT LOWER(TRIM(name)) AS normName, is_group
      FROM contacts
      WHERE user_id = ?
        AND name IS NOT NULL AND TRIM(name) != ''
        AND name NOT LIKE 'WhatsApp contact%'
        AND name NOT LIKE '%@%'
      GROUP BY normName, is_group
      HAVING COUNT(*) > 1
    `).all(u.id);
    for (const d of dupes) {
      const rows = db.prepare(`
        SELECT id, jid, phone FROM contacts
        WHERE user_id = ? AND is_group = ? AND LOWER(TRIM(name)) = ?
        ORDER BY (CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END),
                 (CASE WHEN phone IS NOT NULL AND phone != '' THEN 0 ELSE 1 END),
                 updated_at DESC
      `).all(u.id, d.is_group, d.normName);
      if (rows.length < 2) continue;
      const canonical = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const dup = rows[i];
        try {
          db.prepare('UPDATE messages SET contact_id = ?, jid = ? WHERE contact_id = ? AND user_id = ?')
            .run(canonical.id, canonical.jid, dup.id, u.id);
          db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(dup.id, u.id);
          totalMerged++;
        } catch {}
      }
    }
  }
  if (totalMerged) console.log(`🧬 Contact dedup merged ${totalMerged} duplicate row(s)`);
} catch (err) {
  console.warn('contact dedup backfill skipped:', err?.message);
}

// API routes (no longer needs wa — per-user instances created on demand)
app.use('/api', createApiRouter(db));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve built frontend (static files)
const frontendPath = path.join(__dirname, '..', 'public');
app.use(express.static(frontendPath));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`🚀 WA Controller running on port ${PORT}`);
  // Auto-reconnect saved sessions gradually so multiple restores do not fight each other
  setTimeout(() => autoReconnectAll(db), 3000);

  // Start Telegram bot polling and conversation starters for all users
  setTimeout(() => {
    try {
      const users = db.prepare('SELECT id, username FROM users').all();
      for (const user of users) {
        if (isTelegramConfigured(db, user.id)) {
          const handlers = getTelegramCallbackHandlers(user.id, db);
          startTelegramPolling(db, user.id, handlers);
          console.log(`🤖 Telegram bot started for ${user.username}`);
        }
        startConversationStarterLoop(user.id, db);
      }
    } catch (err) {
      console.error('Telegram/starter init error:', err?.message);
    }
  }, 5000);
});

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛑 Received ${signal}, shutting down gracefully...`);

  try {
    await shutdownAllWhatsAppClients();
  } catch (err) {
    console.error('WhatsApp shutdown error:', err?.message || err);
  }

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});
