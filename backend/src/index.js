import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db.js';
import { createApiRouter } from './api.js';
import { bindAuthDb } from './auth.js';
import { autoReconnectAll, shutdownAllWhatsAppClients } from './whatsapp.js';
import { startTelegramPolling, isTelegramConfigured } from './telegram.js';
import { getTelegramCallbackHandlers, startConversationStarterLoop } from './whatsapp.js';
import { stopTelegramPolling } from './telegram.js';
import { stopConversationStarterLoop } from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

const corsOrigin = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(s => s.trim()).filter(Boolean)
  : true; // reflect request origin, no credentials
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '25mb' }));

// Initialize database
const db = initDatabase();
// Bind the auth secret to the DB so tokens survive redeploys as long as the DB does.
bindAuthDb(db);

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

// Prune old debug_log rows so the stats table doesn't grow unbounded on
// busy accounts (debugLog writes on most incoming messages). Keep 7 days of
// debug logs and 90 days of everything else. Runs hourly.
function pruneStats() {
  try {
    db.prepare("DELETE FROM stats WHERE event = 'debug_log' AND datetime(created_at) < datetime('now', '-7 days')").run();
    db.prepare("DELETE FROM stats WHERE datetime(created_at) < datetime('now', '-90 days')").run();
  } catch (e) {
    console.error('stats prune error:', e?.message || e);
  }
}
setTimeout(pruneStats, 30_000);
setInterval(pruneStats, 60 * 60 * 1000).unref();

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛑 Received ${signal}, shutting down gracefully...`);

  try {
    // Stop background loops (Telegram polling + conversation starters) for every user
    try {
      const users = db.prepare('SELECT id FROM users').all();
      for (const u of users) {
        try { stopTelegramPolling(u.id); } catch {}
        try { stopConversationStarterLoop(u.id); } catch {}
      }
    } catch (e) {
      console.error('Loop stop error:', e?.message || e);
    }
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

// Don't let a single unhandled rejection or uncaught exception kill the whole
// backend (which would drop every user's WhatsApp session). Log and continue.
process.on('unhandledRejection', (reason) => {
  try {
    const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    console.error('[unhandledRejection]', msg);
  } catch {}
});
process.on('uncaughtException', (err) => {
  try {
    console.error('[uncaughtException]', err?.stack || err?.message || err);
  } catch {}
});
