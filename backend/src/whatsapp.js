import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '..', 'data', 'auth');
const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected'; // disconnected | qr_waiting | connected
let eventListeners = [];

export function getWhatsAppState() {
  return { status: connectionStatus, qr: qrCode };
}

export function onWhatsAppEvent(listener) {
  eventListeners.push(listener);
  return () => { eventListeners = eventListeners.filter(l => l !== listener); };
}

function emit(event, data) {
  eventListeners.forEach(l => l(event, data));
}

export function initWhatsApp(db) {
  startConnection(db);
  return {
    getState: getWhatsAppState,
    sendTextMessage,
    sendVoiceNote,
    reconnect: () => startConnection(db),
    clearSession: () => clearSession(db),
    getSocket: () => sock,
  };
}

async function startConnection(db) {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: true,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrCode = qr;
      connectionStatus = 'qr_waiting';
      emit('qr', qr);
    }

    if (connection === 'open') {
      qrCode = null;
      connectionStatus = 'connected';
      emit('connected', null);
      console.log('✅ WhatsApp connected');
      syncContacts(db);
    }

    if (connection === 'close') {
      connectionStatus = 'disconnected';
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnecting...');
        setTimeout(() => startConnection(db), 3000);
      } else {
        console.log('❌ Logged out. Clear session to reconnect.');
      }
    }
  });

  // Listen for incoming messages
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;
    for (const msg of msgs) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;

      const phone = jid.replace('@s.whatsapp.net', '');
      let contactId = getOrCreateContact(db, jid, phone);

      const content = msg.message.conversation
        || msg.message.extendedTextMessage?.text
        || '';
      const isVoice = !!msg.message.audioMessage;

      const msgId = uuid();
      db.prepare(`
        INSERT OR IGNORE INTO messages (id, contact_id, jid, content, type, direction, timestamp, status, duration)
        VALUES (?, ?, ?, ?, ?, 'received', ?, 'delivered', ?)
      `).run(
        msgId, contactId, jid, content,
        isVoice ? 'voice' : 'text',
        new Date(msg.messageTimestamp * 1000).toISOString(),
        msg.message.audioMessage?.seconds || null
      );

      // Track stats
      db.prepare(`INSERT INTO stats (event, data) VALUES ('message_received', ?)`).run(JSON.stringify({ contactId }));
      emit('message', { contactId, msgId });
    }
  });
}

function getOrCreateContact(db, jid, phone) {
  const existing = db.prepare('SELECT id FROM contacts WHERE jid = ?').get(jid);
  if (existing) return existing.id;

  const id = uuid();
  db.prepare(`
    INSERT INTO contacts (id, jid, name, phone) VALUES (?, ?, ?, ?)
  `).run(id, jid, phone, '+' + phone);
  return id;
}

async function syncContacts(db) {
  try {
    // Fetch chats to populate contacts
    const chats = await sock.groupFetchAllParticipating?.() || {};

    // The contacts come from messages and chats organically via Baileys
    // We update names from push names when available
    console.log('📇 Contact sync initiated');
  } catch (err) {
    console.error('Contact sync error:', err.message);
  }
}

async function sendTextMessage(jid, text) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  const sent = await sock.sendMessage(jid, { text });
  return sent;
}

async function sendVoiceNote(jid, audioBuffer) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  const sent = await sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
  });
  return sent;
}

async function clearSession(db) {
  connectionStatus = 'disconnected';
  qrCode = null;
  if (sock) {
    try { await sock.logout(); } catch {}
    sock = null;
  }
  // Remove auth files
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
}
