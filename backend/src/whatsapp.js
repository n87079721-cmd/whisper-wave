import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { generateReply, shouldReact, shouldAlsoReplyAfterReaction } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const VOICE_MEDIA_DIR = path.join(DATA_DIR, 'voice-media');
const STATUS_MEDIA_DIR = path.join(DATA_DIR, 'status-media');

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

  const notify = sanitizeName(source?.notify || source?.pushname || source?.shortName);
  if (notify) return { name: notify, priority: NAME_PRIORITY.notify };

  const verified = sanitizeName(source?.verifiedName);
  if (verified) return { name: verified, priority: NAME_PRIORITY.verified };

  const push = sanitizeName(source?.pushName || source?.pushname);
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

function getInstance(userId) {
  if (!userInstances.has(userId)) {
    userInstances.set(userId, {
      client: null,
      qrCode: null,
      pairingCode: null,
      pendingPairingPhone: null,
      connectionStatus: 'disconnected',
      eventListeners: [],
      reconnectTimer: null,
      isConnecting: false,
      reconnectAttempt: 0,
      connectionGeneration: 0,
      autoReplyCooldowns: new Map(),
      messageBatchBuffers: new Map(),
      contactCache: new Map(), // phone/jid -> contact info
      // Sync state tracking
      syncState: {
        phase: 'idle',
        connectedAt: null,
        lastHistorySyncAt: null,
        lastProgressAt: null,
        storeContacts: 0,
        historyChats: 0,
        historyContacts: 0,
        historyMessages: 0,
        unresolvedLids: 0,
        totalDbContacts: 0,
        totalDbMessages: 0,
      },
      syncGraceTimer: null,
    });
  }
  return userInstances.get(userId);
}

// ── Helpers ──────────────────────────────────────────────

/** Convert a whatsapp-web.js serialized ID to a standard JID */
function toJid(id) {
  if (!id) return '';
  // whatsapp-web.js uses format like "1234567890@c.us" or "1234567890-1234567890@g.us"
  // We normalize @c.us to @s.whatsapp.net for DB consistency
  return id.replace(/@c\.us$/, '@s.whatsapp.net');
}

/** Convert a standard JID back to whatsapp-web.js format */
function fromJid(jid) {
  if (!jid) return '';
  return jid.replace(/@s\.whatsapp\.net$/, '@c.us');
}

function phoneFromJid(jid) {
  return jid.replace(/@(s\.whatsapp\.net|c\.us|g\.us|lid)$/, '');
}

function getAudioFileExtension(mimetype) {
  const normalized = String(mimetype || '').toLowerCase();
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('mp4') || normalized.includes('aac') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  return 'ogg';
}

function hasSavedVoiceFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function upsertMessageRecord(db, { id, userId, contactId, jid, content, type, direction, timestamp, status, duration, mediaPath }) {
  db.prepare(`
    INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, duration, media_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      contact_id = excluded.contact_id,
      jid = excluded.jid,
      content = CASE
        WHEN COALESCE(messages.content, '') = '' AND COALESCE(excluded.content, '') <> '' THEN excluded.content
        ELSE messages.content
      END,
      type = CASE
        WHEN COALESCE(messages.type, 'text') = 'text' AND excluded.type <> 'text' THEN excluded.type
        ELSE messages.type
      END,
      direction = excluded.direction,
      timestamp = excluded.timestamp,
      status = excluded.status,
      duration = COALESCE(excluded.duration, messages.duration),
      media_path = COALESCE(excluded.media_path, messages.media_path)
  `).run(id, userId, contactId, jid, content, type, direction, timestamp, status, duration, mediaPath);
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// ── Exports ──────────────────────────────────────────────

export function getWhatsAppState(userId) {
  const inst = getInstance(userId);
  return {
    status: inst.connectionStatus,
    qr: inst.qrCode,
    pairingCode: inst.pairingCode,
    syncState: { ...inst.syncState },
  };
}

function updateSyncState(userId, db, updates) {
  const inst = getInstance(userId);
  Object.assign(inst.syncState, updates);
  try {
    inst.syncState.totalDbContacts = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE user_id = ? AND is_group = 0').get(userId)?.c || 0;
    inst.syncState.totalDbMessages = db.prepare('SELECT COUNT(*) as c FROM messages WHERE user_id = ?').get(userId)?.c || 0;
    inst.syncState.unresolvedLids = 0; // No LID issue with whatsapp-web.js
  } catch {}
  emit(userId, 'sync_state', inst.syncState);
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

export async function requestPairingWithPhone(userId, phoneNumber) {
  const inst = getInstance(userId);
  if (!inst.client) throw new Error('WhatsApp client not initialised');
  if (inst.connectionStatus === 'connected') throw new Error('Already connected');
  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  if (cleaned.length < 8) throw new Error('Invalid phone number');
  inst.pendingPairingPhone = cleaned;
  // whatsapp-web.js supports pairing codes via client.requestPairingCode
  try {
    const code = await inst.client.requestPairingCode(cleaned);
    inst.pairingCode = code;
    emit(userId, 'pairing_code', { code });
    return code;
  } catch (err) {
    throw new Error(`Pairing code request failed: ${err?.message || err}`);
  }
}

export function initWhatsApp(userId, db) {
  startConnection(userId, db);
  return {
    getState: () => getWhatsAppState(userId),
    sendTextMessage: (jid, text) => sendTextMessage(userId, jid, text),
    sendVoiceNote: (jid, audioBuffer) => sendVoiceNote(userId, jid, audioBuffer),
    reconnect: () => startConnection(userId, db, { force: true }),
    clearSession: () => clearSession(userId, db),
    getSocket: () => getInstance(userId).client,
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
    triggerSync: () => recoverSync(userId, db),
  };
}

export function getOrInitWhatsApp(userId, db) {
  const inst = getInstance(userId);
  if (!inst.client && inst.connectionStatus === 'disconnected') {
    return initWhatsApp(userId, db);
  }
  return {
    getState: () => getWhatsAppState(userId),
    sendTextMessage: (jid, text) => sendTextMessage(userId, jid, text),
    sendVoiceNote: (jid, audioBuffer) => sendVoiceNote(userId, jid, audioBuffer),
    reconnect: () => startConnection(userId, db, { force: true }),
    clearSession: () => clearSession(userId, db),
    getSocket: () => inst.client,
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
    triggerSync: () => recoverSync(userId, db),
  };
}

// ── Connection ──────────────────────────────────────────

async function startConnection(userId, db, options = {}) {
  const inst = getInstance(userId);
  const force = options.force === true;

  if (inst.isConnecting) return;
  if (!force && inst.client && inst.connectionStatus === 'connected') return;
  inst.isConnecting = true;

  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }

  const generation = inst.connectionGeneration + 1;
  inst.connectionGeneration = generation;

  // Destroy previous client
  if (inst.client) {
    try { await inst.client.destroy(); } catch {}
    inst.client = null;
  }

  try {
    const authDir = getUserAuthDir(userId);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: path.join(DATA_DIR, 'wwebjs_auth'),
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
      },
    });

    inst.client = client;

    // ── QR Code ──
    client.on('qr', (qr) => {
      if (generation !== inst.connectionGeneration) return;
      inst.qrCode = qr;
      inst.connectionStatus = 'qr_waiting';
      emit(userId, 'qr', qr);
      console.log(`📱 [${userId}] QR code received`);
    });

    // ── Ready (connected) ──
    client.on('ready', async () => {
      if (generation !== inst.connectionGeneration) return;
      if (inst.connectionStatus === 'connected') return;
      if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
      inst.qrCode = null;
      inst.pairingCode = null;
      inst.pendingPairingPhone = null;
      inst.connectionStatus = 'connected';
      inst.reconnectAttempt = 0;

      inst.syncState = {
        phase: 'waiting_history',
        connectedAt: new Date().toISOString(),
        lastHistorySyncAt: null,
        lastProgressAt: null,
        storeContacts: 0,
        historyChats: 0,
        historyContacts: 0,
        historyMessages: 0,
        unresolvedLids: 0,
        totalDbContacts: 0,
        totalDbMessages: 0,
      };

      emit(userId, 'connected', null);
      console.log(`✅ [${userId}] WhatsApp connected via whatsapp-web.js (gen ${generation})`);
      updateSyncState(userId, db, { phase: 'waiting_history', connectedAt: inst.syncState.connectedAt });

      // Start syncing contacts and chats
      syncContacts(userId, db).catch(err => console.error('Sync contacts error:', err?.message));

      // Schedule recovery after initial sync
      setTimeout(() => {
        if (inst.connectionStatus === 'connected') {
          recoverSync(userId, db).catch(err => console.error('Auto recovery sync error:', err?.message));
        }
      }, 30000);
    });

    // ── Disconnected ──
    client.on('disconnected', (reason) => {
      if (generation !== inst.connectionGeneration) return;
      console.warn(`⚠️ [${userId}] WhatsApp disconnected: ${reason}`);

      if (reason === 'LOGOUT' || reason === 'CONFLICT') {
        inst.connectionStatus = 'disconnected';
        inst.reconnectAttempt = 0;
        emit(userId, 'status', { status: 'disconnected' });
      } else {
        inst.connectionStatus = 'reconnecting';
        emit(userId, 'status', { status: 'reconnecting' });
        if (inst.reconnectTimer) clearTimeout(inst.reconnectTimer);
        const delays = [3000, 5000, 10000];
        const delay = delays[Math.min(inst.reconnectAttempt, delays.length - 1)];
        inst.reconnectAttempt++;
        inst.reconnectTimer = setTimeout(() => {
          if (generation !== inst.connectionGeneration) return;
          inst.reconnectTimer = null;
          startConnection(userId, db, { force: true });
        }, delay);
      }
    });

    // ── Authentication failure ──
    client.on('auth_failure', (msg) => {
      console.error(`❌ [${userId}] Auth failure:`, msg);
      inst.connectionStatus = 'disconnected';
      emit(userId, 'status', { status: 'disconnected' });
    });

    // ── Incoming messages ──
    client.on('message_create', async (msg) => {
      try {
        if (generation !== inst.connectionGeneration) return;

        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const jid = toJid(msg.from);
        const isFromMe = msg.fromMe;
        const isGroup = chat.isGroup;

        // Skip status broadcasts
        if (jid === 'status@broadcast' || msg.isStatus) {
          captureStatusUpdate(userId, db, inst, msg).catch(err => {
            console.error('Status capture error:', err?.message || err);
          });
          return;
        }

        // Resolve phone and name
        const phone = '+' + phoneFromJid(isFromMe ? toJid(msg.to) : jid);
        const resolvedJid = isFromMe ? toJid(msg.to) : jid;
        const contactName = contact?.pushname || contact?.name || contact?.shortName || null;
        const candidate = getNameCandidate(
          { name: contactName, pushName: contact?.pushname, notify: contact?.shortName }
        );

        const contactId = getOrCreateContact(db, userId, resolvedJid, phone, candidate, isGroup);
        if (!contactId) return;

        // Determine message type and content
        const { msgType, content, duration, mimetype } = getMessagePayload(msg);
        const direction = isFromMe ? 'sent' : 'received';
        const msgId = msg.id?._serialized || msg.id?.id || uuid();

        // Save voice media
        let mediaPath = null;
        if (msgType === 'voice' && msg.hasMedia) {
          mediaPath = await saveVoiceMedia(userId, msg, msgId, mimetype);
        }

        upsertMessageRecord(db, {
          id: msgId,
          userId,
          contactId,
          jid: resolvedJid,
          content,
          type: msgType,
          direction,
          timestamp: new Date(msg.timestamp * 1000).toISOString(),
          status: isFromMe ? 'sent' : 'delivered',
          duration,
          mediaPath,
        });

        emit(userId, 'message', { contactId, msgId });

        if (!isFromMe) {
          // Increment unread count
          try {
            db.prepare("UPDATE contacts SET unread_count = unread_count + 1 WHERE id = ? AND user_id = ?").run(contactId, userId);
          } catch {}

          db.prepare(`INSERT INTO stats (user_id, event, data) VALUES (?, 'message_received', ?)`).run(userId, JSON.stringify({ contactId }));

          if (!isGroup) {
            handleAutoReply(userId, db, contactId, resolvedJid, phone, contactName, msg).catch(err => {
              console.error('Auto-reply error:', err?.message || err);
            });
          }
        }
      } catch (err) {
        console.error('message_create handler error:', err?.message || err);
      }
    });

    // ── Call events ──
    client.on('call', async (call) => {
      try {
        const callerJid = toJid(call.from);
        const phone = '+' + phoneFromJid(callerJid);
        let callerName = null;
        try {
          const contact = await inst.client.getContactById(call.from);
          callerName = contact?.pushname || contact?.name || null;
        } catch {}

        const callId = call.id || uuid();
        const isVideo = !!call.isVideo;
        const isGroup = !!call.isGroup;
        const callStatus = 'missed';

        db.prepare(`
          INSERT OR REPLACE INTO call_logs (id, user_id, caller_jid, caller_phone, caller_name, is_video, is_group, status, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(callId, userId, callerJid, phone, callerName, isVideo ? 1 : 0, isGroup ? 1 : 0, callStatus, new Date().toISOString());

        emit(userId, 'call', { callId, callerJid, callerName, callerPhone: phone, isVideo, status: callStatus });
        console.log(`📞 [${userId}] ${callStatus} ${isVideo ? 'video' : 'voice'} call from ${callerName || phone}`);
      } catch (err) {
        console.error('Call event error:', err?.message || err);
      }
    });

    // Initialize client
    await client.initialize();
    console.log(`🔄 [${userId}] WhatsApp client initializing...`);
  } catch (err) {
    console.error(`startConnection error [${userId}]:`, err?.message || err);
    inst.connectionStatus = 'reconnecting';
    emit(userId, 'status', { status: 'reconnecting' });
    inst.reconnectTimer = setTimeout(() => startConnection(userId, db), 3000);
  } finally {
    inst.isConnecting = false;
  }
}

// ── Message payload extraction ──

function getMessagePayload(msg) {
  let msgType = 'text';
  let content = msg.body || '';
  let duration = null;
  let mimetype = null;

  if (msg.type === 'ptt' || msg.type === 'audio') {
    msgType = 'voice';
    content = msg.body || '🎤 Voice message';
    duration = msg.duration || null;
    mimetype = msg.mimetype || 'audio/ogg; codecs=opus';
  } else if (msg.type === 'image') {
    msgType = 'image';
    content = msg.body || msg.caption || '';
  } else if (msg.type === 'video') {
    msgType = 'video';
    content = msg.body || msg.caption || '';
  } else if (msg.type === 'document') {
    msgType = 'document';
    content = msg.body || msg.caption || '';
  }

  return { msgType, content, duration, mimetype, isVoice: msgType === 'voice' };
}

// ── Voice media download ──

async function saveVoiceMedia(userId, msg, msgId, mimetype) {
  try {
    if (!fs.existsSync(VOICE_MEDIA_DIR)) fs.mkdirSync(VOICE_MEDIA_DIR, { recursive: true });
    const filename = `${msgId}.${getAudioFileExtension(mimetype)}`;
    const filePath = path.join(VOICE_MEDIA_DIR, filename);

    if (hasSavedVoiceFile(filePath)) return filename;

    const media = await msg.downloadMedia();
    if (!media?.data) return null;

    const buffer = Buffer.from(media.data, 'base64');
    if (buffer.length === 0) return null;

    fs.writeFileSync(filePath, buffer);
    return filename;
  } catch (err) {
    console.log(`🎤 [${userId}] Voice download failed: ${err?.message}`);
    return null;
  }
}

// ── Contact management ──

function formatUnresolvedContactName(jid, candidateName) {
  if (candidateName) return candidateName;
  const suffix = phoneFromJid(jid).slice(-4);
  return suffix ? `WhatsApp contact • ${suffix}` : 'WhatsApp contact';
}

function mergeContactRecords(db, userId, sourceContactId, targetContactId, targetJid) {
  if (!sourceContactId || !targetContactId || sourceContactId === targetContactId) return;
  db.prepare('UPDATE messages SET contact_id = ?, jid = ? WHERE contact_id = ? AND user_id = ?')
    .run(targetContactId, targetJid, sourceContactId, userId);
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(sourceContactId, userId);
}

function getOrCreateContact(db, userId, jid, phone, candidate, isGroup = false, activityAt = null) {
  const safePhone = phone && phone !== '+' ? phone : null;
  const existing = db.prepare('SELECT id, jid, name, phone FROM contacts WHERE jid = ? AND user_id = ?').get(jid, userId);

  const phoneMatch = safePhone
    ? db.prepare(`
        SELECT id, jid, name, phone
        FROM contacts
        WHERE user_id = ? AND phone = ? AND is_group = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(userId, safePhone, isGroup ? 1 : 0)
    : null;

  const resolvedName = candidate?.name || phone || formatUnresolvedContactName(jid, null);
  let target = existing;

  if (existing && phoneMatch && phoneMatch.id !== existing.id) {
    const existingComparisonPhone = safePhone || existing.phone || '';
    const phoneMatchCandidate = phoneMatch.name
      ? { name: phoneMatch.name, priority: NAME_PRIORITY.saved }
      : null;

    if (phoneMatchCandidate && shouldReplaceName(phoneMatchCandidate, existing.name, existingComparisonPhone)) {
      db.prepare("UPDATE contacts SET name = ?, phone = COALESCE(?, phone), is_group = ?, updated_at = datetime('now') WHERE id = ?")
        .run(phoneMatch.name, safePhone, isGroup ? 1 : 0, existing.id);
    }

    mergeContactRecords(db, userId, phoneMatch.id, existing.id, jid);
  } else if (!existing && phoneMatch) {
    target = phoneMatch;
  }

  if (target) {
    const comparisonPhone = safePhone || target.phone || '';
    const shouldUpdateName = shouldReplaceName(candidate, target.name, comparisonPhone);
    const nextName = shouldUpdateName ? resolvedName : target.name;

    db.prepare("UPDATE contacts SET jid = ?, name = ?, phone = COALESCE(?, phone), is_group = ?, updated_at = COALESCE(?, datetime('now')) WHERE id = ?")
      .run(jid, nextName, safePhone, isGroup ? 1 : 0, activityAt, target.id);

    if (target.jid !== jid) {
      db.prepare('UPDATE messages SET jid = ? WHERE contact_id = ? AND user_id = ?')
        .run(jid, target.id, userId);
    }

    return target.id;
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO contacts (id, user_id, jid, name, phone, is_group, updated_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
  `).run(id, userId, jid, resolvedName, safePhone, isGroup ? 1 : 0, activityAt);
  return id;
}

// ── Contact Sync ──

async function syncContacts(userId, db) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;

  console.log(`📇 [${userId}] Contact sync initiated`);

  try {
    const contacts = await inst.client.getContacts();
    console.log(`📇 [${userId}] Found ${contacts.length} contacts`);
    updateSyncState(userId, db, { storeContacts: contacts.length });

    let syncedCount = 0;
    for (const c of contacts) {
      try {
        if (!c.id?._serialized) continue;
        const jid = toJid(c.id._serialized);
        if (jid === 'status@broadcast') continue;
        const phone = '+' + phoneFromJid(jid);
        const isGroup = c.isGroup || jid.endsWith('@g.us');
        const candidate = getNameCandidate({ name: c.name, pushName: c.pushname, notify: c.shortName, verifiedName: c.verifiedName });
        getOrCreateContact(db, userId, jid, phone, candidate, isGroup);

        // Cache for later use
        inst.contactCache.set(jid, { name: c.name || c.pushname || c.shortName, phone });
        syncedCount++;
      } catch {}
    }

    if (syncedCount > 0) {
      emit(userId, 'contacts_sync', { count: syncedCount });
      console.log(`📇 [${userId}] Synced ${syncedCount} contacts`);
    }

    // Now sync chats
    await syncChats(userId, db);
  } catch (err) {
    console.error(`Contact sync error [${userId}]:`, err?.message || err);
  }
}

async function syncChats(userId, db) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;

  try {
    const chats = await inst.client.getChats();
    console.log(`📇 [${userId}] Found ${chats.length} chats`);
    updateSyncState(userId, db, {
      phase: 'importing',
      lastHistorySyncAt: new Date().toISOString(),
      historyChats: chats.length,
    });

    let contactChanges = 0;
    let messageCount = 0;

    for (const chat of chats) {
      try {
        const jid = toJid(chat.id._serialized);
        if (jid === 'status@broadcast') continue;
        const phone = '+' + phoneFromJid(jid);
        const isGroup = chat.isGroup;
        const candidate = getNameCandidate({ name: chat.name, pushName: chat.name });

        const contactId = getOrCreateContact(db, userId, jid, phone, candidate, isGroup);
        if (!contactId) continue;
        contactChanges++;

        // Sync archive status
        if (chat.archived) {
          try {
            db.prepare("UPDATE contacts SET is_archived = 1 WHERE id = ? AND user_id = ?").run(contactId, userId);
          } catch {}
        }

        // Sync unread count
        if (chat.unreadCount > 0) {
          try {
            db.prepare("UPDATE contacts SET unread_count = ? WHERE id = ? AND user_id = ?").run(chat.unreadCount, contactId, userId);
          } catch {}
        }

        // Fetch recent messages for this chat
        try {
          const messages = await chat.fetchMessages({ limit: 50 });
          for (const msg of messages) {
            try {
              if (!msg.body && !msg.hasMedia) continue;

              const { msgType, content, duration, mimetype } = getMessagePayload(msg);
              const msgId = msg.id?._serialized || msg.id?.id || uuid();
              const direction = msg.fromMe ? 'sent' : 'received';

              let mediaPath = null;
              if (msgType === 'voice' && msg.hasMedia) {
                mediaPath = await saveVoiceMedia(userId, msg, msgId, mimetype);
              }

              upsertMessageRecord(db, {
                id: msgId,
                userId,
                contactId,
                jid,
                content,
                type: msgType,
                direction,
                timestamp: new Date(msg.timestamp * 1000).toISOString(),
                status: msg.fromMe ? 'sent' : 'delivered',
                duration,
                mediaPath,
              });
              messageCount++;
            } catch {}
          }
        } catch (err) {
          console.log(`📜 [${userId}] Failed to fetch messages for ${jid}: ${err?.message}`);
        }
      } catch {}
    }

    console.log(`📇 [${userId}] Synced ${contactChanges} chats, ${messageCount} messages`);
    updateSyncState(userId, db, {
      phase: 'ready',
      historyContacts: contactChanges,
      historyMessages: messageCount,
      lastProgressAt: new Date().toISOString(),
    });

    if (contactChanges > 0) {
      emit(userId, 'contacts_sync', { count: contactChanges });
    }
    emit(userId, 'history_sync', { chats: contactChanges, messages: messageCount });
  } catch (err) {
    console.error(`Chat sync error [${userId}]:`, err?.message || err);
    updateSyncState(userId, db, { phase: 'partial' });
  }
}

// ── Recovery Sync ──

async function recoverSync(userId, db) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;

  console.log(`🔄 [${userId}] Recovery sync started`);
  updateSyncState(userId, db, { phase: 'recovering' });
  emit(userId, 'sync_state', inst.syncState);

  await syncContacts(userId, db);

  const phase = (inst.syncState.totalDbMessages > 10 && inst.syncState.totalDbContacts > 0) ? 'ready' : 'partial';
  updateSyncState(userId, db, { phase });
  console.log(`🔄 [${userId}] Recovery sync complete — phase: ${phase}`);
}

// ── Recover single chat ──

export async function recoverSingleChat(userId, db, contactId) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }

  const contact = db.prepare('SELECT jid FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!contact) throw new Error('Contact not found');

  const chatId = fromJid(contact.jid);
  console.log(`📜 [${userId}] On-demand history request for ${contact.jid}`);

  try {
    const chat = await inst.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 100 });

    let count = 0;
    for (const msg of messages) {
      try {
        if (!msg.body && !msg.hasMedia) continue;
        const { msgType, content, duration, mimetype } = getMessagePayload(msg);
        const msgId = msg.id?._serialized || msg.id?.id || uuid();

        let mediaPath = null;
        if (msgType === 'voice' && msg.hasMedia) {
          mediaPath = await saveVoiceMedia(userId, msg, msgId, mimetype);
        }

        upsertMessageRecord(db, {
          id: msgId,
          userId,
          contactId,
          jid: contact.jid,
          content,
          type: msgType,
          direction: msg.fromMe ? 'sent' : 'received',
          timestamp: new Date(msg.timestamp * 1000).toISOString(),
          status: msg.fromMe ? 'sent' : 'delivered',
          duration,
          mediaPath,
        });
        count++;
      } catch {}
    }

    emit(userId, 'history_sync', { chats: 1, messages: count });
    return { success: true, message: `Recovered ${count} messages for this chat.` };
  } catch (err) {
    return { success: false, message: `Failed to recover chat: ${err?.message}` };
  }
}

// ── Auto-reply ──

function getConfigValue(db, userId, key, fallback) {
  const row = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = ?").get(userId, key);
  return row?.value ?? fallback;
}

function isWithinActiveHours(db, userId) {
  const start = getConfigValue(db, userId, 'ai_active_hours_start', '10:00');
  const end = getConfigValue(db, userId, 'ai_active_hours_end', '23:00');
  const timezone = getConfigValue(db, userId, 'ai_timezone', 'America/New_York');

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

async function sendReaction(userId, jid, msg, emoji) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;
  try {
    await msg.react(emoji);
  } catch (err) {
    console.error('Failed to send reaction:', err?.message);
  }
}

async function handleAutoReply(userId, db, contactId, jid, phone, contactName, originalMsg) {
  const autoConfig = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'automation_enabled'").get(userId);
  if (!autoConfig || autoConfig.value !== 'true') return;

  // Skip archived chats
  const contactRow = db.prepare('SELECT is_archived FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (contactRow?.is_archived) return;

  if (!isWithinActiveHours(db, userId)) return;

  const replyChance = parseInt(getConfigValue(db, userId, 'ai_reply_chance', '70'), 10);
  if (Math.random() * 100 > replyChance) {
    const reactionEmoji = shouldReact();
    if (reactionEmoji && originalMsg) {
      const reactDelay = Math.floor(Math.random() * 5000) + 2000;
      setTimeout(() => sendReaction(userId, jid, originalMsg, reactionEmoji), reactDelay);
    }
    return;
  }

  const inst = getInstance(userId);
  const existing = inst.messageBatchBuffers.get(jid);
  if (existing) clearTimeout(existing.timer);

  const batchEntry = existing || { messages: [], contactId, phone, contactName, originalMsg };
  batchEntry.originalMsg = originalMsg;

  batchEntry.timer = setTimeout(() => {
    inst.messageBatchBuffers.delete(jid);
    executeAutoReply(userId, db, contactId, jid, phone, contactName, originalMsg).catch(err => {
      console.error('Batched auto-reply error:', err?.message || err);
    });
  }, 8000);

  inst.messageBatchBuffers.set(jid, batchEntry);
}

async function executeAutoReply(userId, db, contactId, jid, phone, contactName, originalMsg) {
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
  if (reactionEmoji && originalMsg) {
    const reactDelay = Math.floor(Math.random() * 3000) + 1000;
    setTimeout(() => sendReaction(userId, jid, originalMsg, reactionEmoji), reactDelay);
    if (!shouldAlsoReplyAfterReaction()) {
      inst.autoReplyCooldowns.set(jid, Date.now());
      return;
    }
  }

  let replyText = await generateReply(keyRow.value, messages, systemPrompt, contactName || phone);
  replyText = replyText.replace(/[—–-]{2,}/g, ' ').replace(/—/g, ' ').replace(/–/g, ' ');
  const delay = calculateDelay(lastMsgContent.length, speed);

  setTimeout(async () => {
    try {
      // Send typing indicator
      const chatId = fromJid(jid);
      try {
        const chat = await inst.client.getChatById(chatId);
        await chat.sendStateTyping();
      } catch {}

      const typingDuration = Math.floor(Math.random() * 2000) + 2000;
      setTimeout(async () => {
        try {
          const sent = await sendTextMessage(userId, jid, replyText);
          const replyId = sent?.id?._serialized || uuid();

          // Clear typing
          try {
            const chat = await inst.client.getChatById(chatId);
            await chat.clearState();
          } catch {}

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

// ── Send messages ──

async function sendTextMessage(userId, jid, text) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  const chatId = fromJid(jid);
  return await inst.client.sendMessage(chatId, text);
}

async function sendVoiceNote(userId, jid, audioBuffer) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  const chatId = fromJid(jid);

  try {
    const media = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'), 'voice.ogg');
    const result = await inst.client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    console.log(`🎤 [${userId}] Voice note sent to ${jid}`);
    return result;
  } catch (pttErr) {
    console.warn(`⚠️ [${userId}] PTT send failed, retrying as audio: ${pttErr?.message}`);
    try {
      const media = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'), 'voice.ogg');
      const result = await inst.client.sendMessage(chatId, media);
      console.log(`🎤 [${userId}] Voice note sent as audio to ${jid}`);
      return result;
    } catch (audioErr) {
      console.error(`❌ [${userId}] Both PTT and audio send failed: ${audioErr?.message}`);
      throw new Error(`Voice note delivery failed: ${audioErr?.message || 'unknown error'}`);
    }
  }
}

// ── Clear session ──

async function clearSession(userId, db) {
  const inst = getInstance(userId);
  inst.connectionStatus = 'disconnected';
  inst.qrCode = null;
  inst.pairingCode = null;
  inst.pendingPairingPhone = null;
  inst.reconnectAttempt = 0;
  inst.autoReplyCooldowns.clear();
  inst.messageBatchBuffers.forEach(entry => clearTimeout(entry.timer));
  inst.messageBatchBuffers.clear();
  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
  if (inst.syncGraceTimer) { clearTimeout(inst.syncGraceTimer); inst.syncGraceTimer = null; }

  inst.syncState = {
    phase: 'idle',
    connectedAt: null,
    lastHistorySyncAt: null,
    storeContacts: 0,
    historyChats: 0,
    historyContacts: 0,
    historyMessages: 0,
    unresolvedLids: 0,
    totalDbContacts: 0,
    totalDbMessages: 0,
  };

  if (inst.client) {
    try { await inst.client.logout(); } catch {}
    try { await inst.client.destroy(); } catch {}
    inst.client = null;
  }

  // Wipe user data
  try {
    db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM contacts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM stats WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM call_logs WHERE user_id = ?').run(userId);
  } catch (err) {
    console.error('Failed to clear DB tables:', err?.message || err);
  }

  // Delete user auth directory (legacy Baileys path)
  const authDir = getUserAuthDir(userId);
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  fs.mkdirSync(authDir, { recursive: true });

  // Remove the wwebjs LocalAuth session data
  const wwLocalAuth = path.join(DATA_DIR, 'wwebjs_auth', `session-${userId}`);
  if (fs.existsSync(wwLocalAuth)) {
    fs.rmSync(wwLocalAuth, { recursive: true, force: true });
  }
  // Also try the default .wwebjs_auth path
  const wwLocalAuthDefault = path.join(DATA_DIR, '.wwebjs_auth', `session-${userId}`);
  if (fs.existsSync(wwLocalAuthDefault)) {
    fs.rmSync(wwLocalAuthDefault, { recursive: true, force: true });
  }

  inst.isConnecting = false;
  emit(userId, 'status', { status: 'disconnected' });
  emit(userId, 'sync_state', inst.syncState);
  console.log(`🗑️ [${userId}] Session fully cleared.`);
}

// ── Status (Stories) capture ──

async function captureStatusUpdate(userId, db, inst, msg) {
  try {
    if (!msg.isStatus && msg.from !== 'status@broadcast') return;
    const contact = await msg.getContact();
    const senderJid = toJid(contact?.id?._serialized || msg.author || msg.from);
    const phone = '+' + phoneFromJid(senderJid);
    const senderName = contact?.pushname || contact?.name || null;

    const isImage = msg.type === 'image';
    const isVideo = msg.type === 'video';

    let mediaType = 'text';
    let content = msg.body || '';
    let mediaPath = null;

    if (isImage) mediaType = 'image';
    else if (isVideo) mediaType = 'video';

    // Download media
    if ((isImage || isVideo) && msg.hasMedia) {
      try {
        if (!fs.existsSync(STATUS_MEDIA_DIR)) fs.mkdirSync(STATUS_MEDIA_DIR, { recursive: true });
        const media = await msg.downloadMedia();
        if (media?.data) {
          const ext = isImage ? 'jpg' : 'mp4';
          const filename = `${uuid()}.${ext}`;
          const filePath = path.join(STATUS_MEDIA_DIR, filename);
          fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
          mediaPath = filename;
        }
      } catch (err) {
        console.error('Status media download failed:', err?.message || err);
      }
    }

    const ts = new Date(msg.timestamp * 1000).toISOString();
    const expiresAt = new Date(msg.timestamp * 1000 + 24 * 60 * 60 * 1000).toISOString();
    const statusId = msg.id?._serialized || msg.id?.id || uuid();

    db.prepare(`
      INSERT OR IGNORE INTO statuses (id, user_id, sender_jid, sender_phone, sender_name, content, media_type, media_path, timestamp, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(statusId, userId, senderJid, phone, senderName, content, mediaType, mediaPath, ts, expiresAt);

    emit(userId, 'status_update', { senderJid, senderName, mediaType });
  } catch (err) {
    console.error('captureStatusUpdate error:', err?.message || err);
  }
}

export function getStatuses(db, userId) {
  db.prepare("DELETE FROM statuses WHERE user_id = ? AND expires_at < datetime('now')").run(userId);

  const rows = db.prepare(`
    SELECT * FROM statuses WHERE user_id = ? ORDER BY timestamp ASC
  `).all(userId);

  const grouped = {};
  for (const row of rows) {
    const key = row.sender_jid;
    if (!grouped[key]) {
      grouped[key] = {
        senderJid: row.sender_jid,
        senderPhone: row.sender_phone,
        senderName: row.sender_name,
        statuses: [],
      };
    }
    if (row.sender_name) grouped[key].senderName = row.sender_name;
    grouped[key].statuses.push({
      id: row.id,
      content: row.content,
      mediaType: row.media_type,
      mediaPath: row.media_path,
      timestamp: row.timestamp,
    });
  }

  return Object.values(grouped);
}

export function getCallLogs(db, userId) {
  return db.prepare(`
    SELECT * FROM call_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 200
  `).all(userId);
}

// ── Sync Diagnostics ──

export function getSyncDiagnostics(userId, db) {
  const inst = getInstance(userId);

  const totalContacts = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE user_id = ? AND is_group = 0').get(userId)?.c || 0;
  const unnamedContacts = db.prepare(`
    SELECT COUNT(*) as c FROM contacts
    WHERE user_id = ? AND is_group = 0 AND jid LIKE '%@s.whatsapp.net'
      AND (name IS NULL OR name = '' OR name LIKE '+%' OR name LIKE 'WhatsApp contact%' OR name GLOB '[0-9]*')
  `).get(userId)?.c || 0;
  const emptyChats = db.prepare(`
    SELECT COUNT(*) as c FROM contacts c
    WHERE c.user_id = ? AND c.is_group = 0
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = c.id AND m.user_id = ?)
  `).get(userId, userId)?.c || 0;
  const totalMessages = db.prepare('SELECT COUNT(*) as c FROM messages WHERE user_id = ?').get(userId)?.c || 0;

  const topUnnamed = db.prepare(`
    SELECT id, jid, name, phone FROM contacts
    WHERE user_id = ? AND is_group = 0 AND jid LIKE '%@s.whatsapp.net'
      AND (name IS NULL OR name = '' OR name LIKE '+%' OR name LIKE 'WhatsApp contact%' OR name GLOB '[0-9]*')
    ORDER BY updated_at DESC LIMIT 10
  `).all(userId);

  return {
    totalContacts,
    unnamedContacts,
    emptyChats,
    totalMessages,
    unresolvedLids: 0,
    storeContactCount: inst.contactCache.size,
    lidMapSize: 0,
    syncState: { ...inst.syncState },
    topUnnamed: topUnnamed.map(c => ({ id: c.id, jid: c.jid, name: c.name, phone: c.phone })),
  };
}

// ── Delete message ──

export async function deleteMessage(userId, db, messageId) {
  const inst = getInstance(userId);
  const msg = db.prepare('SELECT id, contact_id, jid, direction FROM messages WHERE id = ? AND user_id = ?').get(messageId, userId);
  if (!msg) throw new Error('Message not found');

  // Delete from WhatsApp if connected
  if (inst.client && inst.connectionStatus === 'connected') {
    try {
      const chatId = fromJid(msg.jid);
      const chat = await inst.client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit: 50 });
      const waMsg = messages.find(m => (m.id?._serialized === messageId || m.id?.id === messageId));
      if (waMsg && msg.direction === 'sent') {
        await waMsg.delete(true); // delete for everyone
      }
      console.log(`🗑️ [${userId}] Deleted message ${messageId} from WhatsApp`);
    } catch (err) {
      console.log(`🗑️ [${userId}] WhatsApp delete failed (removing locally): ${err?.message}`);
    }
  }

  db.prepare('DELETE FROM messages WHERE id = ? AND user_id = ?').run(messageId, userId);
  return { success: true };
}

// ── Delete conversation ──

export async function deleteConversation(userId, db, contactId) {
  const inst = getInstance(userId);
  const contact = db.prepare('SELECT jid FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!contact) throw new Error('Contact not found');

  if (inst.client && inst.connectionStatus === 'connected') {
    try {
      const chatId = fromJid(contact.jid);
      const chat = await inst.client.getChatById(chatId);
      await chat.clearMessages();
      console.log(`🗑️ [${userId}] Cleared chat ${contact.jid} on WhatsApp`);
    } catch (err) {
      console.log(`🗑️ [${userId}] WhatsApp chat clear failed: ${err?.message}`);
    }
  }

  const deleted = db.prepare('DELETE FROM messages WHERE contact_id = ? AND user_id = ?').run(contactId, userId);
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(contactId, userId);
  return { success: true, deletedMessages: deleted.changes };
}

// ── Archive / Unarchive chat ──

export async function archiveChat(userId, db, contactId, archive) {
  const inst = getInstance(userId);
  const contact = db.prepare('SELECT jid FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!contact) throw new Error('Contact not found');

  if (inst.client && inst.connectionStatus === 'connected') {
    try {
      const chatId = fromJid(contact.jid);
      const chat = await inst.client.getChatById(chatId);
      if (archive) {
        await chat.archive();
      } else {
        await chat.unarchive();
      }
      console.log(`📦 [${userId}] ${archive ? 'Archived' : 'Unarchived'} chat ${contact.jid} on WhatsApp`);
    } catch (err) {
      console.log(`📦 [${userId}] WhatsApp archive failed: ${err?.message}`);
    }
  }

  db.prepare("UPDATE contacts SET is_archived = ? WHERE id = ? AND user_id = ?").run(archive ? 1 : 0, contactId, userId);
  return { success: true, archived: archive };
}

// ── Mark chat as read ──

export async function markChatRead(userId, db, contactId) {
  const inst = getInstance(userId);
  const contact = db.prepare('SELECT jid FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!contact) throw new Error('Contact not found');

  if (inst.client && inst.connectionStatus === 'connected') {
    try {
      const chatId = fromJid(contact.jid);
      const chat = await inst.client.getChatById(chatId);
      await chat.sendSeen();
    } catch (err) {
      console.log(`📖 [${userId}] WhatsApp mark-read failed: ${err?.message}`);
    }
  }

  db.prepare("UPDATE contacts SET unread_count = 0 WHERE id = ? AND user_id = ?").run(contactId, userId);
  return { success: true };
}
