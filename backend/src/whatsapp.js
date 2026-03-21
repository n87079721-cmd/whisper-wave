import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import NodeCache from 'node-cache';
import { generateReply, shouldReact, shouldAlsoReplyAfterReaction } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const logger = pino({ level: 'silent' });

// Per-user instance store
const userInstances = new Map(); // userId -> instance object

function getUserAuthDir(userId) {
  return path.join(DATA_DIR, 'auth', userId);
}

const NAME_PRIORITY = {
  none: 0,
  push: 1,
  verified: 2,
  notify: 3,
  saved: 4,
};

function sanitizeName(value) {
  const trimmed = value?.trim?.();
  return trimmed ? trimmed : null;
}

function extractNameCandidate(source) {
  const saved = sanitizeName(source?.name);
  if (saved) return { name: saved, priority: NAME_PRIORITY.saved };

  const notify = sanitizeName(source?.notify);
  if (notify) return { name: notify, priority: NAME_PRIORITY.notify };

  const verified = sanitizeName(source?.verifiedName);
  if (verified) return { name: verified, priority: NAME_PRIORITY.verified };

  const push = sanitizeName(source?.pushName);
  if (push) return { name: push, priority: NAME_PRIORITY.push };

  return { name: null, priority: NAME_PRIORITY.none };
}

function getNameCandidate(...sources) {
  return sources.reduce((best, source) => {
    const candidate = extractNameCandidate(source);
    return candidate.priority > best.priority ? candidate : best;
  }, { name: null, priority: NAME_PRIORITY.none });
}

function isPhoneLikeName(value, phone) {
  if (!value) return true;
  const normalizedValue = value.replace(/\s+/g, '');
  const normalizedPhone = phone.replace(/\s+/g, '');
  return (
    normalizedValue === normalizedPhone ||
    normalizedValue.replace(/^\+/, '') === normalizedPhone.replace(/^\+/, '') ||
    /^\+?\d{7,}$/.test(normalizedValue)
  );
}

