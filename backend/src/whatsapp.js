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
import { generateReply, shouldReact, shouldAlsoReplyAfterReaction } from './ai.js';

const msgRetryCounterCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
const autoReplyCooldowns = new Map(); // jid -> last reply timestamp
const messageBatchBuffers = new Map(); // jid -> { messages: [], timer, contactId, phone, contactName }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '..', 'data', 'auth');
const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let pairingCode = null;
let pendingPairingPhone = null;
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
      syncFullHistory: true,
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
        badMacTimestamps = [];
        repairInProgress = false;
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

    // Listen for incoming messages (both real-time 'notify' and history 'append')
    sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
      for (const msg of msgs) {
        try {
          if (!msg.message) continue;
          const jid = msg.key.remoteJid;
          if (!jid || jid === 'status@broadcast') continue;

          const isFromMe = msg.key.fromMe;
          const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
          const phone = '+' + rawNumber;
          const pushName = msg.pushName || null;
          const isGroup = jid.endsWith('@g.us');

          const contactId = getOrCreateContact(db, jid, phone, pushName, isGroup);

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
            INSERT OR IGNORE INTO messages (id, contact_id, jid, content, type, direction, timestamp, status, duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            msgId, contactId, jid, content, msgType, direction,
            toIsoTimestamp(msg.messageTimestamp),
            isFromMe ? 'sent' : 'delivered',
            msg.message.audioMessage?.seconds || null
          );

          // Only track stats for real-time notifications
          if (type === 'notify' && !isFromMe) {
            db.prepare(`INSERT INTO stats (event, data) VALUES ('message_received', ?)`).run(JSON.stringify({ contactId }));
            emit('message', { contactId, msgId });

            // AI Auto-Reply (only for non-group, real-time messages)
            if (!isGroup) {
              handleAutoReply(db, contactId, jid, phone, pushName, msg.key).catch(err => {
                console.error('Auto-reply error:', err?.message || err);
              });
            }
          }
        } catch (err) {
          if (isSignalSessionError(err)) {
            console.warn('⚠️ Suppressed message decrypt error in upsert handler:', err?.message || err);
            triggerSignalSessionRepair(db, err);
            continue;
          }
          console.error('messages.upsert handler error:', err?.message || err);
        }
      }
    });

    // Handle history sync (existing chats loaded on connect)
    sock.ev.on('messaging-history.set', ({ chats, contacts: syncedContacts, messages: historyMsgs }) => {
      console.log(`📜 History sync: ${chats?.length || 0} chats, ${syncedContacts?.length || 0} contacts, ${historyMsgs?.length || 0} messages`);

      // Import contacts from history
      if (syncedContacts?.length) {
        for (const c of syncedContacts) {
          try {
            const jid = c.id;
            if (!jid || jid === 'status@broadcast') continue;
            const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const phone = '+' + rawNumber;
            const isGroup = jid.endsWith('@g.us');
            getOrCreateContact(db, jid, phone, c.notify || c.name || null, isGroup);
          } catch {}
        }
      }

      // Import chats as contacts (in case contacts list is sparse)
      if (chats?.length) {
        for (const chat of chats) {
          try {
            const jid = chat.id;
            if (!jid || jid === 'status@broadcast') continue;
            const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const phone = '+' + rawNumber;
            const isGroup = jid.endsWith('@g.us');
            getOrCreateContact(db, jid, phone, chat.name || null, isGroup);
          } catch {}
        }
      }

      // Import history messages
      if (historyMsgs?.length) {
        for (const { message: msg } of historyMsgs) {
          try {
            if (!msg?.message) continue;
            const jid = msg.key?.remoteJid;
            if (!jid || jid === 'status@broadcast') continue;

            const isFromMe = msg.key.fromMe;
            const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const phone = '+' + rawNumber;
            const isGroup = jid.endsWith('@g.us');

            const contactId = getOrCreateContact(db, jid, phone, msg.pushName || null, isGroup);

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
              INSERT OR IGNORE INTO messages (id, contact_id, jid, content, type, direction, timestamp, status, duration)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              msgId, contactId, jid, content, msgType,
              isFromMe ? 'sent' : 'received',
              toIsoTimestamp(msg.messageTimestamp),
              isFromMe ? 'sent' : 'delivered',
              msg.message.audioMessage?.seconds || null
            );
          } catch {}
        }
      }

      emit('history_sync', { chats: chats?.length || 0, messages: historyMsgs?.length || 0 });
    });

    // Sync contacts when they update (push names)
    sock.ev.on('contacts.update', (updates) => {
      for (const update of updates) {
        if (update.id && update.notify) {
          const rawNumber = update.id.replace('@s.whatsapp.net', '').replace('@g.us', '');
          const phone = '+' + rawNumber;
          const existing = db.prepare('SELECT id FROM contacts WHERE jid = ?').get(update.id);
          if (existing) {
            db.prepare("UPDATE contacts SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?")
              .run(update.notify, phone, existing.id);
          }
        }
      }
    });

    // Also handle contacts.upsert for initial contact sync
    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) {
        try {
          const jid = c.id;
          if (!jid || jid === 'status@broadcast') continue;
          const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
          const phone = '+' + rawNumber;
          const isGroup = jid.endsWith('@g.us');
          getOrCreateContact(db, jid, phone, c.notify || c.name || null, isGroup);
        } catch {}
      }
    });
  } catch (err) {
    if (isSignalSessionError(err)) {
      console.warn('⚠️ startConnection hit Signal session error:', err?.message || err);
      triggerSignalSessionRepair(db, err);
      return;
    }
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

function getOrCreateContact(db, jid, phone, pushName, isGroup = false) {
  const existing = db.prepare('SELECT id, name FROM contacts WHERE jid = ?').get(jid);
  if (existing) {
    // Update push name and phone if we have better data
    if (pushName && (!existing.name || existing.name === phone)) {
      db.prepare("UPDATE contacts SET name = ?, phone = ?, is_group = ?, updated_at = datetime('now') WHERE id = ?")
        .run(pushName, phone, isGroup ? 1 : 0, existing.id);
    } else if (existing.name !== phone) {
      db.prepare("UPDATE contacts SET phone = ?, is_group = ?, updated_at = datetime('now') WHERE id = ?")
        .run(phone, isGroup ? 1 : 0, existing.id);
    }
    return existing.id;
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO contacts (id, jid, name, phone, is_group) VALUES (?, ?, ?, ?, ?)
  `).run(id, jid, pushName || phone, phone, isGroup ? 1 : 0);
  return id;
}

async function syncContacts(db) {
  try {
    console.log('📇 Contact sync initiated — waiting for history events from Baileys');
    // Actual sync happens via messaging-history.set, contacts.upsert, and contacts.update events
  } catch (err) {
    console.error('Contact sync error:', err.message);
  }
}

// ─── Human-like timing helpers ───

function getConfigValue(db, key, fallback) {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row?.value ?? fallback;
}

function isWithinActiveHours(db) {
  const start = getConfigValue(db, 'ai_active_hours_start', '10:00');
  const end = getConfigValue(db, 'ai_active_hours_end', '23:00');
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  
  if (startMin <= endMin) {
    return currentMinutes >= startMin && currentMinutes <= endMin;
  }
  // Overnight range (e.g. 22:00 - 06:00)
  return currentMinutes >= startMin || currentMinutes <= endMin;
}

function calculateDelay(messageLength, speed) {
  // Returns delay in milliseconds
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

async function sendReaction(jid, messageKey, emoji) {
  if (!sock || connectionStatus !== 'connected') return;
  try {
    await sock.sendMessage(jid, {
      react: { text: emoji, key: messageKey }
    });
    console.log(`😎 Reacted with ${emoji} to message in ${jid}`);
  } catch (err) {
    console.error('Failed to send reaction:', err?.message);
  }
}

async function handleAutoReply(db, contactId, jid, phone, contactName, messageKey) {
  // Check if automation is enabled
  const autoConfig = db.prepare("SELECT value FROM config WHERE key = 'automation_enabled'").get();
  if (!autoConfig || autoConfig.value !== 'true') return;

  // Active hours check
  if (!isWithinActiveHours(db)) {
    console.log(`🌙 Auto-reply skipped: outside active hours for ${jid}`);
    return;
  }

  // Reply chance check (default 70%)
  const replyChance = parseInt(getConfigValue(db, 'ai_reply_chance', '70'), 10);
  if (Math.random() * 100 > replyChance) {
    console.log(`🎲 Auto-reply skipped: rolled outside ${replyChance}% reply chance for ${jid}`);
    // Even when skipping the reply, maybe still react
    const reactionEmoji = shouldReact();
    if (reactionEmoji && messageKey) {
      const reactDelay = Math.floor(Math.random() * 5000) + 2000;
      setTimeout(() => sendReaction(jid, messageKey, reactionEmoji), reactDelay);
    }
    return;
  }

  // Message batching: wait for rapid follow-up messages before replying
  const existing = messageBatchBuffers.get(jid);
  if (existing) {
    clearTimeout(existing.timer);
  }
  
  const batchEntry = existing || { messages: [], contactId, phone, contactName, messageKey };
  batchEntry.messageKey = messageKey; // always use the latest message key for reactions
  
  batchEntry.timer = setTimeout(() => {
    messageBatchBuffers.delete(jid);
    executeAutoReply(db, contactId, jid, phone, contactName, messageKey).catch(err => {
      console.error('Batched auto-reply error:', err?.message || err);
    });
  }, 8000); // Wait 8 seconds for follow-up messages
  
  messageBatchBuffers.set(jid, batchEntry);
}

async function executeAutoReply(db, contactId, jid, phone, contactName, messageKey) {
  // Cooldown check (30 seconds per contact — longer to feel natural)
  const now = Date.now();
  const lastReply = autoReplyCooldowns.get(jid) || 0;
  if (now - lastReply < 30000) {
    console.log(`⏳ Auto-reply cooldown active for ${jid}`);
    return;
  }

  // Get OpenAI key
  const keyRow = db.prepare("SELECT value FROM config WHERE key = 'openai_api_key'").get();
  if (!keyRow?.value) {
    console.log('⚠️ Auto-reply skipped: no OpenAI API key configured');
    return;
  }

  // Get system prompt
  const promptRow = db.prepare("SELECT value FROM config WHERE key = 'ai_system_prompt'").get();
  const systemPrompt = promptRow?.value || '';

  // Load last 50 messages for context
  const messages = db.prepare(`
    SELECT content, direction, type FROM messages 
    WHERE contact_id = ? AND type = 'text' AND content IS NOT NULL AND content != ''
    ORDER BY timestamp DESC LIMIT 50
  `).all(contactId).reverse();

  if (messages.length === 0) return;

  const lastMsgContent = messages[messages.length - 1]?.content || '';
  const speed = getConfigValue(db, 'ai_response_speed', 'normal');

  // Maybe react with an emoji first
  const reactionEmoji = shouldReact();
  if (reactionEmoji && messageKey) {
    const reactDelay = Math.floor(Math.random() * 3000) + 1000;
    setTimeout(() => sendReaction(jid, messageKey, reactionEmoji), reactDelay);
    
    // Sometimes just react, no text reply
    if (!shouldAlsoReplyAfterReaction()) {
      console.log(`😎 Only reacted (no text reply) for ${contactName || phone}`);
      autoReplyCooldowns.set(jid, Date.now());
      return;
    }
  }

  console.log(`🤖 Generating auto-reply for ${contactName || phone} (${messages.length} messages context)`);

  const replyText = await generateReply(keyRow.value, messages, systemPrompt, contactName || phone);

  // Calculate human-like delay
  const delay = calculateDelay(lastMsgContent.length, speed);
  console.log(`⏱️ Waiting ${Math.round(delay / 1000)}s before replying to ${contactName || phone}`);

  // Send typing indicator, then reply after delay
  setTimeout(async () => {
    try {
      // Show "typing..." indicator 2-4 seconds before sending
      if (sock && connectionStatus === 'connected') {
        await sock.sendPresenceUpdate('composing', jid);
      }

      const typingDuration = Math.floor(Math.random() * 2000) + 2000; // 2-4 seconds of typing
      
      setTimeout(async () => {
        try {
          // Send the reply
          const sent = await sendTextMessage(jid, replyText);
          const replyId = sent?.key?.id || uuid();

          // Stop typing indicator
          if (sock && connectionStatus === 'connected') {
            await sock.sendPresenceUpdate('paused', jid);
          }

          // Save to DB
          db.prepare(`
            INSERT OR IGNORE INTO messages (id, contact_id, jid, content, type, direction, timestamp, status)
            VALUES (?, ?, ?, ?, 'text', 'sent', datetime('now'), 'sent')
          `).run(replyId, contactId, jid, replyText);

          db.prepare(`INSERT INTO stats (event, data) VALUES ('auto_reply_sent', ?)`).run(JSON.stringify({ contactId }));

          // Set cooldown
          autoReplyCooldowns.set(jid, Date.now());

          console.log(`✅ Auto-reply sent to ${contactName || phone}: "${replyText.substring(0, 50)}..."`);
        } catch (err) {
          console.error('Failed to send auto-reply:', err?.message || err);
        }
      }, typingDuration);
    } catch (err) {
      console.error('Typing indicator error:', err?.message || err);
    }
  }, delay - 3000); // Start the sequence (delay minus typing time)
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
  reconnectAttempt = 0;
  badMacTimestamps = [];
  repairInProgress = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  // Close socket without triggering reconnect
  if (sock) {
    try { sock.ev.removeAllListeners('connection.update'); } catch {}
    try { sock.ev.removeAllListeners('messages.upsert'); } catch {}
    try { sock.ev.removeAllListeners('contacts.update'); } catch {}
    try { sock.ev.removeAllListeners('contacts.upsert'); } catch {}
    try { sock.ev.removeAllListeners('messaging-history.set'); } catch {}
    try { sock.ev.removeAllListeners('creds.update'); } catch {}
    try { await sock.logout(); } catch {}
    try { sock.end?.(undefined); } catch {}
    sock = null;
  }

  // Delete entire auth directory (session files, creds, keys)
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
  // Recreate empty auth dir for next scan
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  isConnecting = false;
  emit('status', { status: 'disconnected' });
  console.log('🗑️ Session fully cleared. Scan QR to reconnect.');
}
