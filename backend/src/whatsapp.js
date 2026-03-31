import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { execSync } from 'child_process';
import { generateReply, shouldReact, shouldAlsoReplyAfterReaction } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const VOICE_MEDIA_DIR = path.join(DATA_DIR, 'voice-media');
const MESSAGE_MEDIA_DIR = path.join(DATA_DIR, 'message-media');
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
      heartbeatTimer: null,
      isConnecting: false,
      reconnectAttempt: 0,
      connectionGeneration: 0,
      autoReplyCooldowns: new Map(),
      messageBatchBuffers: new Map(),
      pendingAutoReplies: new Map(),
      contactCache: new Map(),
      archiveSyncTimer: null,
      recoverySyncTimer: null,
      connectionWatchdogTimer: null,
      historySyncInProgress: false,
      contactSyncInProgress: false,
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
      connectionPhase: 'idle',
      connectionStartedAtMs: 0,
      lastConnectionActivityAtMs: 0,
      lastDisconnectReason: null,
      failedReplyQueue: [],
    });
  }
  return userInstances.get(userId);
}

function getHistoricalAccountSize(userId, db) {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE((SELECT COUNT(*) FROM contacts WHERE user_id = ? AND is_group = 0), 0) AS contact_count,
        COALESCE((SELECT COUNT(*) FROM messages WHERE user_id = ?), 0) AS message_count
    `).get(userId, userId);

    return {
      contactCount: Number(row?.contact_count || 0),
      messageCount: Number(row?.message_count || 0),
    };
  } catch {
    return { contactCount: 0, messageCount: 0 };
  }
}

function getAccountScale(userId, db) {
  const { contactCount, messageCount } = getHistoricalAccountSize(userId, db);

  if (contactCount >= 5000 || messageCount >= 15000) {
    return 'huge';
  }

  if (contactCount >= 1500 || messageCount >= 5000) {
    return 'large';
  }

  return 'standard';
}

function getRestoreWatchdogTimeoutMs(userId, db, stage = 'restoring session') {
  const scale = getAccountScale(userId, db);
  const normalizedStage = String(stage || '').toLowerCase();

  if (normalizedStage.includes('authenticated') || normalizedStage.includes('loading')) {
    if (scale === 'huge') return 12 * 60 * 1000;
    if (scale === 'large') return 8 * 60 * 1000;
    return 4 * 60 * 1000;
  }

  if (normalizedStage.includes('pairing') || normalizedStage.includes('opening')) {
    if (scale === 'huge') return 6 * 60 * 1000;
    if (scale === 'large') return 4 * 60 * 1000;
    return 2 * 60 * 1000;
  }

  if (scale === 'huge') return 6 * 60 * 1000;
  if (scale === 'large') return 4 * 60 * 1000;
  return 120 * 1000;
}

function getReconnectStaleThresholdMs(userId, db) {
  const scale = getAccountScale(userId, db);
  if (scale === 'huge') return 4 * 60 * 1000;
  if (scale === 'large') return 2 * 60 * 1000;
  return 90 * 1000;
}

function getBackgroundContactSyncDelayMs(userId, db) {
  const scale = getAccountScale(userId, db);
  if (scale === 'huge') return 45000;
  if (scale === 'large') return 20000;
  return 10000;
}

function getRecoverySyncDelayMs(userId, db) {
  const scale = getAccountScale(userId, db);
  if (scale === 'huge') return 180000;
  if (scale === 'large') return 120000;
  return 90000;
}

function noteConnectionActivity(userId, phase) {
  const inst = getInstance(userId);
  const now = Date.now();
  if (!inst.connectionStartedAtMs) {
    inst.connectionStartedAtMs = now;
  }
  inst.lastConnectionActivityAtMs = now;
  inst.connectionPhase = phase;
}

function armConnectionWatchdog(userId, db, generation, stage) {
  noteConnectionActivity(userId, stage);
  startConnectionWatchdog(userId, db, generation, getRestoreWatchdogTimeoutMs(userId, db, stage), stage);
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

async function resolveSendTargets(client, jid) {
  const candidates = new Set();
  const normalized = fromJid(jid);
  const barePhone = jid.endsWith('@g.us') || jid === 'status@broadcast'
    ? ''
    : phoneFromJid(jid).replace(/[^0-9]/g, '');

  try {
    const chats = await client.getChats();
    for (const chat of chats) {
      const serialized = chat?.id?._serialized;
      if (!serialized) continue;
      const normalizedChatJid = toJid(serialized);
      const normalizedChatPhone = normalizedChatJid.endsWith('@g.us') || normalizedChatJid === 'status@broadcast'
        ? ''
        : phoneFromJid(normalizedChatJid).replace(/[^0-9]/g, '');

      if (normalizedChatJid === jid || (barePhone && normalizedChatPhone === barePhone)) {
        candidates.add(serialized);
      }
    }
  } catch {}

  if (normalized) candidates.add(normalized);
  if (jid) candidates.add(jid);

  if (barePhone) {
    candidates.add(`${barePhone}@c.us`);
    candidates.add(`${barePhone}@s.whatsapp.net`);
    try {
      const numberId = await client.getNumberId(barePhone);
      const serialized =
        numberId?._serialized ||
        numberId?.id?._serialized ||
        (typeof numberId === 'string' ? numberId : null);
      if (serialized) candidates.add(serialized);
    } catch {}
  }

  return Array.from(candidates).filter(Boolean);
}

async function sendToResolvedTarget(userId, jid, executor) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }

  const targets = await resolveSendTargets(inst.client, jid);

  // If jid is @lid, also try the phone number from contacts DB
  if (jid.endsWith('@lid')) {
    try {
      const { db } = await import('./db.js');
      const contact = db.prepare('SELECT phone FROM contacts WHERE jid = ? AND user_id = ?').get(jid, userId);
      if (contact?.phone) {
        const digits = contact.phone.replace(/[^0-9]/g, '');
        if (digits.length >= 7) {
          targets.push(`${digits}@c.us`);
          try {
            const numberId = await inst.client.getNumberId(digits);
            const serialized = numberId?._serialized || numberId?.id?._serialized || (typeof numberId === 'string' ? numberId : null);
            if (serialized) targets.push(serialized);
          } catch {}
        }
      }
    } catch {}
  }

  if (targets.length === 0) {
    throw new Error('No valid WhatsApp target found');
  }

  let lastError = null;

  for (const target of targets) {
    try {
      const chat = await inst.client.getChatById(target);
      return await executor({ client: inst.client, target, chat });
    } catch (err) {
      lastError = err;
    }

    try {
      if (typeof inst.client.getContactById === 'function') {
        await inst.client.getContactById(target);
        const chat = await inst.client.getChatById(target);
        return await executor({ client: inst.client, target, chat });
      }
    } catch (err) {
      lastError = lastError || err;
    }

    try {
      return await executor({ client: inst.client, target, chat: null });
    } catch (err) {
      lastError = lastError || err;
    }
  }

  throw new Error(lastError?.message || 'Failed to send message');
}

function phoneFromJid(jid) {
  return jid.replace(/@(s\.whatsapp\.net|c\.us|g\.us|lid)$/, '');
}

function normalizeContactPhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : null;
}

function getCanonicalPhoneCandidate(jid, phone) {
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return null;
  const normalizedPhone = normalizeContactPhone(phone);
  if (normalizedPhone && !String(phone || '').includes('@')) return normalizedPhone;
  if (jid.endsWith('@s.whatsapp.net')) {
    const digits = phoneFromJid(jid).replace(/[^0-9]/g, '');
    return digits ? `+${digits}` : null;
  }
  return null;
}

function getStatusMediaAbsolutePath(mediaPath) {
  const safeName = path.basename(String(mediaPath || ''));
  return safeName ? path.join(STATUS_MEDIA_DIR, safeName) : null;
}

function removeStatusMediaFile(mediaPath) {
  const fullPath = getStatusMediaAbsolutePath(mediaPath);
  if (!fullPath || !fs.existsSync(fullPath)) return;
  try {
    fs.unlinkSync(fullPath);
  } catch {}
}

function purgeExpiredStatuses(db, userId) {
  const expiredRows = db.prepare(`
    SELECT id, media_path FROM statuses
    WHERE user_id = ? AND datetime(expires_at) <= datetime('now')
  `).all(userId);

  for (const row of expiredRows) {
    if (row.media_path) removeStatusMediaFile(row.media_path);
  }

  if (expiredRows.length > 0) {
    db.prepare("DELETE FROM statuses WHERE user_id = ? AND datetime(expires_at) <= datetime('now')").run(userId);
  }

  return expiredRows.map((row) => row.id).filter(Boolean);
}

function getAudioFileExtension(mimetype) {
  const normalized = String(mimetype || '').toLowerCase();
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('mp4') || normalized.includes('aac') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  return 'ogg';
}

function hasSavedMediaFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function sanitizeStoredFilename(value) {
  const cleaned = String(value || '')
    .replace(/[\\/]/g, '_')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .trim();
  return cleaned || null;
}

function getMediaFileExtension(mimetype, fallbackName = '') {
  const extFromName = path.extname(fallbackName || '').replace(/^\./, '').toLowerCase();
  if (extFromName) return extFromName;

  const normalized = String(mimetype || '').toLowerCase();
  if (!normalized) return 'bin';
  if (normalized.includes('jpeg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.includes('word')) return 'docx';
  if (normalized.includes('excel') || normalized.includes('spreadsheet')) return 'xlsx';
  if (normalized.includes('powerpoint') || normalized.includes('presentation')) return 'pptx';
  if (normalized.includes('zip')) return 'zip';
  if (normalized.includes('json')) return 'json';
  if (normalized.includes('plain')) return 'txt';
  return 'bin';
}

function getDefaultMediaName(msgType, extension) {
  const ext = extension ? `.${extension}` : '';
  if (msgType === 'voice') return `voice-note${ext || '.ogg'}`;
  if (msgType === 'image') return `image${ext || '.jpg'}`;
  if (msgType === 'video') return `video${ext || '.mp4'}`;
  if (msgType === 'document') return `document${ext || '.bin'}`;
  return `attachment${ext || '.bin'}`;
}

function upsertMessageRecord(db, { id, userId, contactId, jid, content, type, direction, timestamp, status, duration, mediaPath, mediaName, mediaMime, isViewOnce, isEdited, replyToId, replyToContent, replyToSender }) {
  // Ensure columns exist
  try {
    const cols = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
    if (!cols.includes('is_edited')) db.exec("ALTER TABLE messages ADD COLUMN is_edited INTEGER DEFAULT 0");
    if (!cols.includes('is_starred')) db.exec("ALTER TABLE messages ADD COLUMN is_starred INTEGER DEFAULT 0");
    if (!cols.includes('reply_to_id')) db.exec("ALTER TABLE messages ADD COLUMN reply_to_id TEXT");
    if (!cols.includes('reply_to_content')) db.exec("ALTER TABLE messages ADD COLUMN reply_to_content TEXT");
    if (!cols.includes('reply_to_sender')) db.exec("ALTER TABLE messages ADD COLUMN reply_to_sender TEXT");
  } catch {}

  db.prepare(`
    INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, duration, media_path, media_name, media_mime, is_view_once, is_edited, reply_to_id, reply_to_content, reply_to_sender)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      media_path = COALESCE(excluded.media_path, messages.media_path),
      media_name = COALESCE(excluded.media_name, messages.media_name),
      media_mime = COALESCE(excluded.media_mime, messages.media_mime),
      is_view_once = COALESCE(excluded.is_view_once, messages.is_view_once),
      is_edited = CASE WHEN excluded.is_edited = 1 THEN 1 ELSE messages.is_edited END,
      reply_to_id = COALESCE(excluded.reply_to_id, messages.reply_to_id),
      reply_to_content = COALESCE(excluded.reply_to_content, messages.reply_to_content),
      reply_to_sender = COALESCE(excluded.reply_to_sender, messages.reply_to_sender)
  `).run(id, userId, contactId, jid, content, type, direction, timestamp, status, duration, mediaPath, mediaName, mediaMime, isViewOnce ? 1 : 0, isEdited ? 1 : 0, replyToId || null, replyToContent || null, replyToSender || null);
}

async function editMessage(userId, db, messageId, newContent) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }

  // Get the message from DB
  const row = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ? AND direction = ?').get(messageId, userId, 'sent');
  if (!row) throw new Error('Message not found or not editable');
  if (row.type !== 'text') throw new Error('Only text messages can be edited');

  // Try to edit via whatsapp-web.js
  try {
    const msg = await inst.client.getMessageById(messageId);
    if (!msg) throw new Error('Message not found in WhatsApp');
    await msg.edit(newContent);
  } catch (err) {
    throw new Error(`Failed to edit message: ${err?.message || err}`);
  }

  // Update in DB
  db.prepare('UPDATE messages SET content = ?, is_edited = 1 WHERE id = ? AND user_id = ?').run(newContent, messageId, userId);
  emit(userId, 'message_edited', { messageId, newContent });
  return { success: true };
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// ── Exports ──────────────────────────────────────────────

export function cancelAllPendingReplies(userId) {
  const inst = getInstance(userId);
  const count = inst.pendingAutoReplies.size;
  if (count === 0) return 0;
  inst.pendingAutoReplies.forEach((_, jid) => clearPendingAutoReply(userId, jid));
  console.log(`🚫 [${userId}] Cancelled ${count} pending auto-replies (automation disabled)`);
  return count;
}

export function cancelPendingReplyForContact(userId, contactIdentifier) {
  const inst = getInstance(userId);
  // contactIdentifier can be a JID, phone, or contact name
  for (const [jid, pending] of inst.pendingAutoReplies.entries()) {
    if (jid === contactIdentifier || pending.phone === contactIdentifier || pending.contactName === contactIdentifier) {
      clearPendingAutoReply(userId, jid);
      console.log(`🚫 [${userId}] Cancelled pending reply for ${contactIdentifier}`);
      return true;
    }
  }
  return false;
}

export function getWhatsAppState(userId) {
  const inst = getInstance(userId);
  return {
    status: inst.connectionStatus,
    qr: inst.qrCode,
    pairingCode: inst.pairingCode,
    syncState: { ...inst.syncState },
  };
}

function getPossibleSessionDirs(userId) {
  return [
    path.join(DATA_DIR, 'wwebjs_auth', `session-${userId}`),
    path.join(DATA_DIR, '.wwebjs_auth', `session-${userId}`),
  ];
}

function sessionDirHasPayload(sessionDir) {
  try {
    if (!fs.existsSync(sessionDir)) return false;
    const entries = fs.readdirSync(sessionDir);
    return entries.some((entry) => {
      try {
        const stats = fs.statSync(path.join(sessionDir, entry));
        return stats.isFile() ? stats.size > 0 : stats.isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function hasSavedSession(userId) {
  try {
    return getPossibleSessionDirs(userId).some(sessionDirHasPayload);
  } catch {
    return false;
  }
}

function isReconnectStale(userId, db) {
  const inst = getInstance(userId);
  if (inst.connectionStatus !== 'reconnecting') return false;
  const lastActivityAt = inst.lastConnectionActivityAtMs || inst.connectionStartedAtMs || 0;
  if (!lastActivityAt) return false;
  const watchdogTimeoutMs = getRestoreWatchdogTimeoutMs(userId, db, inst.connectionPhase || 'restoring session');
  const staleThresholdMs = Math.min(watchdogTimeoutMs, getReconnectStaleThresholdMs(userId, db));
  return Date.now() - lastActivityAt > staleThresholdMs;
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

  // Ensure the browser-side onCodeReceivedEvent function exists.
  // When the client was initialized in QR mode (no pairWithPhoneNumber option),
  // this function is never exposed, causing requestPairingCode() to crash.
  try {
    const page = inst.client?.pupPage;
    if (page) {
      await page.evaluate(() => {
        if (typeof window.onCodeReceivedEvent !== 'function') {
          window.onCodeReceivedEvent = (code) => {
            window._pairingCode = code;
          };
        }
      });
    }
  } catch (setupErr) {
    console.warn(`[${userId}] Failed to expose onCodeReceivedEvent:`, setupErr?.message);
  }

  try {
    const code = await inst.client.requestPairingCode(cleaned);
    inst.pairingCode = code;
    emit(userId, 'pairing_code', { code });
    return code;
  } catch (err) {
    inst.pairingCode = null;
    const message = String(err?.message || err || 'Unknown error');
    if (/onCodeReceivedEvent is not a function/i.test(message)) {
      // Second attempt: try waiting for the client to be in a better state
      console.warn(`[${userId}] onCodeReceivedEvent still missing after injection, falling back to QR`);
      throw new Error('Phone pairing failed — please use QR code instead. Open WhatsApp on your phone → Linked Devices → Link a Device.');
    }
    throw new Error(`Pairing code request failed: ${message}`);
  }
}

export function initWhatsApp(userId, db) {
  startConnection(userId, db);
  return {
    getState: () => getWhatsAppState(userId),
    sendTextMessage: (jid, text, options) => sendTextMessage(userId, jid, text, options),
    sendMediaMessage: (jid, payload) => sendMediaMessage(userId, jid, payload),
    sendVoiceNote: (jid, audioBuffer) => sendVoiceNote(userId, jid, audioBuffer),
    editMessage: (messageId, newContent) => editMessage(userId, db, messageId, newContent),
    reconnect: (options = {}) => startConnection(userId, db, typeof options === 'boolean' ? { force: options } : { force: options.force !== false }),
    disconnect: () => softDisconnect(userId),
    clearSession: () => clearSession(userId, db),
    getSocket: () => getInstance(userId).client,
    getMessageById: (msgId) => getInstance(userId).client?.getMessageById(msgId),
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
    triggerSync: () => recoverSync(userId, db),
  };
}

export function getOrInitWhatsApp(userId, db) {
  const inst = getInstance(userId);

  const savedSessionExists = hasSavedSession(userId);
  const reconnectIsStale = isReconnectStale(userId, db);

  if (savedSessionExists && ((!inst.client && !inst.isConnecting) || reconnectIsStale)) {
    if (reconnectIsStale) {
      console.warn(`♻️ [${userId}] Reconnect went stale during ${inst.connectionPhase || 'restoring session'}; forcing a fresh restore attempt`);
    }
    startConnection(userId, db, { force: true }).catch((err) => {
      console.error(`Auto-resume failed [${userId}]:`, err?.message || err);
    });
  }

  return {
    getState: () => getWhatsAppState(userId),
    sendTextMessage: (jid, text, options) => sendTextMessage(userId, jid, text, options),
    sendMediaMessage: (jid, payload) => sendMediaMessage(userId, jid, payload),
    sendVoiceNote: (jid, audioBuffer) => sendVoiceNote(userId, jid, audioBuffer),
    editMessage: (messageId, newContent) => editMessage(userId, db, messageId, newContent),
    reconnect: (options = {}) => startConnection(userId, db, typeof options === 'boolean' ? { force: options } : { force: options.force !== false }),
    disconnect: () => softDisconnect(userId),
    clearSession: () => clearSession(userId, db),
    getSocket: () => inst.client,
    getMessageById: (msgId) => inst.client?.getMessageById(msgId),
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
    triggerSync: () => recoverSync(userId, db),
    getInstance: () => inst,
  };
}

// ── Reconnect & Heartbeat helpers ────────────────────────

function scheduleReconnect(userId, db, generation) {
  const inst = getInstance(userId);
  if (inst.reconnectTimer) clearTimeout(inst.reconnectTimer);
  const delays = [3000, 5000, 10000, 15000, 30000, 60000];
  const delay = delays[Math.min(inst.reconnectAttempt, delays.length - 1)];
  inst.reconnectAttempt++;
  console.log(`🔁 [${userId}] Reconnect attempt #${inst.reconnectAttempt} in ${delay / 1000}s`);
  inst.reconnectTimer = setTimeout(() => {
    if (generation !== inst.connectionGeneration) return;
    inst.reconnectTimer = null;
    startConnection(userId, db, { force: true });
  }, delay);
}

