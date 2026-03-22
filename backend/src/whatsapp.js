import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
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
      connectionGeneration: 0,
      badMacTimestamps: [],
      repairInProgress: false,
      msgRetryCounterCache: new NodeCache({ stdTTL: 600, checkperiod: 120 }),
      autoReplyCooldowns: new Map(),
      messageBatchBuffers: new Map(),
      lidMap: new Map(),
      // Sync state tracking
      syncState: {
        phase: 'idle',         // idle | waiting_history | importing | partial | ready
        connectedAt: null,
        lastHistorySyncAt: null,
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

// Build LID-to-phone mappings from a contact object
function buildLidMapping(inst, contact) {
  if (!contact) return;
  const id = contact.id;
  if (!id) return;

  // Case 1: Contact has id=xxx@s.whatsapp.net and lid=yyy@lid
  if (id.endsWith('@s.whatsapp.net') && contact.lid) {
    const lidJid = typeof contact.lid === 'string' ? contact.lid : contact.lid?.toString?.();
    if (lidJid) {
      const phone = id.replace('@s.whatsapp.net', '');
      inst.lidMap.set(lidJid, phone);
      if (!lidJid.endsWith('@lid')) inst.lidMap.set(lidJid + '@lid', phone);
    }
  }

  // Case 2: Contact has id=xxx@lid and lid property pointing to @s.whatsapp.net
  if (id.endsWith('@lid') && contact.lid && contact.lid !== id) {
    const otherJid = typeof contact.lid === 'string' ? contact.lid : null;
    if (otherJid?.endsWith('@s.whatsapp.net')) {
      const phone = otherJid.replace('@s.whatsapp.net', '');
      inst.lidMap.set(id, phone);
    }
  }

  // Case 3: Contact with @lid id has a phoneNumber field (Baileys v6.7+)
  if (id.endsWith('@lid') && contact.phoneNumber) {
    const phone = contact.phoneNumber.replace(/[^0-9]/g, '');
    if (phone.length >= 7 && phone.length <= 15) {
      inst.lidMap.set(id, phone);
    }
  }

  // Case 4: Contact with @lid id has a phone field
  if (id.endsWith('@lid') && contact.phone) {
    const phone = (typeof contact.phone === 'string' ? contact.phone : '').replace(/[^0-9]/g, '');
    if (phone.length >= 7 && phone.length <= 15) {
      inst.lidMap.set(id, phone);
    }
  }
}

// Extract LID mappings from message alt fields (Baileys 6.8+)
function extractAltMappings(inst, msg) {
  if (!msg?.key) return;
  const { remoteJid, remoteJidAlt, participant, participantAlt } = msg.key;

  // senderPn is the most reliable source (contains real phone @s.whatsapp.net)
  if (msg.key.senderPn && remoteJid?.endsWith('@lid')) {
    const phone = msg.key.senderPn.replace('@s.whatsapp.net', '').replace(/@.*$/, '');
    if (phone && /^\d{7,15}$/.test(phone)) {
      inst.lidMap.set(remoteJid, phone);
    }
  }

  if (remoteJid?.endsWith('@lid') && remoteJidAlt?.endsWith('@s.whatsapp.net')) {
    const phone = remoteJidAlt.replace('@s.whatsapp.net', '');
    inst.lidMap.set(remoteJid, phone);
  }
  if (participant?.endsWith('@lid') && participantAlt?.endsWith('@s.whatsapp.net')) {
    const phone = participantAlt.replace('@s.whatsapp.net', '');
    inst.lidMap.set(participant, phone);
  }
}

// Reconcile @lid and @s.whatsapp.net duplicate contacts in DB
function reconcileLidContacts(db, userId, lidJid, phone) {
  try {
    const lidPhone = '+' + lidJid.replace('@lid', '');
    const realPhone = '+' + phone;
    const realJid = phone + '@s.whatsapp.net';

    // Find the @lid-based contact (by JID, by fake phone from raw LID, or by name pattern)
    const lidContact = db.prepare(
      "SELECT id, name, phone FROM contacts WHERE user_id = ? AND (jid = ? OR phone = ? OR jid LIKE ?)"
    ).get(userId, lidJid, lidPhone, lidJid.replace('@lid', '') + '%');

    if (!lidContact) return;

    // Find or create the real phone contact
    const realContact = db.prepare(
      "SELECT id, name FROM contacts WHERE user_id = ? AND jid = ?"
    ).get(userId, realJid);

    if (realContact && realContact.id !== lidContact.id) {
      // Move messages from lid contact to real contact
      db.prepare(
        "UPDATE messages SET contact_id = ?, jid = ? WHERE contact_id = ? AND user_id = ?"
      ).run(realContact.id, realJid, lidContact.id, userId);

      // Update name if lid contact had a better one
      if (lidContact.name && !isPhoneLikeName(lidContact.name, realPhone) &&
          (!realContact.name || isPhoneLikeName(realContact.name, realPhone))) {
        db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run(lidContact.name, realContact.id);
      }

      // Delete the lid contact
      db.prepare("DELETE FROM contacts WHERE id = ? AND user_id = ?").run(lidContact.id, userId);
    } else if (!realContact) {
      // No real contact exists — update the lid contact to use real JID/phone
      db.prepare(
        "UPDATE contacts SET jid = ?, phone = ? WHERE id = ? AND user_id = ?"
      ).run(realJid, realPhone, lidContact.id, userId);

      // Also update messages
      db.prepare(
        "UPDATE messages SET jid = ? WHERE contact_id = ? AND user_id = ?"
      ).run(realJid, lidContact.id, userId);
    }
  } catch (err) {
    console.error('reconcileLidContacts error:', err?.message || err);
  }
}

// Deferred LID sweep: re-check unresolved contacts after a delay
const pendingSweeps = new Map();
function schedulelidSweep(userId, db, inst) {
  if (pendingSweeps.has(userId)) clearTimeout(pendingSweeps.get(userId));
  pendingSweeps.set(userId, setTimeout(() => {
    pendingSweeps.delete(userId);
    runLidSweep(userId, db, inst);
  }, 10000)); // 10 seconds after last history sync event
}

function runLidSweep(userId, db, inst) {
  try {
    // Find all contacts still using @lid JIDs
    const lidContacts = db.prepare(
      "SELECT id, jid, name, phone FROM contacts WHERE user_id = ? AND jid LIKE '%@lid'"
    ).all(userId);

    if (!lidContacts.length) return;
    console.log(`🔍 [${userId}] LID sweep: checking ${lidContacts.length} unresolved contacts`);

    let resolved = 0;
    for (const contact of lidContacts) {
      const mapped = inst.lidMap.get(contact.jid);
      if (mapped) {
        reconcileLidContacts(db, userId, contact.jid, mapped);
        resolved++;
      }
    }

    if (resolved > 0) {
      console.log(`🔗 [${userId}] LID sweep resolved ${resolved} contacts`);
      emit(userId, 'contacts_sync', { count: resolved });
    } else {
      console.log(`📇 [${userId}] LID sweep: no new resolutions (${inst.lidMap.size} mappings available)`);
    }
  } catch (err) {
    console.error(`LID sweep error [${userId}]:`, err?.message || err);
  }
}

// Resolve a JID to a real phone number
// Returns { phone, jid } where phone is the clean number and jid is the best JID to use
function resolveLidPhone(inst, jid) {
  if (!jid) return { phone: '', jid: jid };

  // Normal @s.whatsapp.net — phone is directly in the JID
  if (jid.endsWith('@s.whatsapp.net')) {
    return { phone: jid.replace('@s.whatsapp.net', ''), jid };
  }

  // Group JIDs — not a phone number
  if (jid.endsWith('@g.us')) {
    return { phone: jid.replace('@g.us', ''), jid };
  }

  // @lid JID — need to resolve
  if (jid.endsWith('@lid')) {
    // Layer 1: Check cached lidMap
    const mapped = inst.lidMap.get(jid);
    if (mapped) {
      return { phone: mapped, jid: mapped + '@s.whatsapp.net' };
    }

    // Layer 1.5: Try Baileys' internal signal repository mapping
    try {
      const pnJid = inst.sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (pnJid && pnJid.endsWith('@s.whatsapp.net')) {
        const phone = pnJid.replace('@s.whatsapp.net', '');
        inst.lidMap.set(jid, phone);
        return { phone, jid: pnJid };
      }
    } catch {}

    // Layer 2: Scan store contacts for any contact whose .lid matches this JID
    if (inst.store?.contacts) {
      for (const [cid, contact] of Object.entries(inst.store.contacts)) {
        if (!cid.endsWith('@s.whatsapp.net')) continue;
        const contactLid = contact.lid;
        if (contactLid === jid || contactLid === jid.replace('@lid', '')) {
          const phone = cid.replace('@s.whatsapp.net', '');
          inst.lidMap.set(jid, phone);
          return { phone, jid: cid };
        }
      }
    }

    // Layer 2.5: Check if any store contact with @lid id has phoneNumber
    const lidContact = inst.store?.contacts?.[jid];
    if (lidContact?.phoneNumber) {
      const phone = lidContact.phoneNumber.replace(/[^0-9]/g, '');
      if (phone.length >= 7 && phone.length <= 15) {
        inst.lidMap.set(jid, phone);
        return { phone, jid: phone + '@s.whatsapp.net' };
      }
    }

    // Layer 3: Fallback — use raw LID number (will show as unknown number)
    const rawLid = jid.replace('@lid', '');
    return { phone: rawLid, jid };
  }

  // Unknown format fallback
  return { phone: jid.replace(/@.*$/, ''), jid };
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

function updateSyncState(userId, db, updates) {
  const inst = getInstance(userId);
  Object.assign(inst.syncState, updates);
  // Compute live DB counts
  try {
    inst.syncState.totalDbContacts = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE user_id = ? AND is_group = 0').get(userId)?.c || 0;
    inst.syncState.totalDbMessages = db.prepare('SELECT COUNT(*) as c FROM messages WHERE user_id = ?').get(userId)?.c || 0;
    inst.syncState.unresolvedLids = db.prepare("SELECT COUNT(*) as c FROM contacts WHERE user_id = ? AND jid LIKE '%@lid'").get(userId)?.c || 0;
  } catch {}
  emit(userId, 'sync_state', inst.syncState);
}

function scheduleSyncGrace(userId, db) {
  const inst = getInstance(userId);
  if (inst.syncGraceTimer) clearTimeout(inst.syncGraceTimer);
  inst.syncGraceTimer = setTimeout(() => {
    inst.syncGraceTimer = null;
    // If still waiting for history and nothing arrived, mark partial
    if (inst.syncState.phase === 'waiting_history') {
      updateSyncState(userId, db, { phase: 'partial' });
    }
    // If importing finished but counts are very low, mark partial
    if (inst.syncState.phase === 'importing') {
      const phase = inst.syncState.historyMessages > 0 ? 'ready' : 'partial';
      updateSyncState(userId, db, { phase });
    }
  }, 30000); // 30s grace period
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
      await startConnection(userId, db, { force: true });
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
    reconnect: () => startConnection(userId, db, { force: true }),
    clearSession: () => clearSession(userId, db),
    getSocket: () => getInstance(userId).sock,
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
    triggerSync: () => syncContacts(userId, db),
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
    reconnect: () => startConnection(userId, db, { force: true }),
    clearSession: () => clearSession(userId, db),
    getSocket: () => inst.sock,
    requestPairingCode: (phone) => requestPairingWithPhone(userId, phone),
    triggerSync: () => syncContacts(userId, db),
  };
}

async function startConnection(userId, db, options = {}) {
  const inst = getInstance(userId);
  const force = options.force === true;

  if (inst.isConnecting) return;
  if (!force && inst.sock && inst.connectionStatus === 'connected') return;
  inst.isConnecting = true;

  if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }

  const generation = inst.connectionGeneration + 1;
  inst.connectionGeneration = generation;

  if (inst.sock) {
    try { inst.sock.ev.removeAllListeners('connection.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.upsert'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('call'); } catch {}
    try { inst.sock.ev.removeAllListeners('contacts.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('contacts.upsert'); } catch {}
    try { inst.sock.ev.removeAllListeners('messaging-history.set'); } catch {}
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

    // Local contact cache (replaces removed makeInMemoryStore)
    if (!inst.store) {
      inst.store = { contacts: {} };
    }

    // Populate contact cache from socket events and build LID mappings
    inst.sock.ev.on('contacts.update', (updates) => {
      for (const u of updates) {
        if (u.id) {
          inst.store.contacts[u.id] = { ...inst.store.contacts[u.id], ...u };
          buildLidMapping(inst, inst.store.contacts[u.id]);
        }
      }
    });

    // DEBUG: Log first few raw contacts from events to diagnose LID issue
    let contactDebugCount = 0;

    inst.sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) {
        if (c.id) {
          inst.store.contacts[c.id] = { ...inst.store.contacts[c.id], ...c };
          buildLidMapping(inst, inst.store.contacts[c.id]);
          if (contactDebugCount < 15) {
            console.log(`🔍 [DEBUG] contacts.upsert raw:`, JSON.stringify({
              id: c.id,
              name: c.name,
              notify: c.notify,
              verifiedName: c.verifiedName,
              pushName: c.pushName,
              lid: c.lid,
              lidJid: c.lidJid,
              phoneNumber: c.phoneNumber,
              phone: c.phone,
              imgUrl: c.imgUrl ? '(has img)' : undefined,
              allKeys: Object.keys(c),
            }));
            contactDebugCount++;
          }
        }
      }
    });

    inst.sock.ev.on('creds.update', saveCreds);

    // Listen for LID mapping updates from Baileys
    try {
      inst.sock.ev.on('lid-mapping.update', (mappings) => {
        if (!mappings || typeof mappings !== 'object') return;
        for (const [lid, pn] of Object.entries(mappings)) {
          const phone = typeof pn === 'string' ? pn.replace('@s.whatsapp.net', '') : '';
          if (phone) {
            inst.lidMap.set(lid, phone);
            reconcileLidContacts(db, userId, lid, phone);
          }
        }
        console.log(`🔗 [${userId}] LID mapping update: ${Object.keys(mappings).length} mappings`);
        emit(userId, 'contacts_sync', { count: Object.keys(mappings).length });
      });
    } catch {}

    inst.sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (generation !== inst.connectionGeneration) return;

      if (qr) {
        inst.qrCode = qr;
        inst.connectionStatus = 'qr_waiting';
        emit(userId, 'qr', qr);
      }

      if (connection === 'open') {
        if (inst.connectionStatus === 'connected') return;
        if (inst.reconnectTimer) { clearTimeout(inst.reconnectTimer); inst.reconnectTimer = null; }
        inst.qrCode = null;
        inst.pairingCode = null;
        inst.pendingPairingPhone = null;
        inst.connectionStatus = 'connected';
        inst.reconnectAttempt = 0;
        inst.badMacTimestamps = [];
        inst.repairInProgress = false;
        emit(userId, 'connected', null);
        console.log(`✅ [${userId}] WhatsApp connected (gen ${generation})`);
        updateSyncState(userId, db, { phase: 'waiting_history', connectedAt: new Date().toISOString() });
        scheduleSyncGrace(userId, db);
        syncContacts(userId, db);
      }

      if (connection === 'close') {
        const statusCode = extractDisconnectStatusCode(lastDisconnect?.error);
        const disconnectMessage = lastDisconnect?.error?.message || lastDisconnect?.error?.toString?.() || 'unknown';
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession;

        console.warn(`⚠️ [${userId}] WhatsApp closed (gen ${generation}, code ${statusCode ?? 'unknown'}): ${disconnectMessage}`);

        if (isLoggedOut) {
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
      }
    });

    inst.sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      for (const msg of msgs) {
        try {
          if (!msg.message) continue;
          const jid = msg.key.remoteJid;
          if (!jid) continue;

          // Capture status updates (stories)
          if (jid === 'status@broadcast') {
            captureStatusUpdate(userId, db, inst, msg).catch(err => {
              console.error('Status capture error:', err?.message || err);
            });
            continue;
          }

          // Extract LID→PN mappings from alt fields
          extractAltMappings(inst, msg);

          // DEBUG: Log raw message key fields for first few @lid messages
          if (jid.endsWith('@lid')) {
            console.log(`🔍 [DEBUG] msg.upsert @lid key:`, JSON.stringify({
              remoteJid: msg.key.remoteJid,
              senderPn: msg.key.senderPn,
              remoteJidAlt: msg.key.remoteJidAlt,
              participant: msg.key.participant,
              participantAlt: msg.key.participantAlt,
              fromMe: msg.key.fromMe,
              pushName: msg.pushName,
              allKeyFields: Object.keys(msg.key),
            }));
          }

          const isFromMe = msg.key.fromMe;
          const resolved = resolveLidPhone(inst, jid);
          const phone = '+' + resolved.phone;
          const resolvedJid = resolved.jid;

          // If we just resolved a LID, reconcile existing DB entries BEFORE creating new ones
          if (jid.endsWith('@lid') && resolvedJid !== jid) {
            reconcileLidContacts(db, userId, jid, resolved.phone);
          }
          // Also check if there's an existing contact with the resolved JID to prevent duplicates
          if (jid.endsWith('@lid') && resolvedJid === jid && msg.key.senderPn) {
            // senderPn gave us the real phone but resolveLidPhone may have already used it
            const senderPhone = msg.key.senderPn.replace('@s.whatsapp.net', '').replace(/@.*$/, '');
            if (senderPhone && /^\d{7,15}$/.test(senderPhone)) {
              reconcileLidContacts(db, userId, jid, senderPhone);
              // Re-resolve after reconciliation
              const reResolved = resolveLidPhone(inst, jid);
              if (reResolved.jid !== jid) {
                Object.assign(resolved, reResolved);
              }
            }
          }

          const isGroup = jid.endsWith('@g.us');
          const contactCandidate = getNameCandidate(
            inst.store?.contacts?.[jid],
            inst.store?.contacts?.[resolvedJid],
            msg,
            { pushName: msg.pushName || null }
          );

          const contactId = getOrCreateContact(db, userId, resolvedJid, phone, contactCandidate, isGroup);
          if (!contactId) continue; // Skip unresolved @lid contacts

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
            msgId, userId, contactId, resolvedJid, content, msgType, direction,
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

      // Update sync state
      updateSyncState(userId, db, {
        phase: 'importing',
        lastHistorySyncAt: new Date().toISOString(),
        historyChats: (inst.syncState.historyChats || 0) + (chats?.length || 0),
        historyContacts: (inst.syncState.historyContacts || 0) + (syncedContacts?.length || 0),
        historyMessages: (inst.syncState.historyMessages || 0) + (historyMsgs?.length || 0),
      });
      // Reset grace timer since we got data
      scheduleSyncGrace(userId, db);

      let contactChanges = 0;
      let historyDebugCount = 0;

      // First pass: build LID mappings from synced contacts
      if (syncedContacts?.length) {
        for (const c of syncedContacts) {
          buildLidMapping(inst, c);
          if (historyDebugCount < 15) {
            console.log(`🔍 [DEBUG] history contact raw:`, JSON.stringify({
              id: c.id,
              name: c.name,
              notify: c.notify,
              verifiedName: c.verifiedName,
              pushName: c.pushName,
              lid: c.lid,
              lidJid: c.lidJid,
              phoneNumber: c.phoneNumber,
              phone: c.phone,
              allKeys: Object.keys(c),
            }));
            historyDebugCount++;
          }
        }
      }

      if (syncedContacts?.length) {
        for (const c of syncedContacts) {
          try {
            const jid = c.id;
            if (!jid || jid === 'status@broadcast') continue;
            const resolved = resolveLidPhone(inst, jid);
            const phone = '+' + resolved.phone;
            const isGroup = jid.endsWith('@g.us');
            getOrCreateContact(db, userId, resolved.jid, phone, getNameCandidate(c), isGroup);
            contactChanges++;
          } catch {}
        }
      }

      if (chats?.length) {
        for (const chat of chats) {
          try {
            const jid = chat.id;
            if (!jid || jid === 'status@broadcast') continue;
            buildLidMapping(inst, chat);
            const resolved = resolveLidPhone(inst, jid);
            const phone = '+' + resolved.phone;
            const isGroup = jid.endsWith('@g.us');
            getOrCreateContact(db, userId, resolved.jid, phone, getNameCandidate(chat), isGroup);
            contactChanges++;
          } catch {}
        }
      }

      if (historyMsgs?.length) {
        let msgDebugCount = 0;
        for (const msg of historyMsgs) {
          try {
            if (!msg?.message) continue;
            const jid = msg.key?.remoteJid;
            if (!jid || jid === 'status@broadcast') continue;

            if (msgDebugCount < 20) {
              console.log(`🔍 [DEBUG] history msg with @lid:`, JSON.stringify({
                remoteJid: msg.key.remoteJid,
                senderPn: msg.key.senderPn,
                remoteJidAlt: msg.key.remoteJidAlt,
                participant: msg.key.participant,
                participantAlt: msg.key.participantAlt,
                pushName: msg.pushName,
                allKeyFields: Object.keys(msg.key),
              }));
              msgDebugCount++;
            }

            // Extract alt mappings from history messages too
            extractAltMappings(inst, msg);

            const isFromMe = msg.key.fromMe;
            const resolved = resolveLidPhone(inst, jid);
            const phone = '+' + resolved.phone;
            const resolvedJid = resolved.jid;
            const isGroup = jid.endsWith('@g.us');
            const contactCandidate = getNameCandidate(
              inst.store?.contacts?.[jid],
              inst.store?.contacts?.[resolvedJid],
              msg,
              { pushName: msg.pushName || null }
            );

            const contactId = getOrCreateContact(db, userId, resolvedJid, phone, contactCandidate, isGroup);
            if (!contactId) continue; // Skip unresolved @lid contacts

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
              msgId, userId, contactId, resolvedJid, content, msgType,
              isFromMe ? 'sent' : 'received',
              toIsoTimestamp(msg.messageTimestamp),
              isFromMe ? 'sent' : 'delivered',
              msg.message.audioMessage?.seconds || null
            );
          } catch {}
        }
      }

      // Second pass: reconcile any LIDs that got resolved during message processing
      if (inst.lidMap.size > 0) {
        let reconciled = 0;
        for (const [lidJid, phone] of inst.lidMap.entries()) {
          try {
            reconcileLidContacts(db, userId, lidJid, phone);
            reconciled++;
          } catch {}
        }
        if (reconciled > 0) {
          console.log(`🔗 [${userId}] Post-history reconciled ${reconciled} LID contacts`);
        }
      }

      if (contactChanges > 0) {
        emit(userId, 'contacts_sync', { count: contactChanges });
      }
      emit(userId, 'history_sync', { chats: chats?.length || 0, messages: historyMsgs?.length || 0 });

      // Update sync state after processing
      const phase = (inst.syncState.historyMessages > 10 && inst.syncState.historyContacts > 0) ? 'ready' : 'partial';
      updateSyncState(userId, db, { phase });

      // Schedule a deferred LID sweep to catch any late-arriving mappings
      schedulelidSweep(userId, db, inst);
    });

    inst.sock.ev.on('contacts.update', (updates) => {
      let changed = 0;
      for (const update of updates) {
        try {
          const jid = update.id;
          if (!jid || jid === 'status@broadcast') continue;
          buildLidMapping(inst, update);
          const resolved = resolveLidPhone(inst, jid);
          const phone = '+' + resolved.phone;
          const isGroup = jid.endsWith('@g.us');
          const candidate = getNameCandidate(inst.store?.contacts?.[jid], inst.store?.contacts?.[resolved.jid], update);
          getOrCreateContact(db, userId, resolved.jid, phone, candidate, isGroup);
          changed++;
        } catch {}
      }
      if (changed > 0) emit(userId, 'contacts_sync', { count: changed });
    });

    // Handle status deletions / revocations
    inst.sock.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        try {
          const jid = update.key?.remoteJid;
          if (jid !== 'status@broadcast') continue;
          
          // Check if status was deleted/revoked
          const msgUpdate = update.update;
          if (msgUpdate?.messageStubType === 1 || msgUpdate?.message === null || msgUpdate?.status === 5) {
            const statusId = update.key?.id;
            if (!statusId) continue;
            
            const row = db.prepare("SELECT media_path FROM statuses WHERE id = ? AND user_id = ?").get(statusId, userId);
            if (row?.media_path) {
              const filePath = path.join(STATUS_MEDIA_DIR, row.media_path);
              try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
            }
            db.prepare("DELETE FROM statuses WHERE id = ? AND user_id = ?").run(statusId, userId);
            emit(userId, 'status_update', { deleted: true, statusId });
            console.log(`🗑️ [${userId}] Status deleted: ${statusId}`);
          }
        } catch (err) {
          console.error('messages.update (status) error:', err?.message || err);
        }
      }
    });

    // ── Call events (missed calls) ──────────────────────────
    inst.sock.ev.on('call', (calls) => {
      for (const call of calls) {
        try {
          // Only capture incoming calls (offer status)
          if (call.status !== 'offer' && call.status !== 'timeout' && call.status !== 'reject') continue;
          if (call.isGroup && call.status !== 'offer') continue;

          const callerJid = call.from;
          if (!callerJid || callerJid === 'status@broadcast') continue;

          const resolved = resolveLidPhone(inst, callerJid);
          const phone = '+' + resolved.phone;
          const callerName = inst.store?.contacts?.[callerJid]?.name
            || inst.store?.contacts?.[resolved.jid]?.name
            || inst.store?.contacts?.[callerJid]?.notify
            || null;

          const callId = call.id || uuid();
          const isVideo = !!call.isVideo;
          const isGroup = !!call.isGroup;
          const callStatus = call.status === 'offer' ? 'missed' : call.status;

          db.prepare(`
            INSERT OR REPLACE INTO call_logs (id, user_id, caller_jid, caller_phone, caller_name, is_video, is_group, status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(callId, userId, resolved.jid, phone, callerName, isVideo ? 1 : 0, isGroup ? 1 : 0, callStatus, new Date().toISOString());

          emit(userId, 'call', { callId, callerJid: resolved.jid, callerName, callerPhone: phone, isVideo, status: callStatus });
          console.log(`📞 [${userId}] ${callStatus} ${isVideo ? 'video' : 'voice'} call from ${callerName || phone}`);
        } catch (err) {
          console.error('Call event error:', err?.message || err);
        }
      }
    });

    inst.sock.ev.on('contacts.upsert', (contacts) => {
      let changed = 0;
      for (const c of contacts) {
        try {
          const jid = c.id;
          if (!jid || jid === 'status@broadcast') continue;
          buildLidMapping(inst, c);
          const resolved = resolveLidPhone(inst, jid);
          const phone = '+' + resolved.phone;
          const isGroup = jid.endsWith('@g.us');
          getOrCreateContact(db, userId, resolved.jid, phone, getNameCandidate(inst.store?.contacts?.[jid], inst.store?.contacts?.[resolved.jid], c), isGroup);
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

function formatUnresolvedContactName(jid, candidateName) {
  if (candidateName) return candidateName;
  const suffix = jid.replace('@lid', '').slice(-4);
  return suffix ? `WhatsApp contact • ${suffix}` : 'WhatsApp contact';
}

function mergeContactRecords(db, userId, sourceContactId, targetContactId, targetJid) {
  if (!sourceContactId || !targetContactId || sourceContactId === targetContactId) return;

  db.prepare(
    'UPDATE messages SET contact_id = ?, jid = ? WHERE contact_id = ? AND user_id = ?'
  ).run(targetContactId, targetJid, sourceContactId, userId);

  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(sourceContactId, userId);
}

function getOrCreateContact(db, userId, jid, phone, candidate, isGroup = false) {
  const isUnresolvedLid = jid.endsWith('@lid');
  const safePhone = !isUnresolvedLid && phone && phone !== '+' ? phone : null;
  const existing = db.prepare('SELECT id, jid, name, phone FROM contacts WHERE jid = ? AND user_id = ?').get(jid, userId);
  const phoneMatch = !isUnresolvedLid && safePhone
    ? db.prepare(`
        SELECT id, jid, name, phone
        FROM contacts
        WHERE user_id = ? AND phone = ? AND is_group = ?
        ORDER BY CASE
          WHEN jid = ? THEN 0
          WHEN jid LIKE '%@lid' THEN 1
          ELSE 2
        END,
        updated_at DESC
        LIMIT 1
      `).get(userId, safePhone, isGroup ? 1 : 0, jid)
    : null;
  const resolvedName = isUnresolvedLid
    ? formatUnresolvedContactName(jid, candidate?.name || null)
    : (candidate?.name || phone);

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
    const shouldUpdateName = shouldReplaceName(candidate, target.name, comparisonPhone) || (isUnresolvedLid && !target.name);
    const nextName = shouldUpdateName ? resolvedName : target.name;
    const nextJid = isUnresolvedLid ? target.jid : jid;

    db.prepare("UPDATE contacts SET jid = ?, name = ?, phone = COALESCE(?, phone), is_group = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nextJid, nextName, safePhone, isGroup ? 1 : 0, target.id);

    if (!isUnresolvedLid && target.jid !== nextJid) {
      db.prepare('UPDATE messages SET jid = ? WHERE contact_id = ? AND user_id = ?')
        .run(nextJid, target.id, userId);
    }

    return target.id;
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO contacts (id, user_id, jid, name, phone, is_group) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, jid, resolvedName, safePhone, isGroup ? 1 : 0);
  return id;
}

function syncContacts(userId, db) {
  const inst = getInstance(userId);
  if (!inst.store?.contacts) return;
  console.log(`📇 [${userId}] Contact sync initiated`);

  try {
    const contacts = Object.values(inst.store.contacts);
    console.log(`📇 [${userId}] Found ${contacts.length} contacts in store`);
    updateSyncState(userId, db, { storeContacts: contacts.length });

    // First pass: build all LID mappings
    for (const c of contacts) {
      buildLidMapping(inst, c);
    }
    console.log(`📇 [${userId}] Built ${inst.lidMap.size} LID mappings`);

    let syncedCount = 0;
    for (const c of contacts) {
      try {
        const jid = c.id;
        if (!jid || jid === 'status@broadcast') continue;
        const resolved = resolveLidPhone(inst, jid);
        const phone = '+' + resolved.phone;
        const isGroup = jid.endsWith('@g.us');
        getOrCreateContact(db, userId, resolved.jid, phone, getNameCandidate(c, inst.store?.contacts?.[resolved.jid]), isGroup);
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
  const timezone = getConfigValue(db, userId, 'ai_timezone', 'America/New_York');
  
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

  let replyText = await generateReply(keyRow.value, messages, systemPrompt, contactName || phone);
  // Strip em dashes and en dashes from AI output
  replyText = replyText.replace(/[—–-]{2,}/g, ' ').replace(/—/g, ' ').replace(/–/g, ' ');
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
  if (inst.syncGraceTimer) { clearTimeout(inst.syncGraceTimer); inst.syncGraceTimer = null; }

  // Reset sync state
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

  if (inst.sock) {
    try { inst.sock.ev.removeAllListeners('connection.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.upsert'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('contacts.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('connection.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.upsert'); } catch {}
    try { inst.sock.ev.removeAllListeners('messages.update'); } catch {}
    try { inst.sock.ev.removeAllListeners('call'); } catch {}
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
    db.prepare('DELETE FROM call_logs WHERE user_id = ?').run(userId);
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
  emit(userId, 'sync_state', inst.syncState);
  console.log(`🗑️ [${userId}] Session fully cleared.`);
}

// ── Status (Stories) capture ──────────────────────────────
const STATUS_MEDIA_DIR = path.join(DATA_DIR, 'status-media');

async function captureStatusUpdate(userId, db, inst, msg) {
  const senderJid = msg.key.participant || msg.key.remoteJid;
  if (!senderJid || senderJid === 'status@broadcast') return;

  const resolved = resolveLidPhone(inst, senderJid);
  const phone = '+' + resolved.phone;
  const senderName = msg.pushName || inst.store?.contacts?.[senderJid]?.name || inst.store?.contacts?.[resolved.jid]?.name || null;

  // Unwrap viewOnceMessage / ephemeralMessage / documentWithCaptionMessage wrappers
  let innerMsg = msg.message;
  if (innerMsg?.viewOnceMessage?.message) innerMsg = innerMsg.viewOnceMessage.message;
  if (innerMsg?.viewOnceMessageV2?.message) innerMsg = innerMsg.viewOnceMessageV2.message;
  if (innerMsg?.ephemeralMessage?.message) innerMsg = innerMsg.ephemeralMessage.message;
  if (innerMsg?.documentWithCaptionMessage?.message) innerMsg = innerMsg.documentWithCaptionMessage.message;

  const isImage = !!innerMsg?.imageMessage;
  const isVideo = !!innerMsg?.videoMessage;
  const isText = !isImage && !isVideo;

  let mediaType = 'text';
  let content = '';
  let mediaPath = null;

  if (isImage) {
    mediaType = 'image';
    content = innerMsg.imageMessage?.caption || '';
  } else if (isVideo) {
    mediaType = 'video';
    content = innerMsg.videoMessage?.caption || '';
  } else {
    content = innerMsg?.conversation
      || innerMsg?.extendedTextMessage?.text
      || innerMsg?.editedMessage?.message?.protocolMessage?.editedMessage?.conversation
      || innerMsg?.editedMessage?.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text
      || '';
  }

  console.log(`📸 [${userId}] Status from ${senderName || phone}: type=${mediaType}, content="${(content || '').slice(0, 50)}", msgKeys=${Object.keys(innerMsg || {}).join(',')}`);


  // Download media if applicable
  if (!isText && inst.sock) {
    try {
      if (!fs.existsSync(STATUS_MEDIA_DIR)) fs.mkdirSync(STATUS_MEDIA_DIR, { recursive: true });
      const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: inst.sock.updateMediaMessage });
      const ext = isImage ? 'jpg' : 'mp4';
      const filename = `${uuid()}.${ext}`;
      const filePath = path.join(STATUS_MEDIA_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      mediaPath = filename;
    } catch (err) {
      console.error('Status media download failed:', err?.message || err);
    }
  }

  const ts = toIsoTimestamp(msg.messageTimestamp);
  const expiresAt = new Date(new Date(ts).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const statusId = msg.key.id || uuid();

  db.prepare(`
    INSERT OR IGNORE INTO statuses (id, user_id, sender_jid, sender_phone, sender_name, content, media_type, media_path, timestamp, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(statusId, userId, resolved.jid, phone, senderName, content, mediaType, mediaPath, ts, expiresAt);

  emit(userId, 'status_update', { senderJid: resolved.jid, senderName, mediaType });
}

export function getStatuses(db, userId) {
  // Cleanup expired
  db.prepare("DELETE FROM statuses WHERE user_id = ? AND expires_at < datetime('now')").run(userId);

  const rows = db.prepare(`
    SELECT * FROM statuses WHERE user_id = ? ORDER BY timestamp ASC
  `).all(userId);

  // Group by sender
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
    // Update name if newer status has a name
    if (row.sender_name) grouped[key].senderName = row.sender_name;
    grouped[key].statuses.push({
      id: row.id,
      content: row.content,
      mediaType: row.media_type,
      mediaPath: row.media_path,
      timestamp: row.timestamp,
    });
}

export function getCallLogs(db, userId) {
  return db.prepare(`
    SELECT * FROM call_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 200
  `).all(userId);
}

  return Object.values(grouped);
}