function shouldReplaceName(candidate, existingName, phone) {
  if (!candidate?.name) return false;
  if (!existingName) return true;
  if (candidate.name === existingName) return false;
  if (isPhoneLikeName(existingName, phone)) return true;
  return candidate.priority >= NAME_PRIORITY.saved;
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

function getInstance(userId) {
  if (!userInstances.has(userId)) {
    userInstances.set(userId, {
      sock: null,
      store: null,
      qrCode: null,
      pairingCode: null,
      pendingPairingPhone: null,
      connectionStatus: 'disconnected',
      eventListeners: [],
      reconnectTimer: null,
      isConnecting: false,
      reconnectAttempt: 0,
      badMacTimestamps: [],
      repairInProgress: false,
      msgRetryCounterCache: new NodeCache({ stdTTL: 600, checkperiod: 120 }),
      autoReplyCooldowns: new Map(),
      messageBatchBuffers: new Map(),
    });
  }
  return userInstances.get(userId);
}

export function getWhatsAppState(userId) {
  const inst = getInstance(userId);
  return { status: inst.connectionStatus, qr: inst.qrCode, pairingCode: inst.pairingCode };
}

export function onWhatsAppEvent(userId, listener) {
  const inst = getInstance(userId);
  inst.eventListeners.push(listener);
  return () => { inst.eventListeners = inst.eventListeners.filter(l => l !== listener); };
}

function emit(userId, event, data) {
  const inst = getInstance(userId);
  inst.eventListeners.forEach(l => l(event, data));
}

function purgeCorruptedSignalSessions(userId) {
  const authDir = getUserAuthDir(userId);
  if (!fs.existsSync(authDir)) return 0;
  const files = fs.readdirSync(authDir);
  const targets = files.filter((name) => /^session-.*\.json$/i.test(name) || /^sender-key-.*\.json$/i.test(name));
  for (const file of targets) {
    try { fs.rmSync(path.join(authDir, file), { force: true }); } catch {}
  }
  return targets.length;
}

function triggerSignalSessionRepair(userId, db, sourceError) {
  const inst = getInstance(userId);
  const now = Date.now();
  inst.badMacTimestamps.push(now);
  inst.badMacTimestamps = inst.badMacTimestamps.filter((ts) => now - ts < 60000);
  if (inst.badMacTimestamps.length < 3 || inst.repairInProgress) return;

  inst.repairInProgress = true;
  console.warn(`⚠️ [${userId}] Signal decrypt failures. Auto-repairing...`);

  setTimeout(async () => {
    try {
      inst.connectionStatus = 'reconnecting';
      emit(userId, 'status', { status: 'reconnecting' });
      if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
      const removed = purgeCorruptedSignalSessions(userId);
      console.log(`🛠️ [${userId}] Cleared ${removed} Signal session file(s). Reconnecting...`);
      await startConnection(userId, db);
    } catch (err) {
      console.error(`Signal repair failed [${userId}]:`, err?.message || err);
    } finally {
      inst.repairInProgress = false;
      inst.badMacTimestamps = [];
    }
  }, 200);
}

export async function requestPairingWithPhone(userId, phoneNumber) {
  const inst = getInstance(userId);
  if (!inst.sock) throw new Error('WhatsApp socket not initialised');
  if (inst.connectionStatus === 'connected') throw new Error('Already connected');
  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  if (cleaned.length < 8) throw new Error('Invalid phone number');
  inst.pendingPairingPhone = cleaned;
  const code = await inst.sock.requestPairingCode(cleaned);
  inst.pairingCode = code;
  emit(userId, 'pairing_code', { code });
  return code;
}

export function initWhatsApp(userId, db) {
  startConnection(userId, db);
  return {
    getState: () => getWhatsAppState(userId),
    sendTextMessage: (jid, text) => sendTextMessage(userId, jid, text),
    sendVoiceNote: (jid, audioBuffer) => sendVoiceNote(userId, jid, audioBuffer),
    reconnect: () => startConnection(userId, db),
    clearSession: () => clearSession(userId, db),
    getSocket: () => getInstance(userId).sock,
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
  };
}

// Get or create WA interface for a user
export function getOrInitWhatsApp(userId, db) {
  const inst = getInstance(userId);
  // If never started or disconnected with no socket, start
  if (!inst.sock && inst.connectionStatus === 'disconnected') {
    return initWhatsApp(userId, db);
  }
  return {
    getState: () => getWhatsAppState(userId),
    sendTextMessage: (jid, text) => sendTextMessage(userId, jid, text),
    sendVoiceNote: (jid, audioBuffer) => sendVoiceNote(userId, jid, audioBuffer),
    reconnect: () => startConnection(userId, db),
    clearSession: () => clearSession(userId, db),
    getSocket: () => inst.sock,
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
  };
}

async function startConnection(userId, db) {
  const inst = getInstance(userId);
  if (inst.isConnecting) return;
  inst.isConnecting = true;

  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }

  if (inst.sock) {
    try { inst.sock.ev.removeAllListeners('connection.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.upsert'); } catch {}
    try { inst.sock.ev.removeAllListeners('contacts.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('creds.update'); } catch {}
    try { inst.sock.end?.(undefined); } catch {}
    inst.sock = null;
  }

  try {
    const authDir = getUserAuthDir(userId);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    inst.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: 30000,
      syncFullHistory: true,
      markOnlineOnConnect: false,
      msgRetryCounterCache: inst.msgRetryCounterCache,
      getMessage: async (key) => {
        try {
          const row = db.prepare('SELECT content FROM messages WHERE id = ? AND user_id = ?').get(key.id, userId);
          if (row?.content) return { conversation: row.content };
        } catch {}
        return undefined;
      },
    });

    if (!inst.store) {
      inst.store = makeInMemoryStore({ logger });
    }
    inst.store.bind(inst.sock.ev);

    inst.sock.ev.on('creds.update', saveCreds);

    inst.sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        inst.qrCode = qr;
        inst.connectionStatus = 'qr_waiting';
        emit(userId, 'qr', qr);
      }

      if (connection === 'open') {
        inst.qrCode = null;
        inst.pairingCode = null;
        inst.pendingPairingPhone = null;
        inst.connectionStatus = 'connected';
        inst.reconnectAttempt = 0;
        inst.badMacTimestamps = [];
        inst.repairInProgress = false;
        emit(userId, 'connected', null);
        console.log(`✅ [${userId}] WhatsApp connected`);
        syncContacts(userId, db);
      }

      if (connection === 'close') {
        const statusCode = extractDisconnectStatusCode(lastDisconnect?.error);
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession;

        if (isLoggedOut) {
          inst.connectionStatus = 'disconnected';
          inst.reconnectAttempt = 0;
          emit(userId, 'status', { status: 'disconnected' });
        } else {
          inst.connectionStatus = 'reconnecting';
          emit(userId, 'status', { status: 'reconnecting' });
          const delays = [3000, 5000, 10000];
          const delay = delays[Math.min(inst.reconnectAttempt, delays.length - 1)];
          inst.reconnectAttempt++;
          inst.reconnectTimer = setTimeout(() => startConnection(userId, db), delay);
        }
      }
    });

    inst.sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      for (const msg of msgs) {
        try {
          if (!msg.message) continue;
          const jid = msg.key.remoteJid;
          if (!jid || jid === 'status@broadcast') continue;

          const isFromMe = msg.key.fromMe;
          const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
          const phone = '+' + rawNumber;
          const isGroup = jid.endsWith('@g.us');
          const contactCandidate = getNameCandidate(
            inst.store?.contacts?.[jid],
            msg,
            { pushName: msg.pushName || null }
          );

          const contactId = getOrCreateContact(db, userId, jid, phone, contactCandidate, isGroup);

          const content = msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || msg.message.imageMessage?.caption
            || msg.message.videoMessage?.caption
            || '';
          const isVoice = !!msg.message.audioMessage;
          const isImage = !!msg.message.imageMessage;
          const isVideo = !!msg.message.videoMessage;
          const isDocument = !!msg.message.documentMessage;

          let msgType = 'text';
          if (isVoice) msgType = 'voice';
          else if (isImage) msgType = 'image';
          else if (isVideo) msgType = 'video';
          else if (isDocument) msgType = 'document';

          const direction = isFromMe ? 'sent' : 'received';
          const msgId = msg.key.id || uuid();

          db.prepare(`
            INSERT OR IGNORE INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            msgId, userId, contactId, jid, content, msgType, direction,
            toIsoTimestamp(msg.messageTimestamp),
            isFromMe ? 'sent' : 'delivered',
            msg.message.audioMessage?.seconds || null
          );

          emit(userId, 'message', { contactId, msgId });

          if (type === 'notify' && !isFromMe) {
            db.prepare(`INSERT INTO stats (user_id, event, data) VALUES (?, 'message_received', ?)`).run(userId, JSON.stringify({ contactId }));

            if (!isGroup) {
              handleAutoReply(userId, db, contactId, jid, phone, contactCandidate.name || msg.pushName || null, msg.key).catch(err => {
                console.error('Auto-reply error:', err?.message || err);
              });
            }
          }
        } catch (err) {
          if (isSignalSessionError(err)) {
            triggerSignalSessionRepair(userId, db, err);
            continue;
          }
          console.error('messages.upsert handler error:', err?.message || err);
        }
      }
    });

    inst.sock.ev.on('messaging-history.set', ({ chats, contacts: syncedContacts, messages: historyMsgs }) => {
      console.log(`📜 [${userId}] History sync: ${chats?.length || 0} chats, ${syncedContacts?.length || 0} contacts, ${historyMsgs?.length || 0} messages`);

      let contactChanges = 0;

      if (syncedContacts?.length) {
        for (const c of syncedContacts) {
          try {
            const jid = c.id;
            if (!jid || jid === 'status@broadcast') continue;
            const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const phone = '+' + rawNumber;
            const isGroup = jid.endsWith('@g.us');
            getOrCreateContact(db, userId, jid, phone, getNameCandidate(c), isGroup);
            contactChanges++;
          } catch {}
        }
      }

      if (chats?.length) {
        for (const chat of chats) {
          try {
            const jid = chat.id;
            if (!jid || jid === 'status@broadcast') continue;
            const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const phone = '+' + rawNumber;
            const isGroup = jid.endsWith('@g.us');
            getOrCreateContact(db, userId, jid, phone, getNameCandidate(chat), isGroup);
            contactChanges++;
          } catch {}
        }
      }

      if (historyMsgs?.length) {
        for (const msg of historyMsgs) {
          try {
            if (!msg?.message) continue;
            const jid = msg.key?.remoteJid;
            if (!jid || jid === 'status@broadcast') continue;

            const isFromMe = msg.key.fromMe;
            const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const phone = '+' + rawNumber;
            const isGroup = jid.endsWith('@g.us');
            const contactCandidate = getNameCandidate(
              inst.store?.contacts?.[jid],
              msg,
              { pushName: msg.pushName || null }
            );

            const contactId = getOrCreateContact(db, userId, jid, phone, contactCandidate, isGroup);

            const content = msg.message.conversation
              || msg.message.extendedTextMessage?.text
              || msg.message.imageMessage?.caption
              || msg.message.videoMessage?.caption
              || '';

            const isVoice = !!msg.message.audioMessage;
            let msgType = 'text';
            if (isVoice) msgType = 'voice';
            else if (msg.message.imageMessage) msgType = 'image';
            else if (msg.message.videoMessage) msgType = 'video';
            else if (msg.message.documentMessage) msgType = 'document';

            const msgId = msg.key.id || uuid();
            db.prepare(`
              INSERT OR IGNORE INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, duration)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              msgId, userId, contactId, jid, content, msgType,
              isFromMe ? 'sent' : 'received',
              toIsoTimestamp(msg.messageTimestamp),
              isFromMe ? 'sent' : 'delivered',
              msg.message.audioMessage?.seconds || null
            );
          } catch {}
        }
      }

      if (contactChanges > 0) {
        emit(userId, 'contacts_sync', { count: contactChanges });
      }
      emit(userId, 'history_sync', { chats: chats?.length || 0, messages: historyMsgs?.length || 0 });
    });

    inst.sock.ev.on('contacts.update', (updates) => {
      let changed = 0;
      for (const update of updates) {
        try {
          const jid = update.id;
          if (!jid || jid === 'status@broadcast') continue;
          const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
          const phone = '+' + rawNumber;
          const isGroup = jid.endsWith('@g.us');
          const candidate = getNameCandidate(inst.store?.contacts?.[jid], update);
          if (!candidate.name) continue;
          getOrCreateContact(db, userId, jid, phone, candidate, isGroup);
          changed++;
        } catch {}
      }
      if (changed > 0) emit(userId, 'contacts_sync', { count: changed });
    });

    inst.sock.ev.on('contacts.upsert', (contacts) => {
      let changed = 0;
      for (const c of contacts) {
        try {
          const jid = c.id;
          if (!jid || jid === 'status@broadcast') continue;
          const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
          const phone = '+' + rawNumber;
          const isGroup = jid.endsWith('@g.us');
          getOrCreateContact(db, userId, jid, phone, getNameCandidate(inst.store?.contacts?.[jid], c), isGroup);
          changed++;
        } catch {}
      }
      if (changed > 0) emit(userId, 'contacts_sync', { count: changed });
    });
  } catch (err) {
    if (isSignalSessionError(err)) {
      triggerSignalSessionRepair(userId, db, err);
      return;
    }
    console.error(`startConnection error [${userId}]:`, err?.message || err);
    inst.connectionStatus = 'reconnecting';
    emit(userId, 'status', { status: 'reconnecting' });
    inst.reconnectTimer = setTimeout(() => startConnection(userId, db), 3000);
  } finally {
    inst.isConnecting = false;
  }
}