function normalizeConnectionReason(value) {
  return String(value || '').trim().toUpperCase();
}

function requiresFreshPairing(reason) {
  const normalized = normalizeConnectionReason(reason);
  return normalized === 'LOGOUT' || normalized === 'UNPAIRED' || normalized === 'UNPAIRED_IDLE';
}

function isRecoverableConnectionIssue(reason) {
  const normalized = normalizeConnectionReason(reason);
  return normalized === 'CONFLICT' || normalized === 'TIMEOUT' || normalized === 'UNLAUNCHED' || normalized === 'NAVIGATION';
}

function startHeartbeat(userId, db) {
  const inst = getInstance(userId);
  stopHeartbeat(userId);
  inst.heartbeatTimer = setInterval(async () => {
    if (inst.connectionStatus !== 'connected' || !inst.client) {
      stopHeartbeat(userId);
      return;
    }
    try {
      const state = await inst.client.getState();
      if (state !== 'CONNECTED') {
        console.warn(`💔 [${userId}] Heartbeat detected state: ${state}, triggering reconnect`);
        inst.connectionStatus = 'reconnecting';
        emit(userId, 'status', { status: 'reconnecting' });
        stopHeartbeat(userId);
        scheduleReconnect(userId, db, inst.connectionGeneration);
      }
    } catch (err) {
      console.warn(`💔 [${userId}] Heartbeat failed: ${err?.message}, triggering reconnect`);
      inst.connectionStatus = 'reconnecting';
      emit(userId, 'status', { status: 'reconnecting' });
      stopHeartbeat(userId);
      scheduleReconnect(userId, db, inst.connectionGeneration);
    }
  }, 30000); // Check every 30s
}

