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