function extractDisconnectStatusCode(error) {
  try {
    if (!error) return null;
    if (error?.output?.statusCode) return error.output.statusCode;
    return new Boom(error)?.output?.statusCode ?? null;
  } catch { return null; }
}

function toIsoTimestamp(value) {
  if (typeof value === 'bigint') return new Date(Number(value) * 1000).toISOString();
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  if (value && typeof value === 'object') {
    if (typeof value.toNumber === 'function') return new Date(value.toNumber() * 1000).toISOString();
    if (typeof value.low === 'number') return new Date(value.low * 1000).toISOString();
  }
  return new Date().toISOString();
}

function getOrCreateContact(db, userId, jid, phone, candidate, isGroup = false) {
  const existing = db.prepare('SELECT id, name FROM contacts WHERE jid = ? AND user_id = ?').get(jid, userId);
  const resolvedName = candidate?.name || phone;

  if (existing) {
    if (shouldReplaceName(candidate, existing.name, phone)) {
      db.prepare("UPDATE contacts SET name = ?, phone = ?, is_group = ?, updated_at = datetime('now') WHERE id = ?")
        .run(resolvedName, phone, isGroup ? 1 : 0, existing.id);
    } else {
      db.prepare("UPDATE contacts SET phone = ?, is_group = ?, updated_at = datetime('now') WHERE id = ?")
        .run(phone, isGroup ? 1 : 0, existing.id);
    }
    return existing.id;
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO contacts (id, user_id, jid, name, phone, is_group) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, jid, resolvedName, phone, isGroup ? 1 : 0);
  return id;
}