function stopHeartbeat(userId) {
  const inst = userInstances.get(userId);
  if (inst?.heartbeatTimer) {
    clearInterval(inst.heartbeatTimer);
    inst.heartbeatTimer = null;
  }
}

function clearRecoverySyncTimer(userId) {
  const inst = userInstances.get(userId);
  if (inst?.recoverySyncTimer) {
    clearTimeout(inst.recoverySyncTimer);
    inst.recoverySyncTimer = null;
  }
}

function clearConnectionWatchdog(userId) {
  const inst = userInstances.get(userId);
  if (inst?.connectionWatchdogTimer) {
    clearTimeout(inst.connectionWatchdogTimer);
    inst.connectionWatchdogTimer = null;
  }
}

function startConnectionWatchdog(userId, db, generation, timeoutMs = 75000, stage = 'initializing') {
  const inst = getInstance(userId);
  clearConnectionWatchdog(userId);
  inst.connectionWatchdogTimer = setTimeout(async () => {
    if (generation !== inst.connectionGeneration) return;
    if (inst.connectionStatus === 'connected' || inst.connectionStatus === 'qr_waiting') return;

    const lastActivityAt = inst.lastConnectionActivityAtMs || inst.connectionStartedAtMs || Date.now();
    const idleMs = Date.now() - lastActivityAt;
    const minExpectedIdleMs = Math.max(timeoutMs - 2500, 0);
    if (idleMs < minExpectedIdleMs) {
      startConnectionWatchdog(userId, db, generation, timeoutMs - idleMs, stage);
      return;
    }

    console.warn(`⏱️ [${userId}] Connection watchdog fired after ${Math.round(idleMs / 1000)}s idle while ${stage}; forcing fresh reconnect`);
    stopHeartbeat(userId);
    clearConnectionWatchdog(userId);

    if (inst.client) {
      const staleClient = inst.client;
      inst.client = null;
      try { await staleClient.destroy(); } catch {}
    }

    inst.isConnecting = false;
    inst.connectionStatus = 'reconnecting';
    emit(userId, 'status', { status: 'reconnecting' });
    startConnection(userId, db, { force: true });
  }, timeoutMs);
}

function scheduleRecoverySync(userId, db, delayMs = 90000) {
  const inst = getInstance(userId);
  clearRecoverySyncTimer(userId);
  inst.recoverySyncTimer = setTimeout(() => {
    inst.recoverySyncTimer = null;
    if (inst.connectionStatus !== 'connected') return;

    if (inst.historySyncInProgress || inst.contactSyncInProgress) {
      scheduleRecoverySync(userId, db, 45000);
      return;
    }

    const needsRecovery =
      inst.syncState.totalDbContacts === 0 ||
      inst.syncState.totalDbMessages < 25 ||
      ['waiting_history', 'partial', 'recovering'].includes(inst.syncState.phase);

    if (!needsRecovery) return;

    recoverSync(userId, db).catch(err => {
      console.error(`Scheduled recovery sync error [${userId}]:`, err?.message || err);
    });
  }, delayMs);
}

// ── Auto-reconnect all users on server start ─────────────

export function autoReconnectAll(db) {
  try {
    const usersWithSessions = db.prepare('SELECT id, username FROM users').all()
      .filter((user) => hasSavedSession(user.id));

    usersWithSessions.forEach((user, index) => {
      const delayMs = index * 12000;
      console.log(`🔄 Queued auto-reconnect for ${user.username} (${user.id}) in ${Math.round(delayMs / 1000)}s`);
      setTimeout(() => {
        const inst = getInstance(user.id);
        if (inst.connectionStatus === 'connected' || inst.isConnecting) return;
        console.log(`🔄 Auto-reconnecting user: ${user.username} (${user.id})`);
        startConnection(user.id, db, { force: true }).catch((err) => {
          console.error(`Auto-reconnect failed [${user.id}]:`, err?.message || err);
        });
      }, delayMs);
    });
  } catch (err) {
    console.error('Auto-reconnect error:', err?.message);
  }
}

// ── Connection ──────────────────────────────────────────

