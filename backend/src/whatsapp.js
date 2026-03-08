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
import NodeCache from 'node-cache';

const msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '..', 'data', 'auth');
const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let eventListeners = [];
let reconnectTimer = null;
let isConnecting = false;
let reconnectAttempt = 0;
let processGuardsInstalled = false;
let badMacTimestamps = [];
let repairInProgress = false;

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

function isSignalSessionError(err) {
  const message = (err?.message || err?.toString?.() || '').toLowerCase();
  return (
    message.includes('bad mac') ||
    message.includes('failed to decrypt message with any known session') ||
    message.includes('decryptwhispermessage') ||
    message.includes('sessioncipher') ||
    message.includes('signalprotocol')
  );
}

function purgeCorruptedSignalSessions() {
  if (!fs.existsSync(AUTH_DIR)) return 0;
  const files = fs.readdirSync(AUTH_DIR);
  const targets = files.filter((name) => /^session-.*\.json$/i.test(name) || /^sender-key-.*\.json$/i.test(name));

  for (const file of targets) {
    try {
      fs.rmSync(path.join(AUTH_DIR, file), { force: true });
    } catch {}
  }

  return targets.length;
}

function triggerSignalSessionRepair(db, sourceError) {
  const now = Date.now();
  badMacTimestamps.push(now);
  badMacTimestamps = badMacTimestamps.filter((ts) => now - ts < 60000);

  // Repair only if we see repeated decryption failures in a short window.
  if (badMacTimestamps.length < 3 || repairInProgress) return;

  repairInProgress = true;
  console.warn(`⚠️ Detected repeated Signal decrypt failures. Starting auto-repair (${sourceError?.message || 'Bad MAC'})`);

  setTimeout(async () => {
    try {
      connectionStatus = 'reconnecting';
      emit('status', { status: 'reconnecting' });

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      const removed = purgeCorruptedSignalSessions();
      console.log(`🛠️ Cleared ${removed} Signal session file(s). Reconnecting...`);

      await startConnection(db);
    } catch (err) {
      console.error('Signal session auto-repair failed:', err?.message || err);
    } finally {
      repairInProgress = false;
      badMacTimestamps = [];
    }
  }, 200);
}

function installProcessGuards(db) {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;

  process.on('uncaughtException', (err) => {
    if (isSignalSessionError(err)) {
      console.warn('⚠️ Suppressed uncaught Signal session error:', err?.message || err);
      triggerSignalSessionRepair(db, err);
      return;
    }
    console.error('Uncaught exception:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (isSignalSessionError(reason)) {
      console.warn('⚠️ Suppressed unhandled Signal session rejection:', reason?.message || reason);
      triggerSignalSessionRepair(db, reason);
      return;
    }
    console.error('Unhandled rejection:', reason);
  });
}

export function initWhatsApp(db) {
  installProcessGuards(db);
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
  if (isConnecting) return;
  isConnecting = true;

  // Clear any pending reconnect
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  // Ensure a single active socket instance
  if (sock) {
    try { sock.ev.removeAllListeners('connection.update'); } catch {}
    try { sock.ev.removeAllListeners('messages.upsert'); } catch {}
    try { sock.ev.removeAllListeners('contacts.update'); } catch {}
    try { sock.ev.removeAllListeners('creds.update'); } catch {}
    try { sock.end?.(undefined); } catch {}
    sock = null;
  }

  try {
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
      syncFullHistory: false,
      markOnlineOnConnect: false,
      msgRetryCounterCache,
      getMessage: async (key) => {
        // Baileys calls this to retry decryption of messages with Bad MAC errors
        try {
          const row = db.prepare('SELECT content FROM messages WHERE id = ?').get(key.id);
          if (row?.content) return { conversation: row.content };
        } catch {}
        return undefined;
      },
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
        reconnectAttempt = 0;
        emit('connected', null);
        console.log('✅ WhatsApp connected');
        syncContacts(db);
      }

      if (connection === 'close') {
        const statusCode = extractDisconnectStatusCode(lastDisconnect?.error);
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession;

        if (isLoggedOut) {
          connectionStatus = 'disconnected';
          reconnectAttempt = 0;
          emit('status', { status: 'disconnected' });
          console.log('❌ Logged out. Clear session to reconnect.');
        } else {
          connectionStatus = 'reconnecting';
          emit('status', { status: 'reconnecting' });
          const delays = [3000, 5000, 10000];
          const delay = delays[Math.min(reconnectAttempt, delays.length - 1)];
          reconnectAttempt++;
          console.log(`🔄 Connection closed (${statusCode ?? 'unknown'}), reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt})...`);
          reconnectTimer = setTimeout(() => startConnection(db), delay);
        }
      }
    });

    // Listen for incoming messages
    sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      if (type !== 'notify') return;

      for (const msg of msgs) {
        try {
          if (!msg.message || msg.key.fromMe) continue;
          const jid = msg.key.remoteJid;
          if (!jid || jid === 'status@broadcast') continue;

          // Store full international number with +
          const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
          const phone = '+' + rawNumber;
          const pushName = msg.pushName || null;

          const contactId = getOrCreateContact(db, jid, phone, pushName);

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
            toIsoTimestamp(msg.messageTimestamp),
            msg.message.audioMessage?.seconds || null
          );

          db.prepare(`INSERT INTO stats (event, data) VALUES ('message_received', ?)`).run(JSON.stringify({ contactId }));
          emit('message', { contactId, msgId });
        } catch (err) {
          console.error('messages.upsert handler error:', err?.message || err);
        }
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
  } catch (err) {
    console.error('startConnection error:', err?.message || err);
    connectionStatus = 'reconnecting';
    emit('status', { status: 'reconnecting' });
    reconnectTimer = setTimeout(() => startConnection(db), 3000);
  } finally {
    isConnecting = false;
  }
}

function extractDisconnectStatusCode(error) {
  try {
    if (!error) return null;
    if (error?.output?.statusCode) return error.output.statusCode;
    return new Boom(error)?.output?.statusCode ?? null;
  } catch {
    return null;
  }
}

function toIsoTimestamp(value) {
  if (typeof value === 'bigint') return new Date(Number(value) * 1000).toISOString();
  if (typeof value === 'number') return new Date(value * 1000).toISOString();

  if (value && typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      return new Date(value.toNumber() * 1000).toISOString();
    }
    if (typeof value.low === 'number') {
      return new Date(value.low * 1000).toISOString();
    }
  }

  return new Date().toISOString();
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
