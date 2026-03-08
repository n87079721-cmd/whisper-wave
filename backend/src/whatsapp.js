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
let connectionStatus = 'disconnected';
let eventListeners = [];
let reconnectTimer = null;

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
  // Clear any pending reconnect
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

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
    keepAliveIntervalMs: 30000,
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
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        connectionStatus = 'disconnected';
        emit('status', { status: 'disconnected' });
        console.log('❌ Logged out. Clear session to reconnect.');
      } else {
        // Transient disconnect — keep showing connected while we reconnect
        connectionStatus = 'reconnecting';
        emit('status', { status: 'reconnecting' });
        console.log('🔄 Auto-reconnecting in 3s...');
        reconnectTimer = setTimeout(() => startConnection(db), 3000);
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

      // Store full international number with +
      const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
      const phone = '+' + rawNumber;
      const pushName = msg.pushName || null;

      let contactId = getOrCreateContact(db, jid, phone, pushName);

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
        new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString(),
        msg.message.audioMessage?.seconds || null
      );

      db.prepare(`INSERT INTO stats (event, data) VALUES ('message_received', ?)`).run(JSON.stringify({ contactId }));
      emit('message', { contactId, msgId });
    }
  });

  // Sync contacts when they update (push names)
  sock.ev.on('contacts.update', (updates) => {
    for (const update of updates) {
      if (update.id && update.notify) {
        const rawNumber = update.id.replace('@s.whatsapp.net', '').replace('@g.us', '');
        const phone = '+' + rawNumber;
        const existing = db.prepare('SELECT id FROM contacts WHERE jid = ?').get(update.id);
        if (existing) {
          db.prepare('UPDATE contacts SET name = ?, phone = ?, updated_at = datetime("now") WHERE id = ?')
            .run(update.notify, phone, existing.id);
        }
      }
    }
  });
}

function getOrCreateContact(db, jid, phone, pushName) {
  const existing = db.prepare('SELECT id, name FROM contacts WHERE jid = ?').get(jid);
  if (existing) {
    // Update push name and phone if we have better data
    if (pushName && (!existing.name || existing.name === phone)) {
      db.prepare('UPDATE contacts SET name = ?, phone = ?, updated_at = datetime("now") WHERE id = ?')
        .run(pushName, phone, existing.id);
    } else if (existing.name !== phone) {
      // Ensure phone is always in full format
      db.prepare('UPDATE contacts SET phone = ?, updated_at = datetime("now") WHERE id = ?')
        .run(phone, existing.id);
    }
    return existing.id;
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO contacts (id, jid, name, phone) VALUES (?, ?, ?, ?)
  `).run(id, jid, pushName || phone, phone);
  return id;
}

async function syncContacts(db) {
  try {
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
  // Send as PTT with proper mimetype — NO caption, just audio
  // This ensures WhatsApp shows it as a native voice note with waveform
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
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (sock) {
    try { await sock.logout(); } catch {}
    sock = null;
  }
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
}