async function startConnection(userId, db, options = {}) {
  const inst = getInstance(userId);
  const force = options.force === true;

  // If stuck connecting for >90s, force-reset the lock (reduced from 2min)
  if (inst.isConnecting && !force) {
    const stuckMs = Date.now() - (inst.connectionStartedAtMs || 0);
    if (stuckMs > 90_000) {
      console.warn(`⚠️ [${userId}] isConnecting stuck for ${Math.round(stuckMs / 1000)}s — force-resetting`);
      inst.isConnecting = false;
    } else {
      return;
    }
  }
  if (!force && inst.client && inst.connectionStatus === 'connected') return;
  inst.isConnecting = true;
  inst.connectionStartedAtMs = Date.now();
  inst.lastConnectionActivityAtMs = inst.connectionStartedAtMs;
  inst.connectionPhase = force ? 'forcing reconnect' : 'starting connection';
  inst.lastDisconnectReason = null;

  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }

  const generation = inst.connectionGeneration + 1;
  inst.connectionGeneration = generation;

  // Destroy previous client and kill any zombie Chromium browser
  if (inst.client) {
    try {
      const browser = inst.client.pupBrowser;
      if (browser) await browser.close().catch(() => {});
    } catch {}
    try { await inst.client.destroy(); } catch {}
    inst.client = null;
  }

  // Force-kill ALL orphaned Chromium processes that lock the userDataDir
  // This is the real fix for "browser is already running" errors
  try {
    const sessionDir = path.join(DATA_DIR, 'wwebjs_auth', `session-${userId}`);
    // Kill any chromium using this specific session directory
    try {
      execSync(`pkill -f "userDataDir=${sessionDir}" 2>/dev/null || true`, { timeout: 5000 });
    } catch {}
    // Also kill any chromium with this userId in args
    try {
      execSync(`pkill -f "session-${userId}" 2>/dev/null || true`, { timeout: 5000 });
    } catch {}
    // Remove the SingletonLock file that prevents new browser launch
    const lockFile = path.join(sessionDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log(`🔓 [${userId}] Removed browser SingletonLock`);
    }
    // Also check Default profile dir
    const defaultLock = path.join(sessionDir, 'Default', 'SingletonLock');
    if (fs.existsSync(defaultLock)) {
      fs.unlinkSync(defaultLock);
    }
  } catch (e) {
    console.warn(`⚠️ [${userId}] Lock cleanup: ${e?.message}`);
  }

  // Clean wwebjs cache (can get corrupted after logout/crash)
  const cacheDir = path.join(DATA_DIR, 'wwebjs_cache');
  try {
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log(`🧹 [${userId}] Cleaned wwebjs_cache`);
    }
  } catch (e) {
    console.warn(`⚠️ [${userId}] Failed to clean cache: ${e?.message}`);
  }

  try {
    const authDir = getUserAuthDir(userId);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: path.join(DATA_DIR, 'wwebjs_auth'),
      }),
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--mute-audio',
        ],
      },
    });

    inst.client = client;
    inst.connectionStatus = 'reconnecting';
    emit(userId, 'status', { status: 'reconnecting' });
    armConnectionWatchdog(userId, db, generation, 'restoring session');

    // ── QR Code ──
    client.on('qr', (qr) => {
      if (generation !== inst.connectionGeneration) return;
      clearConnectionWatchdog(userId);
      noteConnectionActivity(userId, 'qr_waiting');
      inst.qrCode = qr;
      inst.connectionStatus = 'qr_waiting';
      emit(userId, 'qr', qr);
      console.log(`📱 [${userId}] QR code received`);
    });

    client.on('loading_screen', (percent, message) => {
      if (generation !== inst.connectionGeneration) return;
      if (inst.connectionStatus === 'connected' || inst.connectionStatus === 'qr_waiting') return;
      const stage = `loading ${percent || 0}%${message ? ` (${message})` : ''}`;
      armConnectionWatchdog(userId, db, generation, stage);
      console.log(`⏳ [${userId}] ${stage}`);
    });

    // ── Ready (connected) ──
    client.on('ready', async () => {
      if (generation !== inst.connectionGeneration) return;
      if (inst.connectionStatus === 'connected') return;
      clearConnectionWatchdog(userId);
      clearRecoverySyncTimer(userId);
      if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
      noteConnectionActivity(userId, 'connected');
      inst.qrCode = null;
      inst.pairingCode = null;
      inst.pendingPairingPhone = null;
      inst.connectionStatus = 'connected';
      inst.reconnectAttempt = 0;
      startHeartbeat(userId, db);

      // Drain any failed reply queue from before disconnect
      drainFailedReplyQueue(userId, db);

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
      console.log(`✅ [${userId}] WhatsApp connected via whatsapp-web.js (gen ${generation}) after ${Math.round((Date.now() - inst.connectionStartedAtMs) / 1000)}s`);
      updateSyncState(userId, db, { phase: 'waiting_history', connectedAt: inst.syncState.connectedAt });

      // Start core chat sync first for large accounts so history appears earlier
      syncChats(userId, db).catch(err => console.error('Sync chats error:', err?.message));

      // Refresh the full contact book in the background after chat import has started
      setTimeout(() => {
        if (generation !== inst.connectionGeneration) return;
        if (inst.connectionStatus === 'connected') {
          syncContacts(userId, db, { skipChatSync: true }).catch(err => console.error('Background contact sync error:', err?.message));
        }
      }, getBackgroundContactSyncDelayMs(userId, db));

      // Only attempt a follow-up recovery pass after the main import had real time to settle
      scheduleRecoverySync(userId, db, getRecoverySyncDelayMs(userId, db));

      // Sync archive states after initial sync
      setTimeout(() => {
        if (generation !== inst.connectionGeneration) return;
        if (inst.connectionStatus === 'connected') {
          syncArchiveStates(userId, db).catch(err => console.error('Auto archive sync error:', err?.message));
        }
      }, 15000);

      // Periodic archive sync every 2 minutes
      if (inst.archiveSyncTimer) clearInterval(inst.archiveSyncTimer);
      inst.archiveSyncTimer = setInterval(() => {
        if (inst.connectionStatus === 'connected') {
          syncArchiveStates(userId, db).catch(err => console.error('Periodic archive sync error:', err?.message));
        }
      }, 120000);
    });

    // ── Disconnected ──
    // ── Connection state changes (detects silent drops) ──
    client.on('change_state', (state) => {
      if (generation !== inst.connectionGeneration) return;
      noteConnectionActivity(userId, `state:${state}`);
      console.log(`🔄 [${userId}] Connection state changed: ${state}`);
      if (requiresFreshPairing(state)) {
        inst.connectionStatus = 'disconnected';
        inst.reconnectAttempt = 0;
        emit(userId, 'status', { status: 'disconnected' });
      } else if (isRecoverableConnectionIssue(state)) {
        inst.connectionStatus = 'reconnecting';
        emit(userId, 'status', { status: 'reconnecting' });
        stopHeartbeat(userId);
        scheduleReconnect(userId, db, generation);
      } else if (state === 'PAIRING') {
        if (inst.connectionStatus === 'connected') {
          inst.connectionStatus = 'reconnecting';
          emit(userId, 'status', { status: 'reconnecting' });
          scheduleReconnect(userId, db, generation);
        } else {
          armConnectionWatchdog(userId, db, generation, 'pairing');
        }
      } else if (state === 'TIMEOUT') {
        if (inst.connectionStatus === 'connected') {
          inst.connectionStatus = 'reconnecting';
          emit(userId, 'status', { status: 'reconnecting' });
          scheduleReconnect(userId, db, generation);
        } else {
          armConnectionWatchdog(userId, db, generation, 'restoring session');
        }
      } else if (inst.connectionStatus !== 'connected' && inst.connectionStatus !== 'qr_waiting') {
        armConnectionWatchdog(userId, db, generation, state === 'OPENING' ? 'opening transport' : 'restoring session');
      }
    });

    // ── Authenticated (session restored, before ready) ──
    client.on('authenticated', () => {
      if (generation !== inst.connectionGeneration) return;
      armConnectionWatchdog(userId, db, generation, 'authenticated session');
      console.log(`🔑 [${userId}] WhatsApp authenticated (session restored)`);
    });

    // ── Disconnected ──
    client.on('disconnected', (reason) => {
      if (generation !== inst.connectionGeneration) return;
      console.warn(`⚠️ [${userId}] WhatsApp disconnected: ${reason}`);
      stopHeartbeat(userId);
      clearConnectionWatchdog(userId);
      clearRecoverySyncTimer(userId);
      inst.lastDisconnectReason = reason || null;
      inst.connectionPhase = 'disconnected';
      inst.lastConnectionActivityAtMs = Date.now();
      inst.historySyncInProgress = false;
      inst.contactSyncInProgress = false;
      if (inst.archiveSyncTimer) { clearInterval(inst.archiveSyncTimer); inst.archiveSyncTimer = null; }

      if (requiresFreshPairing(reason)) {
        inst.connectionStatus = 'disconnected';
        inst.reconnectAttempt = 0;
        emit(userId, 'status', { status: 'disconnected' });
      } else {
        inst.connectionStatus = 'reconnecting';
        emit(userId, 'status', { status: 'reconnecting' });
        scheduleReconnect(userId, db, generation);
      }
    });

    // ── Authentication failure ──
    client.on('auth_failure', (msg) => {
      console.error(`❌ [${userId}] Auth failure:`, msg);
      stopHeartbeat(userId);
      clearConnectionWatchdog(userId);
      clearRecoverySyncTimer(userId);
      inst.lastDisconnectReason = msg || 'auth_failure';
      inst.connectionPhase = 'auth_failure';
      inst.lastConnectionActivityAtMs = Date.now();
      inst.historySyncInProgress = false;
      inst.contactSyncInProgress = false;
      if (inst.archiveSyncTimer) { clearInterval(inst.archiveSyncTimer); inst.archiveSyncTimer = null; }
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
        const { msgType, content, duration, mimetype, mediaName } = getMessagePayload(msg);
        const direction = isFromMe ? 'sent' : 'received';
        const msgId = msg.id?._serialized || msg.id?.id || uuid();
        const isViewOnce = !!(msg.isViewOnce || msg._data?.isViewOnce);

        let mediaPath = null;
        let resolvedMediaName = mediaName;
        let resolvedMediaMime = mimetype;
        let resolvedContent = content;

        if (isViewOnce && msg.hasMedia) {
          // View-once media: don't try to download, show placeholder
          const typeLabel = msgType === 'video' ? '🎥 Video' : msgType === 'voice' ? '🎤 Voice note' : '📷 Photo';
          resolvedContent = `${typeLabel} (view once) — open WhatsApp on your phone to view`;
        } else if (msg.hasMedia && ['voice', 'image', 'video', 'document', 'sticker'].includes(msgType)) {
          const savedMedia = await saveMessageMedia(userId, msg, msgId, {
            msgType,
            mimetype,
            mediaName,
          });
          mediaPath = savedMedia?.mediaPath || null;
          resolvedMediaName = savedMedia?.mediaName || mediaName || null;
          resolvedMediaMime = savedMedia?.mediaMime || mimetype || null;
        }

        // Capture quoted message context
        let replyToId = null, replyToContent = null, replyToSender = null;
        try {
          if (msg.hasQuotedMsg) {
            const quoted = await msg.getQuotedMessage();
            if (quoted) {
              replyToId = quoted.id?._serialized || null;
              replyToContent = (quoted.body || '').slice(0, 200);
              const quotedContact = await quoted.getContact?.();
              replyToSender = quotedContact?.pushname || quotedContact?.name || (quoted.fromMe ? 'You' : null);
            }
          }
        } catch {}

        upsertMessageRecord(db, {
          id: msgId,
          userId,
          contactId,
          jid: resolvedJid,
          content: resolvedContent,
          type: isViewOnce ? 'text' : msgType,
          direction,
          timestamp: new Date(msg.timestamp * 1000).toISOString(),
          status: isFromMe ? 'sent' : 'delivered',
          duration,
          mediaPath,
          mediaName: resolvedMediaName,
          mediaMime: resolvedMediaMime,
          isViewOnce,
          replyToId,
          replyToContent,
          replyToSender,
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

        // Also save as a message in the chat so it appears in conversation
        const contactId = getOrCreateContact(db, userId, callerJid, phone, callerName, isGroup);
        if (contactId) {
          const callMsgId = `call_${callId}`;
          const callContent = `${isVideo ? 'Video' : 'Voice'} call`;
          const ts = new Date().toISOString();
          db.prepare(`
            INSERT OR IGNORE INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status)
            VALUES (?, ?, ?, ?, ?, 'call', 'received', ?, 'received')
          `).run(callMsgId, userId, contactId, callerJid, callContent, ts);

          emit(userId, 'new_message', { contactId, messageId: callMsgId, type: 'call' });
        }

        emit(userId, 'call', { callId, callerJid, callerName, callerPhone: phone, isVideo, status: callStatus });
        console.log(`📞 [${userId}] ${callStatus} ${isVideo ? 'video' : 'voice'} call from ${callerName || phone}`);
      } catch (err) {
        console.error('Call event error:', err?.message || err);
      }
    });

    // ── Message edit events ──
    client.on('message_edit', async (msg, newBody, prevBody) => {
      try {
        const msgId = msg.id?._serialized || msg.id?.id;
        if (!msgId) return;
        const existing = db.prepare('SELECT id FROM messages WHERE id = ? AND user_id = ?').get(msgId, userId);
        if (existing) {
          db.prepare('UPDATE messages SET content = ?, is_edited = 1 WHERE id = ? AND user_id = ?').run(newBody, msgId, userId);
          emit(userId, 'message_edited', { messageId: msgId, newContent: newBody });
          console.log(`✏️ [${userId}] Message edited: ${msgId}`);
        }
      } catch (err) {
        console.error('message_edit handler error:', err?.message || err);
      }
    });

    // ── Message ACK (delivery/read receipts) ──
    client.on('message_ack', (msg, ack) => {
      try {
        if (generation !== inst.connectionGeneration) return;
        if (!msg.fromMe) return; // Only track acks for messages we sent
        const msgId = msg.id?._serialized || msg.id?.id;
        if (!msgId) return;

        // ACK levels: -1=error, 0=pending, 1=sent, 2=delivered, 3=read, 4=played
        let newStatus = null;
        if (ack === 2) newStatus = 'delivered';
        else if (ack >= 3) newStatus = 'read';
        if (!newStatus) return;

        db.prepare('UPDATE messages SET status = ? WHERE id = ? AND user_id = ?').run(newStatus, msgId, userId);
        emit(userId, 'message_ack', { messageId: msgId, status: newStatus });
      } catch (err) {
        console.error('message_ack handler error:', err?.message || err);
      }
    });

    // ── Reaction events ──
    client.on('message_reaction', async (reaction) => {
      try {
        if (generation !== inst.connectionGeneration) return;
        const msgId = reaction.msgId?._serialized || reaction.msgId?.id;
        if (!msgId) return;
        const senderJid = toJid(reaction.senderId || reaction.id?.participant || '');
        const emoji = reaction.reaction || '';
        const ts = Date.now();

        // Update reactions JSON in DB
        const row = db.prepare('SELECT reactions FROM messages WHERE id = ? AND user_id = ?').get(msgId, userId);
        if (!row) return;

        let reactions = [];
        try { reactions = JSON.parse(row.reactions || '[]'); } catch {}

        if (emoji) {
          // Remove existing reaction from same sender, then add new one
          reactions = reactions.filter(r => r.sender !== senderJid);
          reactions.push({ emoji, sender: senderJid, timestamp: ts });
        } else {
          // Empty emoji = reaction removed
          reactions = reactions.filter(r => r.sender !== senderJid);
        }

        db.prepare('UPDATE messages SET reactions = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(reactions), msgId, userId);
        emit(userId, 'message_reaction', { messageId: msgId, reactions });
        console.log(`${emoji || '❌'} [${userId}] Reaction on ${msgId} from ${senderJid}`);
      } catch (err) {
        console.error('message_reaction handler error:', err?.message || err);
      }
    });

    // Handle message/status revocations (delete for everyone)
    client.on('message_revoke_everyone', async (after, before) => {
      try {
        if (!before) return;
        const jid = toJid(before.from);

        // If it's a status broadcast deletion, remove from statuses table
        if (jid === 'status@broadcast' || before.isStatus) {
          const statusId = before.id?._serialized || before.id;
          if (statusId) {
            const row = db.prepare('SELECT media_path FROM statuses WHERE id = ? AND user_id = ?').get(statusId, userId);
            if (row?.media_path) removeStatusMediaFile(row.media_path);
            db.prepare('DELETE FROM statuses WHERE id = ? AND user_id = ?').run(statusId, userId);
            emit(userId, 'status_deleted', { statusId });
            console.log(`🗑️ [${userId}] Status deleted: ${statusId}`);
          }
          return;
        }
      } catch (err) {
        console.error('message_revoke_everyone error:', err?.message || err);
      }
    });

    // Initialize client with a timeout to prevent infinite hangs
    const INIT_TIMEOUT_MS = 60_000; // 60s — if no QR/auth by then, something is stuck
    let initTimedOut = false;
    const initPromise = client.initialize();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => { initTimedOut = true; reject(new Error('initialize() timed out after 60s')); }, INIT_TIMEOUT_MS)
    );
    await Promise.race([initPromise, timeoutPromise]);
    console.log(`🔄 [${userId}] WhatsApp client initialized successfully`);
  } catch (err) {
    console.error(`startConnection error [${userId}]:`, err?.message || err);
    clearConnectionWatchdog(userId);

    // Force-kill the stale client if it timed out or crashed
    if (inst.client) {
      const deadClient = inst.client;
      inst.client = null;
      try {
        const browser = deadClient.pupBrowser;
        if (browser) await browser.close().catch(() => {});
      } catch {}
      try { await deadClient.destroy(); } catch {}
    }

    inst.lastDisconnectReason = String(err?.message || err || 'start_error');
    inst.connectionPhase = 'start_error';
    inst.lastConnectionActivityAtMs = Date.now();
    inst.connectionStatus = 'reconnecting';
    emit(userId, 'status', { status: 'reconnecting' });
    scheduleReconnect(userId, db, inst.connectionGeneration);
  } finally {
    inst.isConnecting = false;
  }
}

