import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDatabase } from './db.js';
import { initWhatsApp, getWhatsAppState } from './whatsapp.js';
import { createApiRouter } from './api.js';

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

app.listen(PORT, () => {
  console.log(`🚀 WA Controller backend running on port ${PORT}`);
});