async function syncContacts(userId, db) {
  const inst = getInstance(userId);
  if (!inst.store?.contacts) return;
  console.log(`📇 [${userId}] Contact sync initiated`);

  try {
    const contacts = Object.values(inst.store.contacts);
    console.log(`📇 [${userId}] Found ${contacts.length} contacts in store`);
    let syncedCount = 0;

    for (const c of contacts) {
      try {
        const jid = c.id;
        if (!jid || jid === 'status@broadcast') continue;
        const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
        const phone = '+' + rawNumber;
        const isGroup = jid.endsWith('@g.us');
        getOrCreateContact(db, userId, jid, phone, getNameCandidate(c), isGroup);
        syncedCount++;
      } catch {}
    }

    if (syncedCount > 0) {
      emit(userId, 'contacts_sync', { count: syncedCount });
    }
  } catch (err) {
    console.error(`Contact sync error [${userId}]:`, err?.message || err);
  }
}

// ─── Human-like timing helpers ───

function getConfigValue(db, userId, key, fallback) {
  const row = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = ?").get(userId, key);
  return row?.value ?? fallback;
}

function isWithinActiveHours(db, userId) {
  const start = getConfigValue(db, userId, 'ai_active_hours_start', '10:00');
  const end = getConfigValue(db, userId, 'ai_active_hours_end', '23:00');
  const timezone = getConfigValue(db, userId, 'ai_timezone', 'Africa/Lagos');
  
  // Use the user's configured timezone
  let now;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric', minute: 'numeric', hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    now = hour * 60 + minute;
  } catch {
    // Fallback to server time if timezone is invalid
    const d = new Date();
    now = d.getHours() * 60 + d.getMinutes();
  }
  
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) return now >= startMin && now <= endMin;
  return now >= startMin || now <= endMin;
}