// ── Message payload extraction ──

function getMessagePayload(msg) {
  let msgType = 'text';
  let content = msg.body || msg.caption || '';
  let duration = null;
  let mimetype = msg.mimetype || null;
  let mediaName = sanitizeStoredFilename(msg.filename || msg._data?.filename || null);

  const rawType = String(msg.type || '').toLowerCase();

  if (rawType === 'ptt' || rawType === 'audio') {
    msgType = 'voice';
    content = msg.body || '🎤 Voice message';
    duration = msg.duration || null;
    mimetype = msg.mimetype || 'audio/ogg; codecs=opus';
    mediaName = mediaName || 'voice-note.ogg';
  } else if (rawType === 'sticker') {
    msgType = 'sticker';
    content = msg.body || msg.caption || '';
  } else if (rawType === 'image') {
    msgType = 'image';
    content = msg.body || msg.caption || '';
  } else if (rawType === 'video' || rawType === 'gif') {
    msgType = 'video';
    content = msg.body || msg.caption || '';
  } else if (rawType === 'document') {
    msgType = 'document';
    content = msg.body || msg.caption || mediaName || 'Document';
  } else if (msg.hasMedia) {
    if (String(mimetype || '').startsWith('image/')) {
      msgType = 'image';
    } else if (String(mimetype || '').startsWith('video/')) {
      msgType = 'video';
    } else if (String(mimetype || '').startsWith('audio/')) {
      msgType = 'voice';
      duration = msg.duration || null;
      content = msg.body || '🎤 Voice message';
      mediaName = mediaName || 'voice-note.ogg';
    } else {
      msgType = 'document';
      content = msg.body || msg.caption || mediaName || 'Attachment';
    }
  }

  if (msgType === 'document' && !content) {
    content = mediaName || 'Document';
  }

  return { msgType, content, duration, mimetype, mediaName, isVoice: msgType === 'voice' };
}

// ── Voice media download ──

async function saveMessageMedia(userId, msg, msgId, options = {}) {
  // Hybrid mode: try to download and cache media to disk at receive time
  // Fall back to wa: reference for on-demand streaming if download fails
  try {
    const resolvedMime = options.mimetype || msg.mimetype || 'application/octet-stream';
    const resolvedName = sanitizeStoredFilename(msg.filename || msg._data?.filename || options.mediaName || null);
    const extension = getMediaFileExtension(resolvedMime, resolvedName || '');
    const defaultName = resolvedName || getDefaultMediaName(options.msgType, extension);

    // Try to download media now and save to disk
    try {
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media?.data) {
          const mediaDir = path.join(__dirname, '..', 'data', 'message-media');
          if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

          const safeId = String(msgId).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
          const ext = extension ? `.${extension}` : '';
          const filename = `${safeId}${ext}`;
          const filePath = path.join(mediaDir, filename);

          fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
          console.log(`📦 [${userId}] Cached media to disk: ${filename} (${options.msgType || msg.type})`);

          return {
            mediaPath: filename,
            mediaName: defaultName,
            mediaMime: media.mimetype || resolvedMime,
          };
        }
      }
    } catch (dlErr) {
      console.log(`📦 [${userId}] Media download failed, using wa: ref (${options.msgType || msg.type}): ${dlErr?.message}`);
    }

    // Fallback: store wa: reference for on-demand streaming
    const mediaRef = `wa:${msgId}`;
    return {
      mediaPath: mediaRef,
      mediaName: defaultName,
      mediaMime: resolvedMime,
    };
  } catch (err) {
    console.log(`📦 [${userId}] Media metadata extraction failed (${options.msgType || msg.type}): ${err?.message}`);
    return {
      mediaPath: null,
      mediaName: options.mediaName || null,
      mediaMime: options.mimetype || msg.mimetype || null,
    };
  }
}

async function saveVoiceMedia(userId, msg, msgId, mimetype) {
  const savedMedia = await saveMessageMedia(userId, msg, msgId, {
    msgType: 'voice',
    mimetype,
    mediaName: `voice-note.${getAudioFileExtension(mimetype)}`,
  });
  return savedMedia?.mediaPath || null;
}

// ── On-demand media streaming from WhatsApp ──

export async function streamMediaForMessage(userId, messageId) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }

  try {
    const msg = await inst.client.getMessageById(messageId);
    if (!msg) throw new Error('Message not found in WhatsApp');
    if (!msg.hasMedia) throw new Error('Message has no media');

    const media = await msg.downloadMedia();
    if (!media?.data) throw new Error('Failed to download media');

    return {
      data: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype || 'application/octet-stream',
      filename: media.filename || null,
    };
  } catch (err) {
    throw new Error(`Media stream failed: ${err?.message || err}`);
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
  const safePhone = getCanonicalPhoneCandidate(jid, phone);
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

async function syncContacts(userId, db, options = {}) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;
  if (inst.contactSyncInProgress) return;

  const skipChatSync = options.skipChatSync === true;
  inst.contactSyncInProgress = true;

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

    if (!skipChatSync) {
      await syncChats(userId, db);
    }
  } catch (err) {
    console.error(`Contact sync error [${userId}]:`, err?.message || err);
  } finally {
    inst.contactSyncInProgress = false;
  }
}

async function syncChats(userId, db) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;
  if (inst.historySyncInProgress) return;

  inst.historySyncInProgress = true;

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
    let skippedChats = 0;

    // Sort chats by most recent activity first
    const sortedChats = chats.sort((a, b) => {
      const aTime = a.timestamp || 0;
      const bTime = b.timestamp || 0;
      return bTime - aTime;
    });

    // Process in batches to avoid blocking
    const BATCH_SIZE = 10;
    const MSG_LIMIT_PER_CHAT = 25; // Reduced from 50 for large accounts

    for (let i = 0; i < sortedChats.length; i += BATCH_SIZE) {
      if (inst.connectionStatus !== 'connected') break;

      const batch = sortedChats.slice(i, i + BATCH_SIZE);

      for (const chat of batch) {
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

          // Check if we already have messages for this chat — skip if we do
          const existingCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE contact_id = ? AND user_id = ?').get(contactId, userId)?.c || 0;
          if (existingCount >= MSG_LIMIT_PER_CHAT) {
            skippedChats++;
            continue;
          }

          // Fetch recent messages for this chat
          try {
            const messages = await chat.fetchMessages({ limit: MSG_LIMIT_PER_CHAT });
            for (const msg of messages) {
              try {
                if (!msg.body && !msg.hasMedia) continue;

                const msgId = msg.id?._serialized || msg.id?.id || uuid();

                // Skip if message already exists in DB
                const exists = db.prepare('SELECT id FROM messages WHERE id = ? AND user_id = ?').get(msgId, userId);
                if (exists) continue;

                const { msgType, content, duration, mimetype, mediaName } = getMessagePayload(msg);
                const direction = msg.fromMe ? 'sent' : 'received';

                let mediaPath = null;
                let resolvedMediaName = mediaName;
                let resolvedMediaMime = mimetype;
                if (msg.hasMedia && ['voice', 'image', 'video', 'document', 'sticker'].includes(msgType)) {
                  const savedMedia = await saveMessageMedia(userId, msg, msgId, {
                    msgType,
                    mimetype,
                    mediaName,
                  });
                  mediaPath = savedMedia?.mediaPath || null;
                  resolvedMediaName = savedMedia?.mediaName || mediaName || null;
                  resolvedMediaMime = savedMedia?.mediaMime || mimetype || null;
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
                  mediaName: resolvedMediaName,
                  mediaMime: resolvedMediaMime,
                });
                messageCount++;
              } catch {}
            }
          } catch (err) {
            console.log(`📜 [${userId}] Failed to fetch messages for ${jid}: ${err?.message}`);
          }
        } catch {}
      }

      // Emit progress after each batch
      updateSyncState(userId, db, {
        historyContacts: contactChanges,
        historyMessages: messageCount,
        lastProgressAt: new Date().toISOString(),
      });

      // Small delay between batches to prevent overwhelming
      if (i + BATCH_SIZE < sortedChats.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`📇 [${userId}] Synced ${contactChanges} chats, ${messageCount} messages (${skippedChats} skipped - already synced)`);
    const totalMessages = db.prepare('SELECT COUNT(*) as c FROM messages WHERE user_id = ?').get(userId)?.c || 0;
    const finalPhase = (contactChanges > 0 || inst.syncState.totalDbContacts > 0) && (totalMessages > 0 || skippedChats > 0)
      ? 'ready'
      : 'partial';
    updateSyncState(userId, db, {
      phase: finalPhase,
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
  } finally {
    inst.historySyncInProgress = false;
  }
}

