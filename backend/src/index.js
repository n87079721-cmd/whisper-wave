import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db.js';
import { initWhatsApp, getWhatsAppState } from './whatsapp.js';
import { createApiRouter } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));

// Initialize database
const db = initDatabase();

// Initialize WhatsApp
const wa = initWhatsApp(db);

// API routes
app.use('/api', createApiRouter(db, wa));

// Health check
app.get('/health', (req, res) => {
  const state = getWhatsAppState();
  res.json({ status: 'ok', whatsapp: state.status });
});

// Serve built frontend (static files)
const frontendPath = path.join(__dirname, '..', 'public');
app.use(express.static(frontendPath));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 WA Controller running on port ${PORT}`);
});