function calculateDelay(messageLength, speed) {
  const ranges = {
    fast:   { short: [3000, 12000],  medium: [8000, 25000],  long: [12000, 40000] },
    normal: { short: [5000, 25000],  medium: [15000, 60000], long: [30000, 90000] },
    slow:   { short: [15000, 45000], medium: [30000, 120000], long: [60000, 180000] },
  };
  const r = ranges[speed] || ranges.normal;
  let range;
  if (messageLength < 20) range = r.short;
  else if (messageLength < 100) range = r.medium;
  else range = r.long;
  return Math.floor(Math.random() * (range[1] - range[0])) + range[0];
}

async function sendReaction(userId, jid, messageKey, emoji) {
  const inst = getInstance(userId);
  if (!inst.sock || inst.connectionStatus !== 'connected') return;
  try {
    await inst.sock.sendMessage(jid, { react: { text: emoji, key: messageKey } });
  } catch (err) {
    console.error('Failed to send reaction:', err?.message);
  }
}

async function handleAutoReply(userId, db, contactId, jid, phone, contactName, messageKey) {
  const autoConfig = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'automation_enabled'").get(userId);
  if (!autoConfig || autoConfig.value !== 'true') return;

  if (!isWithinActiveHours(db, userId)) return;

  const replyChance = parseInt(getConfigValue(db, userId, 'ai_reply_chance', '70'), 10);
  if (Math.random() * 100 > replyChance) {
    const reactionEmoji = shouldReact();
    if (reactionEmoji && messageKey) {
      const reactDelay = Math.floor(Math.random() * 5000) + 2000;
      setTimeout(() => sendReaction(userId, jid, messageKey, reactionEmoji), reactDelay);
    }
    return;
  }

  const inst = getInstance(userId);
  const existing = inst.messageBatchBuffers.get(jid);
  if (existing) clearTimeout(existing.timer);

  const batchEntry = existing || { messages: [], contactId, phone, contactName, messageKey };
  batchEntry.messageKey = messageKey;

  batchEntry.timer = setTimeout(() => {
    inst.messageBatchBuffers.delete(jid);
    executeAutoReply(userId, db, contactId, jid, phone, contactName, messageKey).catch(err => {
      console.error('Batched auto-reply error:', err?.message || err);
    });
  }, 8000);

  inst.messageBatchBuffers.set(jid, batchEntry);
}