// ── Recovery Sync ──

async function recoverSync(userId, db) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;
  if (inst.historySyncInProgress) {
    console.log(`🔄 [${userId}] Recovery sync skipped — history import already running`);
    return;
  }

  console.log(`🔄 [${userId}] Recovery sync started`);
  updateSyncState(userId, db, { phase: 'recovering' });
  emit(userId, 'sync_state', inst.syncState);

  await syncChats(userId, db);

  if (inst.connectionStatus === 'connected' && !inst.contactSyncInProgress) {
    syncContacts(userId, db, { skipChatSync: true }).catch(err => {
      console.error(`Recovery contact sync error [${userId}]:`, err?.message || err);
    });
  }

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
        const { msgType, content, duration, mimetype, mediaName } = getMessagePayload(msg);
        const msgId = msg.id?._serialized || msg.id?.id || uuid();

        let mediaPath = null;
        let resolvedMediaName = mediaName;
        let resolvedMediaMime = mimetype;
        if (msg.hasMedia && ['voice', 'image', 'video', 'document', 'sticker'].includes(msgType)) {
          const savedMedia = await saveMessageMedia(userId, msg, msgId, {
            msgType,
            mimetype,
            mediaName,
          });
          mediaPath = savedMedia?.mediaPath || null;
          resolvedMediaName = savedMedia?.mediaName || mediaName || null;
          resolvedMediaMime = savedMedia?.mediaMime || mimetype || null;
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
          mediaName: resolvedMediaName,
          mediaMime: resolvedMediaMime,
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

function calculateDelay(replyLength, speed) {
  // Ranges: [min, max] in milliseconds
  // fast = 3-10 mins, normal = 6-15 mins, slow/celebrity = 30 mins - 2 days
  const ranges = {
    fast:   { short: [180000, 420000],   medium: [240000, 540000],   long: [300000, 600000] },
    normal: { short: [360000, 600000],   medium: [480000, 780000],   long: [540000, 900000] },
    slow:   { short: [1800000, 14400000], medium: [3600000, 43200000], long: [7200000, 172800000] },
  };
  const r = ranges[speed] || ranges.normal;
  let range;
  if (replyLength < 50) range = r.short;
  else if (replyLength < 200) range = r.medium;
  else range = r.long;
  return Math.floor(Math.random() * (range[1] - range[0])) + range[0];
}

function normalizeComparableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReplyTooSimilar(replyText, recentOutgoingTexts = []) {
  const normalizedReply = normalizeComparableText(replyText);
  if (!normalizedReply) return false;

  const replyWords = new Set(normalizedReply.split(' ').filter(Boolean));

  return recentOutgoingTexts.some((candidate) => {
    const normalizedCandidate = normalizeComparableText(candidate);
    if (!normalizedCandidate) return false;
    if (normalizedCandidate === normalizedReply) return true;

    const candidateWords = new Set(normalizedCandidate.split(' ').filter(Boolean));
    const overlap = [...replyWords].filter((word) => candidateWords.has(word)).length;
    const similarity = overlap / Math.max(replyWords.size, candidateWords.size, 1);
    return similarity >= 0.72;
  });
}

async function clearTypingState(userId, jid) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return;

  try {
    const chat = await inst.client.getChatById(fromJid(jid));
    await chat.clearState();
  } catch {}
}

function clearPendingAutoReply(userId, jid, { rescue = false } = {}) {
  const inst = getInstance(userId);
  const pending = inst.pendingAutoReplies.get(jid);
  if (!pending) return;

  // Mark as aborted so any in-flight timer callbacks won't send
  pending.aborted = true;
  if (pending.delayTimer) clearTimeout(pending.delayTimer);
  if (pending.typingTimer) clearTimeout(pending.typingTimer);
  inst.pendingAutoReplies.delete(jid);

  // Log cancellation so Admin UI can hide stale countdowns
  if (!rescue) {
    import('./db.js').then(({ db }) => {
      try {
        debugLog(db, userId, 'reply_cancelled', {
          contact: pending.contactName || pending.phone,
          reason: 'new_message_received',
        });
      } catch {}
    }).catch(() => {});
  }
  clearTypingState(userId, jid).catch(() => {});

  // Rescue: push to failed reply queue so it sends after reconnect
  if (rescue && pending.replyText && inst.failedReplyQueue.length < 20) {
    inst.failedReplyQueue.push({
      jid: pending.jid, contactId: pending.contactId,
      contactName: pending.contactName, phone: pending.phone,
      replyText: pending.replyText, latestMessageId: pending.latestMessageId,
      queuedAt: pending.scheduledAt || Date.now(),
    });
    console.log(`🛟 [${userId}] Rescued pending reply for ${pending.contactName || pending.phone} to failed queue`);
  }
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

function debugLog(db, userId, action, details = {}) {
  try {
    db.prepare(`INSERT INTO stats (user_id, event, data) VALUES (?, 'debug_log', ?)`).run(
      userId,
      JSON.stringify({ action, ...details, ts: new Date().toISOString() })
    );
  } catch {}
}

async function handleAutoReply(userId, db, contactId, jid, phone, contactName, originalMsg) {
  const autoConfig = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'automation_enabled'").get(userId);
  if (!autoConfig || autoConfig.value !== 'true') {
    debugLog(db, userId, 'skip_automation_disabled', { contact: contactName || phone });
    return;
  }

  // Skip archived chats
  const contactRow = db.prepare('SELECT is_archived FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (contactRow?.is_archived) {
    debugLog(db, userId, 'skip_archived_chat', { contact: contactName || phone });
    return;
  }

  debugLog(db, userId, 'message_received_for_ai', { contact: contactName || phone, body: (originalMsg?.body || '').slice(0, 80) });

  const inst = getInstance(userId);
  const hadPendingReply = inst.pendingAutoReplies.has(jid);
  clearPendingAutoReply(userId, jid);
  // Reset cooldown so follow-up messages are never ignored
  inst.autoReplyCooldowns.delete(jid);

  const existing = inst.messageBatchBuffers.get(jid);
  const hadPriorBatch = !!existing;
  if (existing) {
    clearTimeout(existing.timer);
    debugLog(db, userId, 'batch_extended', { contact: contactName || phone, batchSize: (existing.messages?.length || 0) + 1 });
  }

  // If we cancelled a pending reply or extended a batch, force the next reply (skip chance roll)
  const forceReply = hadPendingReply || hadPriorBatch;

  const batchEntry = existing || { messages: [], contactId, phone, contactName, latestOriginalMsg: originalMsg, latestMessageId: null, forceReply: false };
  if (forceReply) batchEntry.forceReply = true;
  batchEntry.contactId = contactId;
  batchEntry.phone = phone;
  batchEntry.contactName = contactName;
  batchEntry.latestOriginalMsg = originalMsg;
  batchEntry.latestMessageId = originalMsg?.id?._serialized || originalMsg?.id?.id || null;
  batchEntry.messages.push({
    id: batchEntry.latestMessageId,
    content: originalMsg?.body || originalMsg?.caption || '',
    timestamp: Date.now(),
  });
  if (batchEntry.messages.length > 10) batchEntry.messages = batchEntry.messages.slice(-10);

  batchEntry.timer = setTimeout(() => {
    inst.messageBatchBuffers.delete(jid);
    debugLog(db, userId, 'batch_timer_fired', { contact: batchEntry.contactName || batchEntry.phone, batchSize: batchEntry.messages.length });
    executeAutoReply(userId, db, {
      contactId: batchEntry.contactId,
      jid,
      phone: batchEntry.phone,
      contactName: batchEntry.contactName,
      latestOriginalMsg: batchEntry.latestOriginalMsg,
      latestMessageId: batchEntry.latestMessageId,
      batchedCount: batchEntry.messages.length,
    }).catch(err => {
      console.error('Batched auto-reply error:', err?.message || err);
      debugLog(db, userId, 'batch_auto_reply_error', { contact: batchEntry.contactName || batchEntry.phone, error: err?.message || String(err) });
    });
  }, 12000);

  inst.messageBatchBuffers.set(jid, batchEntry);
}

async function executeAutoReply(userId, db, { contactId, jid, phone, contactName, latestOriginalMsg, latestMessageId }) {
  const inst = getInstance(userId);

  const keyRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'openai_api_key'").get(userId);
  if (!keyRow?.value) {
    debugLog(db, userId, 'skip_no_api_key', { contact: contactName || phone });
    return;
  }

  // Per-contact prompt: check if contact has an assigned persona
  let systemPrompt = '';
  try {
    const contactRow = db.prepare("SELECT prompt_id FROM contacts WHERE id = ? AND user_id = ?").get(contactId, userId);
    if (contactRow?.prompt_id) {
      const promptRow = db.prepare("SELECT content FROM prompts WHERE id = ? AND user_id = ?").get(contactRow.prompt_id, userId);
      systemPrompt = promptRow?.content || '';
    }
  } catch {}
  if (!systemPrompt) {
    const globalRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'ai_system_prompt'").get(userId);
    systemPrompt = globalRow?.value || '';
  }
  const replyChance = parseInt(getConfigValue(db, userId, 'ai_reply_chance', '70'), 10);

  const roll = Math.random() * 100;
  if (roll > replyChance) {
    debugLog(db, userId, 'skip_reply_chance', { contact: contactName || phone, chance: replyChance + '%', rolled: Math.round(roll) });
    const msgText = latestOriginalMsg?.body || latestOriginalMsg?.caption || '';
    const reactionEmoji = await shouldReact(keyRow.value, msgText);
    if (reactionEmoji && latestOriginalMsg) {
      const reactDelay = Math.floor(Math.random() * 5000) + 2000;
      setTimeout(() => sendReaction(userId, jid, latestOriginalMsg, reactionEmoji), reactDelay);
      debugLog(db, userId, 'reaction_sent_instead', { contact: contactName || phone, emoji: reactionEmoji });
    }
    return;
  }

  const messages = db.prepare(`
    SELECT content, direction, type, media_path FROM messages 
    WHERE contact_id = ? AND user_id = ? AND type IN ('text', 'image') AND (content IS NOT NULL OR (type = 'image' AND media_path IS NOT NULL))
    ORDER BY timestamp DESC LIMIT 50
  `).all(contactId, userId).reverse();

  if (messages.length === 0) return;

  // lastMsgContent no longer needed — delay is based on reply length
  const speed = getConfigValue(db, userId, 'ai_response_speed', 'normal');
  const recentOutgoing = messages.filter((message) => message.direction === 'sent').slice(-6).map((message) => message.content);

  const latestMsgText = latestOriginalMsg?.body || latestOriginalMsg?.caption || '';
  const reactionEmoji = await shouldReact(keyRow.value, latestMsgText);
  if (reactionEmoji && latestOriginalMsg) {
    const reactDelay = Math.floor(Math.random() * 3000) + 1000;
    setTimeout(() => sendReaction(userId, jid, latestOriginalMsg, reactionEmoji), reactDelay);
    if (!shouldAlsoReplyAfterReaction()) {
      inst.autoReplyCooldowns.set(jid, Date.now());
      return;
    }
  }

  // Count unreplied messages (received after last sent)
  let unrepliedCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === 'sent') break;
    if (messages[i].direction === 'received') unrepliedCount++;
  }

  debugLog(db, userId, 'generating_ai_reply', { contact: contactName || phone, historyLength: messages.length, unrepliedCount });
  let replyText = await generateReply(keyRow.value, messages, systemPrompt, contactName || phone, { unrepliedCount });
  replyText = replyText.replace(/—/g, ', ').replace(/–/g, ', ').replace(/\s{2,}/g, ' ').trim();

  if (isReplyTooSimilar(replyText, recentOutgoing)) {
    debugLog(db, userId, 'reply_too_similar_regenerating', { contact: contactName || phone, originalReply: replyText.slice(0, 60) });
    replyText = await generateReply(
      keyRow.value,
      messages,
      `${systemPrompt}\n\nIMPORTANT: Do not repeat or closely paraphrase any recent outgoing reply. Make the next reply clearly different in wording and energy.`,
      contactName || phone,
    );
    replyText = replyText.replace(/—/g, ', ').replace(/–/g, ', ').replace(/\s{2,}/g, ' ').trim();
  }

  if (!replyText || isReplyTooSimilar(replyText, recentOutgoing)) {
    debugLog(db, userId, 'skip_still_too_similar', { contact: contactName || phone });
    inst.autoReplyCooldowns.set(jid, Date.now());
    return;
  }

  // Use REPLY length for delay (not incoming message length)
  const delay = calculateDelay(replyText.length, speed);
  // Typing duration scales with reply length: ~1s per 10 chars, min 2s, max 12s
  const typingDuration = Math.min(Math.max(Math.floor(replyText.length / 10) * 1000, 2000), 12000) + Math.floor(Math.random() * 2000);

  debugLog(db, userId, 'reply_scheduled', {
    contact: contactName || phone,
    replyPreview: replyText,
    replyLength: replyText.length,
    delayMs: delay,
    delaySec: Math.round(delay / 1000),
    typingMs: typingDuration,
    speed,
  });

  clearPendingAutoReply(userId, jid);

  const pendingReply = {
    delayTimer: null,
    typingTimer: null,
    latestMessageId,
    // Store metadata so we can rescue this reply if connection drops
    jid, contactId, contactName, phone, replyText,
    scheduledAt: Date.now(),
  };

  pendingReply.delayTimer = setTimeout(async () => {
    if (pendingReply.aborted) return;
    try {
      // Send typing indicator
      const chatId = fromJid(jid);
      debugLog(db, userId, 'typing_started', { contact: contactName || phone });
      try {
        const chat = await inst.client.getChatById(chatId);
        await chat.sendStateTyping();
      } catch {}

      pendingReply.typingTimer = setTimeout(async () => {
        if (pendingReply.aborted) return;
        try {
          const sent = await sendTextMessage(userId, jid, replyText, { quotedMessageId: latestMessageId });
          const replyId = sent?.id?._serialized || uuid();

          // Clear typing
          await clearTypingState(userId, jid);

          let replyToId = null, replyToContent = null, replyToSender = null;
          if (latestMessageId) {
            const quotedRow = db.prepare('SELECT content, direction, contact_id FROM messages WHERE id = ? AND user_id = ?').get(latestMessageId, userId);
            if (quotedRow) {
              replyToId = latestMessageId;
              replyToContent = (quotedRow.content || '').slice(0, 200);
              replyToSender = quotedRow.direction === 'sent' ? 'You' : null;
              if (!replyToSender) {
                const quotedContact = db.prepare('SELECT name, phone FROM contacts WHERE id = ? AND user_id = ?').get(quotedRow.contact_id, userId);
                replyToSender = quotedContact?.name || quotedContact?.phone || null;
              }
            }
          }

          db.prepare(`
            INSERT OR IGNORE INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, reply_to_id, reply_to_content, reply_to_sender)
            VALUES (?, ?, ?, ?, ?, 'text', 'sent', datetime('now'), 'sent', ?, ?, ?)
          `).run(replyId, userId, contactId, jid, replyText, replyToId, replyToContent, replyToSender);
          db.prepare(`INSERT INTO stats (user_id, event, data) VALUES (?, 'auto_reply_sent', ?)`).run(userId, JSON.stringify({ contactId }));
          debugLog(db, userId, 'auto_reply_sent', { contact: contactName || phone, replyPreview: replyText.slice(0, 80), replyLength: replyText.length, quoted: !!latestMessageId });
          inst.autoReplyCooldowns.set(jid, Date.now());
          inst.pendingAutoReplies.delete(jid);
          emit(userId, 'message', { contactId, msgId: replyId });
        } catch (err) {
          console.error('Failed to send auto-reply:', err?.message || err);
          debugLog(db, userId, 'auto_reply_failed', { contact: contactName || phone, error: err?.message || String(err), replyPreview: replyText.slice(0, 80) });
          inst.pendingAutoReplies.delete(jid);
          await clearTypingState(userId, jid);
          // Queue for retry when connection restores
          if (inst.failedReplyQueue.length < 20) {
            inst.failedReplyQueue.push({ jid, contactId, contactName, phone, replyText, latestMessageId, queuedAt: Date.now() });
            debugLog(db, userId, 'reply_queued_for_retry', { contact: contactName || phone, queueSize: inst.failedReplyQueue.length });
          }
        }
      }, typingDuration);
    } catch (err) {
      console.error('Typing indicator error:', err?.message || err);
      inst.pendingAutoReplies.delete(jid);
    }
  }, Math.max(delay - typingDuration, 1000));

  inst.pendingAutoReplies.set(jid, pendingReply);
}

// ── Drain failed reply queue on reconnect ──

async function drainFailedReplyQueue(userId, db) {
  const inst = getInstance(userId);
  const queue = inst.failedReplyQueue.splice(0);
  if (queue.length === 0) return;

  debugLog(db, userId, 'draining_failed_replies', { count: queue.length });
  console.log(`📤 [${userId}] Draining ${queue.length} failed auto-replies`);

  for (const item of queue) {
    // Skip if queued more than 30 minutes ago
    if (Date.now() - item.queuedAt > 30 * 60 * 1000) {
      debugLog(db, userId, 'reply_expired', { contact: item.contactName || item.phone, age: Math.round((Date.now() - item.queuedAt) / 1000) + 's' });
      continue;
    }
    try {
      // Small stagger between queued sends
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      if (inst.connectionStatus !== 'connected') {
        // Re-queue remaining
        inst.failedReplyQueue.push(...queue.slice(queue.indexOf(item)));
        debugLog(db, userId, 'drain_aborted_disconnected', { remaining: queue.length - queue.indexOf(item) });
        break;
      }
      const sent = await sendTextMessage(userId, item.jid, item.replyText, { quotedMessageId: item.latestMessageId });
      const replyId = sent?.id?._serialized || require('crypto').randomUUID();
      db.prepare(`
        INSERT OR IGNORE INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status)
        VALUES (?, ?, ?, ?, ?, 'text', 'sent', datetime('now'), 'sent')
      `).run(replyId, userId, item.contactId, item.jid, item.replyText);
      debugLog(db, userId, 'queued_reply_sent', { contact: item.contactName || item.phone, replyPreview: item.replyText.slice(0, 80) });
      emit(userId, 'message', { contactId: item.contactId, msgId: replyId });
    } catch (err) {
      debugLog(db, userId, 'queued_reply_failed', { contact: item.contactName || item.phone, error: err?.message || String(err) });
      console.error(`❌ [${userId}] Queued reply send failed:`, err?.message);
    }
  }
}

// ── Send messages ──


async function sendTextMessage(userId, jid, text, options = {}) {
  const { quotedMessageId } = options || {};

  return sendToResolvedTarget(userId, jid, async ({ client, target, chat }) => {
    if (quotedMessageId && typeof client.getMessageById === 'function') {
      try {
        const quotedMessage = await client.getMessageById(quotedMessageId);
        if (quotedMessage) {
          return await quotedMessage.reply(text);
        }
      } catch {}
    }

    if (chat) return await chat.sendMessage(text);
    return await client.sendMessage(target, text);
  });
}