async function executeAutoReply(userId, db, contactId, jid, phone, contactName, messageKey) {
  const inst = getInstance(userId);
  const now = Date.now();
  const lastReply = inst.autoReplyCooldowns.get(jid) || 0;
  if (now - lastReply < 30000) return;

  const keyRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'openai_api_key'").get(userId);
  if (!keyRow?.value) return;

  const promptRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'ai_system_prompt'").get(userId);
  const systemPrompt = promptRow?.value || '';

  const messages = db.prepare(`
    SELECT content, direction, type FROM messages 
    WHERE contact_id = ? AND user_id = ? AND type = 'text' AND content IS NOT NULL AND content != ''
    ORDER BY timestamp DESC LIMIT 50
  `).all(contactId, userId).reverse();

  if (messages.length === 0) return;

  const lastMsgContent = messages[messages.length - 1]?.content || '';
  const speed = getConfigValue(db, userId, 'ai_response_speed', 'normal');

  const reactionEmoji = shouldReact();
  if (reactionEmoji && messageKey) {
    const reactDelay = Math.floor(Math.random() * 3000) + 1000;
    setTimeout(() => sendReaction(userId, jid, messageKey, reactionEmoji), reactDelay);
    if (!shouldAlsoReplyAfterReaction()) {
      inst.autoReplyCooldowns.set(jid, Date.now());
      return;
    }
  }

  const replyText = await generateReply(keyRow.value, messages, systemPrompt, contactName || phone);
  const delay = calculateDelay(lastMsgContent.length, speed);

  setTimeout(async () => {
    try {
      if (inst.sock && inst.connectionStatus === 'connected') {
        await inst.sock.sendPresenceUpdate('composing', jid);
      }
      const typingDuration = Math.floor(Math.random() * 2000) + 2000;
      setTimeout(async () => {
        try {
          const sent = await sendTextMessage(userId, jid, replyText);
          const replyId = sent?.key?.id || uuid();
          if (inst.sock && inst.connectionStatus === 'connected') {
            await inst.sock.sendPresenceUpdate('paused', jid);
          }
          db.prepare(`
            INSERT OR IGNORE INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status)
            VALUES (?, ?, ?, ?, ?, 'text', 'sent', datetime('now'), 'sent')
          `).run(replyId, userId, contactId, jid, replyText);
          db.prepare(`INSERT INTO stats (user_id, event, data) VALUES (?, 'auto_reply_sent', ?)`).run(userId, JSON.stringify({ contactId }));
          inst.autoReplyCooldowns.set(jid, Date.now());
        } catch (err) {
          console.error('Failed to send auto-reply:', err?.message || err);
        }
      }, typingDuration);
    } catch (err) {
      console.error('Typing indicator error:', err?.message || err);
    }
  }, delay - 3000);
}

async function sendTextMessage(userId, jid, text) {
  const inst = getInstance(userId);
  if (!inst.sock || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  return await inst.sock.sendMessage(jid, { text });
}

async function sendVoiceNote(userId, jid, audioBuffer) {
  const inst = getInstance(userId);
  if (!inst.sock || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  return await inst.sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
  });
}

async function clearSession(userId, db) {
  const inst = getInstance(userId);
  inst.connectionStatus = 'disconnected';
  inst.qrCode = null;
  inst.pairingCode = null;
  inst.pendingPairingPhone = null;
  inst.reconnectAttempt = 0;
  inst.badMacTimestamps = [];
  inst.repairInProgress = false;
  inst.autoReplyCooldowns.clear();
  inst.messageBatchBuffers.forEach(entry => clearTimeout(entry.timer));
  inst.messageBatchBuffers.clear();
  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }

  if (inst.sock) {
    try { inst.sock.ev.removeAllListeners('connection.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.upsert'); } catch {}
    try { inst.sock.ev.removeAllListeners('contacts.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('contacts.upsert'); } catch {}
    try { inst.sock.ev.removeAllListeners('messaging-history.set'); } catch {}
    try { inst.sock.ev.removeAllListeners('creds.update'); } catch {}
    try { await inst.sock.logout(); } catch {}
    try { inst.sock.end?.(undefined); } catch {}
    inst.sock = null;
  }

  // Wipe user data
  try {
    db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM contacts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM stats WHERE user_id = ?').run(userId);
  } catch (err) {
    console.error('Failed to clear DB tables:', err?.message || err);
  }

  // Delete user auth directory
  const authDir = getUserAuthDir(userId);
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  fs.mkdirSync(authDir, { recursive: true });

  inst.isConnecting = false;
  emit(userId, 'status', { status: 'disconnected' });
  console.log(`🗑️ [${userId}] Session fully cleared.`);
}