async function sendMediaMessage(userId, jid, payload) {
  const { mimeType, data, fileName, caption, sendAsDocument = false, isViewOnce = false } = payload || {};
  if (!data) throw new Error('Missing media data');

  return sendToResolvedTarget(userId, jid, async ({ client, target, chat }) => {
    const media = new MessageMedia(mimeType || 'application/octet-stream', data, fileName || 'attachment');
    const options = {};
    if (caption) options.caption = caption;
    if (sendAsDocument) options.sendMediaAsDocument = true;
    if (isViewOnce) options.isViewOnce = true;

    if (chat) return await chat.sendMessage(media, options);
    return await client.sendMessage(target, media, options);
  });
}

async function sendVoiceNote(userId, jid, audioBuffer) {
  try {
    const result = await sendToResolvedTarget(userId, jid, async ({ client, target, chat }) => {
      const media = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'), 'voice.ogg');
      if (chat) return await chat.sendMessage(media, { sendAudioAsVoice: true });
      return await client.sendMessage(target, media, { sendAudioAsVoice: true });
    });
    console.log(`🎤 [${userId}] Voice note sent to ${jid}`);
    return result;
  } catch (pttErr) {
    console.warn(`⚠️ [${userId}] PTT send failed, retrying as audio: ${pttErr?.message}`);
    try {
      const result = await sendToResolvedTarget(userId, jid, async ({ client, target, chat }) => {
        const media = new MessageMedia('audio/ogg; codecs=opus', audioBuffer.toString('base64'), 'voice.ogg');
        if (chat) return await chat.sendMessage(media);
        return await client.sendMessage(target, media);
      });
      console.log(`🎤 [${userId}] Voice note sent as audio to ${jid}`);
      return result;
    } catch (audioErr) {
      console.error(`❌ [${userId}] Both PTT and audio send failed: ${audioErr?.message}`);
      throw new Error(`Voice note delivery failed: ${audioErr?.message || 'unknown error'}`);
    }
  }
}

// ── Soft disconnect (preserve session) ──

async function softDisconnect(userId) {
  const inst = getInstance(userId);
  inst.connectionGeneration++;
  stopHeartbeat(userId);
  clearConnectionWatchdog(userId);
  clearRecoverySyncTimer(userId);
  inst.connectionStatus = 'disconnected';
  inst.qrCode = null;
  inst.pairingCode = null;
  inst.pendingPairingPhone = null;
  inst.reconnectAttempt = 0;
  inst.connectionPhase = 'idle';
  inst.connectionStartedAtMs = 0;
  inst.lastConnectionActivityAtMs = 0;
  inst.lastDisconnectReason = 'manual';
  inst.historySyncInProgress = false;
  inst.contactSyncInProgress = false;
  inst.autoReplyCooldowns.clear();
  inst.messageBatchBuffers.forEach(entry => clearTimeout(entry.timer));
  inst.messageBatchBuffers.clear();
  inst.pendingAutoReplies.forEach((_, pendingJid) => clearPendingAutoReply(userId, pendingJid, { rescue: true }));
  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
  if (inst.syncGraceTimer) { clearTimeout(inst.syncGraceTimer); inst.syncGraceTimer = null; }
  if (inst.archiveSyncTimer) { clearInterval(inst.archiveSyncTimer); inst.archiveSyncTimer = null; }

  if (inst.client) {
    const clientRef = inst.client;
    inst.client = null;
    // Kill browser first, then destroy — prevents zombie Chromium
    try {
      const browser = clientRef.pupBrowser;
      if (browser) await browser.close().catch(() => {});
    } catch {}
    try { await clientRef.destroy(); } catch {}
  }
  inst.isConnecting = false;

  emit(userId, 'status', { status: 'disconnected' });
  console.log(`🔌 [${userId}] Soft disconnect — session preserved.`);
}

// ── Clear session ──

async function clearSession(userId, db) {
  const inst = getInstance(userId);
  inst.connectionGeneration++;
  stopHeartbeat(userId);
   clearConnectionWatchdog(userId);
   clearRecoverySyncTimer(userId);
  inst.connectionStatus = 'disconnected';
  inst.qrCode = null;
  inst.pairingCode = null;
  inst.pendingPairingPhone = null;
  inst.reconnectAttempt = 0;
  inst.connectionPhase = 'idle';
  inst.connectionStartedAtMs = 0;
  inst.lastConnectionActivityAtMs = 0;
  inst.lastDisconnectReason = null;
  inst.historySyncInProgress = false;
  inst.contactSyncInProgress = false;
  inst.autoReplyCooldowns.clear();
  inst.messageBatchBuffers.forEach(entry => clearTimeout(entry.timer));
  inst.messageBatchBuffers.clear();
  inst.pendingAutoReplies.forEach((_, pendingJid) => clearPendingAutoReply(userId, pendingJid)); // no rescue on full logout
  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
  if (inst.syncGraceTimer) { clearTimeout(inst.syncGraceTimer); inst.syncGraceTimer = null; }
  if (inst.archiveSyncTimer) { clearInterval(inst.archiveSyncTimer); inst.archiveSyncTimer = null; }

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
    const clientRef = inst.client;
    inst.client = null;
    try { await clientRef.logout(); } catch {}
    try {
      const browser = clientRef.pupBrowser;
      if (browser) await browser.close().catch(() => {});
    } catch {}
    try { await clientRef.destroy(); } catch {}
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

  // Also clean wwebjs cache to prevent corruption
  const cacheDir = path.join(DATA_DIR, 'wwebjs_cache');
  try {
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {}

  inst.isConnecting = false;
  emit(userId, 'status', { status: 'disconnected' });
  emit(userId, 'sync_state', inst.syncState);
  console.log(`🗑️ [${userId}] Session fully cleared.`);
}

export async function shutdownAllWhatsAppClients() {
  const instances = Array.from(userInstances.entries());

  for (const [userId, inst] of instances) {
    stopHeartbeat(userId);
    clearConnectionWatchdog(userId);
    clearRecoverySyncTimer(userId);
    if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
    if (inst.syncGraceTimer) { clearTimeout(inst.syncGraceTimer); inst.syncGraceTimer = null; }
    if (inst.archiveSyncTimer) { clearInterval(inst.archiveSyncTimer); inst.archiveSyncTimer = null; }
    inst.isConnecting = false;

    if (inst.client) {
      const clientRef = inst.client;
      inst.client = null;
      try { await clientRef.destroy(); } catch {}
    }
  }
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
  const expiredIds = purgeExpiredStatuses(db, userId);
  for (const statusId of expiredIds) {
    emit(userId, 'status_deleted', { statusId, reason: 'expired' });
  }

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
  return { success: true };
}

export async function deleteMessageForMe(userId, db, messageId) {
  const msg = db.prepare('SELECT id FROM messages WHERE id = ? AND user_id = ?').get(messageId, userId);
  if (!msg) throw new Error('Message not found');
  db.prepare('DELETE FROM messages WHERE id = ? AND user_id = ?').run(messageId, userId);
  return { success: true, mode: 'me' };
}

export async function deleteMessageForEveryone(userId, db, messageId) {
  const inst = getInstance(userId);
  const msg = db.prepare('SELECT id, contact_id, jid, direction FROM messages WHERE id = ? AND user_id = ?').get(messageId, userId);
  if (!msg) throw new Error('Message not found');

  if (inst.client && inst.connectionStatus === 'connected') {
    try {
      let waMsg = null;
      if (typeof inst.client.getMessageById === 'function') {
        try {
          waMsg = await inst.client.getMessageById(messageId);
        } catch {}
      }

      if (!waMsg) {
        const chatId = fromJid(msg.jid);
        const chat = await inst.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 200 });
        waMsg = messages.find(m => (m.id?._serialized === messageId || m.id?.id === messageId));
      }

      if (waMsg) {
        await waMsg.delete(true); // delete for everyone
      }
      console.log(`🗑️ [${userId}] Deleted message ${messageId} for everyone`);
    } catch (err) {
      console.log(`🗑️ [${userId}] WhatsApp delete-for-everyone failed: ${err?.message}`);
    }
  }

  // Mark as deleted instead of removing — show "This message was deleted" placeholder
  db.prepare("UPDATE messages SET is_deleted = 1, content = '🚫 You deleted this message', media_path = NULL WHERE id = ? AND user_id = ?").run(messageId, userId);
  return { success: true, mode: 'everyone' };
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

// ── Sync archive states from WhatsApp ──

export async function syncArchiveStates(userId, db) {
  const inst = getInstance(userId);
  if (!inst.client || inst.connectionStatus !== 'connected') return { synced: 0 };

  try {
    const chats = await inst.client.getChats();
    let synced = 0;
    for (const chat of chats) {
      const jid = toJid(chat.id._serialized);
      const contact = db.prepare('SELECT id, is_archived FROM contacts WHERE jid = ? AND user_id = ?').get(jid, userId);
      if (!contact) continue;

      const waArchived = chat.archived ? 1 : 0;
      const dbArchived = contact.is_archived || 0;
      if (waArchived !== dbArchived) {
        db.prepare('UPDATE contacts SET is_archived = ? WHERE id = ? AND user_id = ?').run(waArchived, contact.id, userId);
        synced++;
      }
    }
    if (synced > 0) {
      console.log(`📦 [${userId}] Synced ${synced} archive state changes from WhatsApp`);
      emit(userId, 'contacts_updated', { reason: 'archive_sync' });
    }
    return { synced };
  } catch (err) {
    console.error(`📦 [${userId}] Archive sync failed:`, err?.message);
    return { synced: 0 };
  }
}

// ── Mark chat as read ──
// NOTE: We intentionally do NOT call chat.sendSeen() so that
// the other person never gets blue ticks (read receipts) from us.
// We only update the local unread counter.

export async function markChatRead(userId, db, contactId) {
  const contact = db.prepare('SELECT jid FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!contact) throw new Error('Contact not found');

  // Do NOT send read receipts to WhatsApp — stealth mode
  // const inst = getInstance(userId);
  // if (inst.client && inst.connectionStatus === 'connected') {
  //   try {
  //     const chatId = fromJid(contact.jid);
  //     const chat = await inst.client.getChatById(chatId);
  //     await chat.sendSeen();
  //   } catch (err) {
  //     console.log(`📖 [${userId}] WhatsApp mark-read failed: ${err?.message}`);
  //   }
  // }

  db.prepare("UPDATE contacts SET unread_count = 0 WHERE id = ? AND user_id = ?").run(contactId, userId);
  return { success: true };
}
