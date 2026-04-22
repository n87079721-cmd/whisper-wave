import express from 'express';
import { sendTestMessage } from './telegram.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { getWhatsAppState, onWhatsAppEvent, getOrInitWhatsApp, requestPairingWithPhone, getStatuses, getCallLogs, recoverSingleChat, getSyncDiagnostics, deleteMessage, deleteMessageForMe, deleteMessageForEveryone, deleteConversation, streamMediaForMessage, cancelAllPendingReplies, cancelPendingReplyForContact, triggerConversationSummary } from './whatsapp.js';
import { initWhatsApp } from './whatsapp.js';
import { archiveChat, markChatRead, syncArchiveStates, enhanceTextForVoice } from './whatsapp.js';
import { generateVoiceNote, generatePreviewAudio, BG_SOUND_PROMPTS } from './elevenlabs.js';
import multer from 'multer';
import { execSync } from 'child_process';
import { authMiddleware, registerUser, loginUser, createToken } from './auth.js';
import { startTelegramPolling, stopTelegramPolling, isTelegramConfigured } from './telegram.js';
import { getTelegramCallbackHandlers, startConversationStarterLoop, stopConversationStarterLoop } from './whatsapp.js';
import QRCode from 'qrcode';

// Ensure Telegram polling is running for a user whenever their config supports it.
// Safe to call repeatedly — startTelegramPolling no-ops if already polling.
function ensureTelegramPolling(db, userId) {
  try {
    if (isTelegramConfigured(db, userId)) {
      const handlers = getTelegramCallbackHandlers(userId, db);
      startTelegramPolling(db, userId, handlers);
    }
  } catch (err) {
    console.error(`[${userId}] ensureTelegramPolling error:`, err?.message);
  }
}

function ensureUserBackgroundServices(db, userId) {
  try {
    const startersEnabled = getConfig(db, userId, 'conversation_starters') === 'true';
    if (startersEnabled) startConversationStarterLoop(userId, db);
    else stopConversationStarterLoop(userId);
    ensureTelegramPolling(db, userId);
  } catch (err) {
    console.error(`[${userId}] ensureUserBackgroundServices error:`, err?.message);
  }
}

// ── Voice-note daily limit helpers ─────────────────────────
// Stored as config key 'voice_daily_limit' per user:
//   missing / '' / '-1'  → unlimited
//   '0'                  → voice notes disabled for this user
//   '1'..'N'             → that many VN sends allowed per UTC day
// Counts every voice send (manual, recording, voice-studio, AI auto-VN).
function getVoiceDailyLimit(db, userId) {
  const raw = getConfig(db, userId, 'voice_daily_limit');
  if (raw == null || raw === '' || raw === '-1') return null; // unlimited
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function getVoiceSentTodayCount(db, userId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM stats WHERE user_id = ? AND event = 'voice_sent' AND date(created_at) = date('now')`
  ).get(userId);
  return row?.c || 0;
}

// Returns { allowed: boolean, reason?: string, limit?: number, sentToday?: number }
function checkVoiceLimit(db, userId) {
  const limit = getVoiceDailyLimit(db, userId);
  if (limit === null) return { allowed: true };
  if (limit === 0) return { allowed: false, reason: 'voice_notes_disabled', limit, sentToday: 0 };
  const sentToday = getVoiceSentTodayCount(db, userId);
  if (sentToday >= limit) return { allowed: false, reason: 'daily_limit_reached', limit, sentToday };
  return { allowed: true, limit, sentToday };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApiRouter(db) {
  const router = express.Router();
  const auth = authMiddleware(db);

  // ── Public: Auth endpoints ───────────────────────────────
  router.post('/auth/register', (req, res) => {
    try {
      const { username, password, displayName } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const user = registerUser(db, username, password, displayName);
      const token = createToken(user.id);
      ensureUserBackgroundServices(db, user.id);
      res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName, isAdmin: !!user.isAdmin } });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/auth/login', (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      const user = loginUser(db, username, password);
      const token = createToken(user.id);
      ensureUserBackgroundServices(db, user.id);
      // Don't auto-start WhatsApp on login — user clicks Connect on dashboard
      res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName, isAdmin: !!user.isAdmin } });
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  });

  router.get('/auth/me', auth, (req, res) => {
    // Silently refresh the token on every check-in so active sessions never expire
    const refreshedToken = createToken(req.userId);
    ensureUserBackgroundServices(db, req.userId);
    res.json({
      token: refreshedToken,
      user: {
        id: req.user.id,
        username: req.user.username,
        display_name: req.user.display_name,
        displayName: req.user.display_name,
        isAdmin: !!req.user.isAdmin,
      },
    });
  });

  // ── All routes below require auth ────────────────────────
  router.use(auth);

  // Helper to get user's WA instance
  function getWA(req) {
    return getOrInitWhatsApp(req.userId, db);
  }

  function normalizePhoneDigits(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function getCanonicalPhoneJid(phone) {
    const raw = String(phone || '').trim();
    if (!raw) return null;

    const digits = normalizePhoneDigits(raw);
    if (digits.length < 7 || digits.length > 15) return null;
    return `${digits}@s.whatsapp.net`;
  }

  function getCanonicalTargetJid(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (!raw.includes('@')) return getCanonicalPhoneJid(raw);

    if (raw.endsWith('@s.whatsapp.net')) {
      const digits = normalizePhoneDigits(raw);
      if (digits.length < 7 || digits.length > 15) return null;
      return `${digits}@s.whatsapp.net`;
    }

    return raw;
  }

  function detectMimeTypeFromFilename(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.ogg': 'audio/ogg',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  function getMediaExtension(mimeType, filename) {
    const extFromName = path.extname(filename || '').replace(/^\./, '').toLowerCase();
    if (extFromName) return extFromName;

    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('jpeg')) return 'jpg';
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    if (normalized.includes('mp4')) return 'mp4';
    if (normalized.includes('quicktime')) return 'mov';
    if (normalized.includes('ogg')) return 'ogg';
    if (normalized.includes('mpeg')) return 'mp3';
    if (normalized.includes('wav')) return 'wav';
    if (normalized.includes('pdf')) return 'pdf';
    if (normalized.includes('word')) return 'docx';
    if (normalized.includes('excel') || normalized.includes('spreadsheet')) return 'xlsx';
    if (normalized.includes('powerpoint') || normalized.includes('presentation')) return 'pptx';
    if (normalized.includes('zip')) return 'zip';
    if (normalized.includes('plain')) return 'txt';
    return 'bin';
  }

  function resolveMessageMediaPath(filename) {
    const safeName = path.basename(String(filename || ''));
    const candidates = [
      path.join(__dirname, '..', 'data', 'message-media', safeName),
      path.join(__dirname, '..', 'data', 'voice-media', safeName),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  function sanitizeDownloadName(value, fallback = 'attachment') {
    const cleaned = String(value || fallback)
      .replace(/[\r\n"]/g, '')
      .replace(/[\\/]/g, '_')
      .trim();
    return cleaned || fallback;
  }

  // Save outgoing voice notes to disk for reliable playback
  function persistOutgoingVoiceNote(messageId, audioBuffer) {
    try {
      const mediaDir = path.join(__dirname, '..', 'data', 'message-media');
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
      const safeId = String(messageId).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      const filename = `${safeId}.ogg`;
      fs.writeFileSync(path.join(mediaDir, filename), audioBuffer);
      return {
        mediaPath: filename,
        mediaName: 'voice-note.ogg',
        mediaMime: 'audio/ogg; codecs=opus',
      };
    } catch (err) {
      console.log('⚠️ Failed to cache outgoing VN, using wa: ref:', err?.message);
      return {
        mediaPath: `wa:${messageId}`,
        mediaName: 'voice-note.ogg',
        mediaMime: 'audio/ogg; codecs=opus',
      };
    }
  }

  function getSentMessageId(sendResult) {
    return sendResult?.id?._serialized || sendResult?.id?.id || sendResult?.key?.id || uuid();
  }

  function detectOutgoingMessageType(mimeType, forceDocument = false) {
    if (forceDocument) return 'document';
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.startsWith('image/')) return 'image';
    if (normalized.startsWith('video/')) return 'video';
    if (normalized.startsWith('audio/')) return 'audio';
    return 'document';
  }

  // Save outgoing media to disk for reliable access
  function persistOutgoingMedia(messageId, base64Data, mimeType, fileName) {
    const extension = getMediaExtension(mimeType, fileName);
    try {
      const mediaDir = path.join(__dirname, '..', 'data', 'message-media');
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
      const safeId = String(messageId).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      const filename = `${safeId}.${extension}`;
      fs.writeFileSync(path.join(mediaDir, filename), Buffer.from(base64Data, 'base64'));
      return {
        mediaPath: filename,
        mediaName: sanitizeDownloadName(fileName, `attachment.${extension}`),
        mediaMime: mimeType || detectMimeTypeFromFilename(fileName),
      };
    } catch (err) {
      console.log('⚠️ Failed to cache outgoing media, using wa: ref:', err?.message);
      return {
        mediaPath: `wa:${messageId}`,
        mediaName: sanitizeDownloadName(fileName, `attachment.${extension}`),
        mediaMime: mimeType || detectMimeTypeFromFilename(fileName),
      };
    }
  }

  function getBrowserPlayableAudioPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.mp3') return filePath;

    const browserPath = filePath.replace(/\.[^.]+$/, '.browser.mp3');

    try {
      const sourceStats = fs.statSync(filePath);
      if (fs.existsSync(browserPath)) {
        const cachedStats = fs.statSync(browserPath);
        if (cachedStats.size > 0 && cachedStats.mtimeMs >= sourceStats.mtimeMs) {
          return browserPath;
        }
      }

      execFileSync('ffmpeg', ['-y', '-i', filePath, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', browserPath], { stdio: 'ignore' });
      if (fs.existsSync(browserPath) && fs.statSync(browserPath).size > 0) {
        return browserPath;
      }
    } catch {}

    return filePath;
  }

  function toMp3DownloadName(filename) {
    const base = sanitizeDownloadName(filename, 'voice-note');
    return `${base.replace(/\.[^.]+$/, '')}.mp3`;
  }

  function getIncomingAudioExtension(mimeType) {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('ogg')) return 'ogg';
    if (normalized.includes('mpeg')) return 'mp3';
    if (normalized.includes('wav')) return 'wav';
    if (normalized.includes('mp4') || normalized.includes('aac') || normalized.includes('m4a')) return 'm4a';
    return 'webm';
  }

  function normalizeRecordedVoiceAudio(audioBuffer, mimeType) {
    const normalizedMime = String(mimeType || '').toLowerCase();
    if (normalizedMime.includes('ogg') && normalizedMime.includes('opus')) return audioBuffer;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-vn-'));
    const inputPath = path.join(tempDir, `input.${getIncomingAudioExtension(normalizedMime)}`);
    const outputPath = path.join(tempDir, 'output.ogg');

    try {
      fs.writeFileSync(inputPath, audioBuffer);
      execFileSync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '64k',
        '-ar', '48000',
        '-ac', '1',
        '-application', 'voip',
        '-vbr', 'constrained',
        '-frame_duration', '60',
        outputPath,
      ], { stdio: 'ignore' });

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('Converted audio was empty');
      }

      return fs.readFileSync(outputPath);
    } catch (err) {
      throw new Error(`Failed to convert recorded audio: ${err.message || err}`);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }

  function mergeContactRows(userId, sourceContactId, targetContactId, targetJid) {
    if (!sourceContactId || !targetContactId || sourceContactId === targetContactId) return;

    db.prepare('UPDATE messages SET contact_id = ?, jid = ? WHERE contact_id = ? AND user_id = ?')
      .run(targetContactId, targetJid, sourceContactId, userId);

    db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?')
      .run(sourceContactId, userId);
  }

  function canonicalizeContact(userId, contact) {
    if (!contact) return null;

    const canonicalJid = contact.jid.endsWith('@lid') ? getCanonicalPhoneJid(contact.phone) : contact.jid;
    if (!canonicalJid || canonicalJid === contact.jid) return contact;

    const canonicalPhoneDigits = normalizePhoneDigits(contact.phone);
    const canonicalPhone = canonicalPhoneDigits ? `+${canonicalPhoneDigits}` : null;
    const canonical = db.prepare('SELECT id, jid, name, phone FROM contacts WHERE jid = ? AND user_id = ?')
      .get(canonicalJid, userId);

    if (canonical && canonical.id !== contact.id) {
      const betterName = contact.name && !contact.name.includes('@') ? contact.name : canonical.name;
      db.prepare("UPDATE contacts SET name = COALESCE(?, name), phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(betterName, canonicalPhone, canonical.id, userId);
      mergeContactRows(userId, contact.id, canonical.id, canonicalJid);
      return { ...canonical, name: canonical.name || betterName, phone: canonical.phone || canonicalPhone };
    }

    db.prepare("UPDATE contacts SET jid = ?, phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(canonicalJid, canonicalPhone, contact.id, userId);
    db.prepare('UPDATE messages SET jid = ? WHERE contact_id = ? AND user_id = ?')
      .run(canonicalJid, contact.id, userId);

    return { ...contact, jid: canonicalJid, phone: contact.phone || canonicalPhone };
  }

  function resolveOutgoingTarget(userId, { contactId, jid }) {
    let contactRow = null;
    let targetJid = jid ? getCanonicalTargetJid(jid) : null;

    if (contactId && !jid) {
      const contact = db.prepare('SELECT id, jid, name, phone FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
      if (!contact) throw new Error('Contact not found');
      contactRow = canonicalizeContact(userId, contact);
      targetJid = contactRow?.jid || null;
    }

    if (!targetJid) throw new Error('Invalid WhatsApp number');

    // If we have a @lid JID but the contact has a phone, prefer phone-based JID for sending
    if (targetJid.endsWith('@lid')) {
      const phoneRow = contactRow || db.prepare('SELECT id, jid, phone FROM contacts WHERE jid = ? AND user_id = ?').get(targetJid, userId);
      if (phoneRow?.phone) {
        const digits = normalizePhoneDigits(phoneRow.phone);
        if (digits.length >= 7) {
          targetJid = `${digits}@s.whatsapp.net`;
          if (!contactRow) contactRow = phoneRow;
        }
      }
    }

    if (!contactRow) {
      contactRow = db.prepare('SELECT id, jid, phone FROM contacts WHERE jid = ? AND user_id = ?').get(targetJid, userId);
    }

    if (!contactRow) {
      const phoneDigits = targetJid.endsWith('@s.whatsapp.net') ? normalizePhoneDigits(targetJid) : '';
      const normalizedPhone = phoneDigits ? `+${phoneDigits}` : null;

      if (normalizedPhone) {
        contactRow = db.prepare(`
          SELECT id, jid, phone
          FROM contacts
          WHERE user_id = ? AND phone = ? AND is_group = 0
          ORDER BY CASE
            WHEN jid = ? THEN 0
            WHEN jid LIKE '%@lid' THEN 1
            ELSE 2
          END,
          updated_at DESC
          LIMIT 1
        `).get(userId, normalizedPhone, targetJid);

        if (contactRow) {
          db.prepare("UPDATE contacts SET jid = ?, phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ? AND user_id = ?")
            .run(targetJid, normalizedPhone, contactRow.id, userId);
          db.prepare('UPDATE messages SET jid = ? WHERE contact_id = ? AND user_id = ?')
            .run(targetJid, contactRow.id, userId);
        }
      }

      if (!contactRow) {
        const newId = uuid();
        const phone = normalizedPhone || (targetJid.endsWith('@lid') ? null : '+' + targetJid.replace(/@.*$/, ''));
        db.prepare(`
          INSERT INTO contacts (id, user_id, jid, name, phone, is_group) VALUES (?, ?, ?, ?, ?, 0)
        `).run(newId, userId, targetJid, phone || 'WhatsApp contact', phone);
        contactRow = { id: newId, jid: targetJid, phone };
      }
    }

    return { contactRow, targetJid };
  }

  // ── Status & QR ──────────────────────────────────────────
  router.get('/status', (req, res) => {
    const wa = getWA(req);
    const state = wa.getState();
    const stats = getStats(db, req.userId);
    res.json({ ...state, stats });
  });

  router.get('/sync-state', (req, res) => {
    const wa = getWA(req);
    const state = wa.getState();
    res.json(state.syncState || {});
  });

  router.get('/qr', async (req, res) => {
    const wa = getWA(req);
    const state = wa.getState();
    if (!state.qr) {
      return res.json({ qr: null, status: state.status });
    }
    const qrDataUrl = await QRCode.toDataURL(state.qr, { width: 256, margin: 1 });
    res.json({ qr: qrDataUrl, status: state.status });
  });

  // SSE for real-time updates (supports token via query param since EventSource doesn't support headers)
  router.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      send('ping', { ts: Date.now() });
    }, 15000);

    const wa = getWA(req);
    const state = wa.getState();
    send('status', { status: state.status });

    const unsub = onWhatsAppEvent(req.userId, (event, data) => {
      if (event === 'qr') {
        QRCode.toDataURL(data, { width: 256, margin: 1 }).then(qrUrl => {
          send('qr', { qr: qrUrl });
        });
      } else if (event === 'pairing_code') {
        send('pairing_code', data);
      } else if (event === 'connected') {
        send('status', { status: 'connected' });
      } else if (event === 'message') {
        send('message', data);
      } else if (event === 'status') {
        send('status', data);
      } else if (event === 'history_sync') {
        send('history_sync', data);
      } else if (event === 'contacts_sync') {
        send('contacts_sync', data);
      } else if (event === 'sync_state') {
        send('sync_state', data);
      } else if (event === 'status_update') {
        send('status_update', data);
      } else if (event === 'status_deleted') {
        send('status_deleted', data);
      } else if (event === 'call') {
        send('call', data);
      } else if (event === 'message_edited') {
        send('message_edited', data);
      } else if (event === 'message_ack') {
        send('message_ack', data);
      } else if (event === 'message_reaction') {
        send('message_reaction', data);
      }
    });

    const cleanup = () => {
      clearInterval(heartbeat);
      unsub();
    };

    req.on('close', cleanup);
    req.on('end', cleanup);
  });

  // ── ElevenLabs ───────────────────────────────────────────
  router.get('/voices', async (req, res) => {
    try {
      const apiKey = getConfig(db, req.userId, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API key not configured. Set it in Settings.' });

      const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } });
      if (!response.ok) {
        const details = await response.text();
        return res.status(response.status).json({ error: `ElevenLabs voices request failed: ${details}` });
      }

      const data = await response.json();
      const voices = (data.voices || []).map(v => ({
        id: v.voice_id,
        name: v.name,
        desc: v.labels?.description || v.labels?.accent || v.category || '',
        gender: v.labels?.gender || 'neutral',
        category: v.category || 'unknown',
      }));
      res.json(voices);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load voices from ElevenLabs' });
    }
  });

  router.get('/elevenlabs/test', async (req, res) => {
    try {
      const apiKey = getConfig(db, req.userId, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API key not configured.' });

      const response = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } });
      if (!response.ok) {
        const details = await response.text();
        return res.status(response.status).json({ error: `ElevenLabs auth/test failed: ${details}` });
      }

      const data = await response.json();
      const voices = data.voices || [];
      const generatedVoices = voices.filter((v) => ['generated', 'cloned', 'professional'].includes(v.category)).length;
      res.json({ success: true, totalVoices: voices.length, generatedVoices, supportsV3Prompts: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'ElevenLabs test failed' });
    }
  });

  // ── Contacts ──────────────────────────────────────────────
  router.get('/contacts', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 5000);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';

    // Get total count
    let totalRow;
    if (search) {
      const q = `%${search}%`;
      totalRow = db.prepare(`SELECT COUNT(*) as total FROM contacts WHERE user_id = ? AND is_group = 0 AND (name LIKE ? OR phone LIKE ? OR jid LIKE ?)`).get(req.userId, q, q, q);
    } else {
      totalRow = db.prepare(`SELECT COUNT(*) as total FROM contacts WHERE user_id = ? AND is_group = 0`).get(req.userId);
    }

    let contacts;
    if (search) {
      const q = `%${search}%`;
      contacts = db.prepare(`
        SELECT c.*, COALESCE(mc.message_count, 0) as message_count
        FROM contacts c
        LEFT JOIN (
          SELECT contact_id, COUNT(*) as message_count
          FROM messages
          WHERE user_id = ?
          GROUP BY contact_id
        ) mc ON mc.contact_id = c.id
        WHERE c.user_id = ? AND c.is_group = 0
          AND (c.name LIKE ? OR c.phone LIKE ? OR c.jid LIKE ?)
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `).all(req.userId, req.userId, q, q, q, limit, offset);
    } else {
      contacts = db.prepare(`
        SELECT c.*, COALESCE(mc.message_count, 0) as message_count
        FROM contacts c
        LEFT JOIN (
          SELECT contact_id, COUNT(*) as message_count
          FROM messages
          WHERE user_id = ?
          GROUP BY contact_id
        ) mc ON mc.contact_id = c.id
        WHERE c.user_id = ? AND c.is_group = 0
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `).all(req.userId, req.userId, limit, offset);
    }
    res.json({ contacts, total: totalRow?.total || 0 });
  });

  // ── Save / Create Contact Manually ──────────────────────
  router.post('/contacts', (req, res) => {
    try {
      const { name, phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'Phone number is required' });

      const digits = phone.replace(/\D/g, '');
      if (!digits || digits.length < 7) return res.status(400).json({ error: 'Invalid phone number' });

      const jid = `${digits}@s.whatsapp.net`;
      const contactName = name?.trim() || `+${digits}`;

      // Check if already exists
      const existing = db.prepare('SELECT id FROM contacts WHERE jid = ? AND user_id = ?').get(jid, req.userId);
      if (existing) {
        // Update name if provided
        if (name?.trim()) {
          db.prepare("UPDATE contacts SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(contactName, existing.id, req.userId);
        }
        return res.json({ id: existing.id, updated: true });
      }

      const id = uuid();
      db.prepare(`
        INSERT INTO contacts (id, user_id, jid, name, phone, is_group, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
      `).run(id, req.userId, jid, contactName, digits);

      res.json({ id, created: true });
    } catch (err) {
      console.error('Save contact error:', err);
      res.status(500).json({ error: 'Failed to save contact' });
    }
  });

  // ── Contact Memory, Directive & AI Toggle ────────────────
  router.get('/contacts/:id/memory', (req, res) => {
    try {
      const row = db.prepare('SELECT memory, active_directive, directive_expires, ai_enabled, memory_enabled, last_summary_at, reply_language FROM contacts WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.userId);
      if (!row) return res.status(404).json({ error: 'Contact not found' });
      res.json({
        memory: row.memory || '',
        active_directive: row.active_directive || '',
        directive_expires: row.directive_expires || null,
        ai_enabled: row.ai_enabled ?? 1,
        memory_enabled: row.memory_enabled ?? 1,
        last_summary_at: row.last_summary_at || null,
        reply_language: row.reply_language || null,
        timezone: (db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'ai_timezone'").get(req.userId)?.value) || 'America/New_York',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/contacts/:id/memory', (req, res) => {
    try {
      const { memory } = req.body;
      db.prepare("UPDATE contacts SET memory = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(memory || null, req.params.id, req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/contacts/:id/directive', (req, res) => {
    try {
      const { directive, expires } = req.body;
      db.prepare("UPDATE contacts SET active_directive = ?, directive_expires = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(directive || null, expires || null, req.params.id, req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/contacts/:id/ai-toggle', (req, res) => {
    try {
      const { enabled } = req.body;
      db.prepare("UPDATE contacts SET ai_enabled = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(enabled ? 1 : 0, req.params.id, req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Per-contact memory toggle: when off, AI receives no memory for this contact AND
  // summarization is skipped (so noisy contacts don't accumulate junk).
  router.put('/contacts/:id/memory-toggle', (req, res) => {
    try {
      const { enabled } = req.body;
      db.prepare("UPDATE contacts SET memory_enabled = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(enabled ? 1 : 0, req.params.id, req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Per-contact reply language lock. Body: { language: string | null }
  // "auto", null, or empty string all clear the lock (no language enforcement).
  router.put('/contacts/:id/reply-language', (req, res) => {
    try {
      let { language } = req.body;
      if (!language || language === 'auto') language = null;
      else language = String(language).toLowerCase();
      db.prepare("UPDATE contacts SET reply_language = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(language, req.params.id, req.userId);
      res.json({ success: true, reply_language: language });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual "Summarize now" — bypasses the 10-msg auto threshold.
  router.post('/contacts/:id/summarize-now', async (req, res) => {
    try {
      const contactId = req.params.id;
      const contactRow = db.prepare('SELECT id, jid, name, phone FROM contacts WHERE id = ? AND user_id = ?').get(contactId, req.userId);
      if (!contactRow) return res.status(404).json({ error: 'Contact not found' });
      const keyRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'openai_api_key'").get(req.userId);
      if (!keyRow?.value) return res.status(400).json({ error: 'OpenAI API key not configured' });
      const result = await triggerConversationSummary(
        req.userId, db, contactRow.id, contactRow.jid,
        contactRow.name || contactRow.phone, keyRow.value, { force: true }
      );
      if (!result?.ran) return res.json({ success: false, reason: result?.reason || 'unknown' });
      const updated = db.prepare('SELECT memory, last_summary_at FROM contacts WHERE id = ? AND user_id = ?').get(contactId, req.userId);
      res.json({ success: true, memory: updated?.memory || '', last_summary_at: updated?.last_summary_at || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Messages / Conversations ─────────────────────────────
  router.get('/messages/:contactId', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const before = req.query.before || null;

    let messages;
    if (before) {
      messages = db.prepare(`
        SELECT * FROM messages
        WHERE contact_id = ? AND user_id = ? AND timestamp < ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(req.params.contactId, req.userId, before, limit).reverse();
    } else {
      // Get latest N messages
      messages = db.prepare(`
        SELECT * FROM (
          SELECT * FROM messages
          WHERE contact_id = ? AND user_id = ?
          ORDER BY timestamp DESC
          LIMIT ?
        ) sub ORDER BY timestamp ASC
      `).all(req.params.contactId, req.userId, limit);
    }

    // Include hasMore flag
    const total = db.prepare('SELECT COUNT(*) as c FROM messages WHERE contact_id = ? AND user_id = ?').get(req.params.contactId, req.userId)?.c || 0;
    res.json({ messages, hasMore: total > messages.length && !before ? total > limit : messages.length === limit });
  });

  router.get('/conversations', (req, res) => {
    const conversations = db.prepare(`
      WITH ranked_messages AS (
        SELECT m.*, ROW_NUMBER() OVER (
          PARTITION BY m.contact_id
          ORDER BY m.timestamp DESC, m.created_at DESC, m.id DESC
        ) as rn
        FROM messages m
        WHERE m.user_id = ?
      )
      SELECT c.*, rm.content as last_message, rm.type as last_type, rm.timestamp as last_timestamp,
             COALESCE(c.is_archived, 0) as is_archived, COALESCE(c.unread_count, 0) as unread_count
      FROM contacts c
      INNER JOIN ranked_messages rm ON rm.contact_id = c.id AND rm.rn = 1
      WHERE c.user_id = ? AND c.is_group = 0
      ORDER BY rm.timestamp DESC
    `).all(req.userId, req.userId);
    res.json(conversations);
  });

  // ── Global Message Search ─────────────────────────────────
  router.get('/search/messages', (req, res) => {
    try {
      const query = req.query.q || '';
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      if (!query.trim()) return res.json([]);

      const q = `%${query}%`;
      const results = db.prepare(`
        SELECT m.*, c.name as contact_name, c.phone as contact_phone, c.avatar_url as contact_avatar
        FROM messages m
        LEFT JOIN contacts c ON c.id = m.contact_id
        WHERE m.user_id = ? AND m.content LIKE ? AND m.type IN ('text', 'image', 'video', 'document')
        ORDER BY m.timestamp DESC
        LIMIT ?
      `).all(req.userId, q, limit);
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Archive / Unarchive ─────────────────────────────────
  router.post('/archive/:contactId', async (req, res) => {
    try {
      const { archive } = req.body;
      const result = await archiveChat(req.userId, db, req.params.contactId, !!archive);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Mark chat as read ──────────────────────────────────
  router.post('/mark-read/:contactId', async (req, res) => {
    try {
      const result = await markChatRead(req.userId, db, req.params.contactId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Star / Unstar Message ─────────────────────────────────
  router.post('/messages/:messageId/star', (req, res) => {
    try {
      const { starred } = req.body;
      db.prepare('UPDATE messages SET is_starred = ? WHERE id = ? AND user_id = ?')
        .run(starred ? 1 : 0, req.params.messageId, req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── React to Message ──────────────────────────────────────
  router.post('/messages/:messageId/react', async (req, res) => {
    try {
      const { emoji } = req.body;
      if (!emoji) return res.status(400).json({ error: 'Emoji required' });

      const wa = getWA(req);
      const state = wa.getState();
      if (state.status !== 'connected') return res.status(400).json({ error: 'WhatsApp not connected' });

      const msgRow = db.prepare('SELECT jid FROM messages WHERE id = ? AND user_id = ?').get(req.params.messageId, req.userId);
      if (!msgRow) return res.status(404).json({ error: 'Message not found' });

      const chatId = msgRow.jid.replace(/@s\.whatsapp\.net$/, '@c.us');
      const inst = wa.getInstance();
      const chat = await inst.client.getChatById(chatId);
      const waMessages = await chat.fetchMessages({ limit: 50 });
      const waMsg = waMessages.find(m => (m.id?._serialized || m.id?.id) === req.params.messageId);
      if (!waMsg) return res.status(404).json({ error: 'WhatsApp message not found in recent history' });

      await waMsg.react(emoji);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to react' });
    }
  });

  router.get('/starred-messages', (req, res) => {
    try {
      const messages = db.prepare(`
        SELECT m.*, c.name as contact_name, c.phone as contact_phone, c.jid as contact_jid
        FROM messages m
        LEFT JOIN contacts c ON c.id = m.contact_id
        WHERE m.user_id = ? AND m.is_starred = 1
        ORDER BY m.timestamp DESC
      `).all(req.userId);
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Get Media for Contact ─────────────────────────────────
  router.get('/contacts/:contactId/media', (req, res) => {
    try {
      const media = db.prepare(`
        SELECT * FROM messages
        WHERE contact_id = ? AND user_id = ? AND type IN ('image', 'video', 'document', 'sticker') AND media_path IS NOT NULL
        ORDER BY timestamp DESC
      `).all(req.params.contactId, req.userId);
      res.json(media);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send Text ─────────────────────────────────────────────
  router.post('/send/text', async (req, res) => {
    try {
      const { contactId, jid, message, quotedMessageId } = req.body;
      if (!message || (!contactId && !jid)) return res.status(400).json({ error: 'Missing contactId/jid or message' });

      const wa = getWA(req);
      const { contactRow, targetJid } = resolveOutgoingTarget(req.userId, { contactId, jid });

      let sendResult;
      sendResult = await wa.sendTextMessage(targetJid, message, { quotedMessageId });
      const msgId = getSentMessageId(sendResult);

      // Get quoted message info for DB
      let replyToId = null, replyToContent = null, replyToSender = null;
      if (quotedMessageId) {
        const quotedRow = db.prepare('SELECT content, direction, contact_id FROM messages WHERE id = ? AND user_id = ?').get(quotedMessageId, req.userId);
        if (quotedRow) {
          replyToId = quotedMessageId;
          replyToContent = (quotedRow.content || '').slice(0, 200);
          replyToSender = quotedRow.direction === 'sent' ? 'You' : null;
          if (!replyToSender) {
            const c = db.prepare('SELECT name, phone FROM contacts WHERE id = ? AND user_id = ?').get(quotedRow.contact_id, req.userId);
            replyToSender = c?.name || c?.phone || null;
          }
        }
      }

      db.prepare(`
        INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, reply_to_id, reply_to_content, reply_to_sender)
        VALUES (?, ?, ?, ?, ?, 'text', 'sent', ?, 'sent', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          contact_id = excluded.contact_id,
          jid = excluded.jid,
          content = excluded.content,
          direction = excluded.direction,
          timestamp = excluded.timestamp,
          status = excluded.status
      `).run(msgId, req.userId, contactRow.id, targetJid, message, new Date().toISOString(), replyToId, replyToContent, replyToSender);
      db.prepare(`INSERT INTO stats (user_id, event) VALUES (?, 'message_sent')`).run(req.userId);

      // Build memory from outbound text too (so info you share manually gets captured).
      try {
        const keyRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'openai_api_key'").get(req.userId);
        if (keyRow?.value) {
          triggerConversationSummary(req.userId, db, contactRow.id, targetJid, contactRow.name || contactRow.phone, keyRow.value).catch(() => {});
        }
      } catch {}

      res.json({ success: true, messageId: msgId, contactId: contactRow.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Forward Message ─────────────────────────────────────────
  router.post('/forward/message', async (req, res) => {
    try {
      const { messageId, targetContactId, targetJid: targetJidRaw } = req.body;
      if (!messageId || (!targetContactId && !targetJidRaw)) {
        return res.status(400).json({ error: 'Missing messageId or target' });
      }

      const wa = getWA(req);
      const { contactRow, targetJid } = resolveOutgoingTarget(req.userId, { contactId: targetContactId, jid: targetJidRaw });

      // Get original message
      const original = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(messageId, req.userId);
      if (!original) return res.status(404).json({ error: 'Message not found' });

      let sendResult;
      if (original.type === 'text') {
        sendResult = await wa.sendTextMessage(targetJid, original.content || '');
      } else if (original.media_path && !original.media_path.startsWith('wa:')) {
        // Forward media from disk
        const filePath = resolveMessageMediaPath(original.media_path);
        if (filePath && fs.existsSync(filePath)) {
          const base64Data = fs.readFileSync(filePath).toString('base64');
          sendResult = await wa.sendMediaMessage(targetJid, {
            mimeType: original.media_mime || 'application/octet-stream',
            data: base64Data,
            fileName: original.media_name || 'forwarded',
            caption: original.content || '',
            sendAsDocument: original.type === 'document',
          });
        } else {
          // Try forwarding via WA
          try {
            const msg = await wa.getMessageById(messageId);
            if (msg) {
              const chat = await wa.client.getChatById(fromJid(targetJid));
              sendResult = await msg.forward(chat);
            }
          } catch {}
          if (!sendResult) return res.status(400).json({ error: 'Media file not available for forwarding' });
        }
      } else {
        // Try native forward
        try {
          const msg = await wa.getMessageById(messageId);
          if (msg) {
            const chat = await wa.client.getChatById(fromJid(targetJid));
            sendResult = await msg.forward(chat);
          }
        } catch {}
        if (!sendResult) {
          // Fallback: send as text
          sendResult = await wa.sendTextMessage(targetJid, original.content || '[Forwarded message]');
        }
      }

      const msgId = getSentMessageId(sendResult);
      db.prepare(`
        INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, media_path, media_name, media_mime)
        VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, 'sent', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(msgId, req.userId, contactRow.id, targetJid, original.content, original.type, new Date().toISOString(), null, original.media_name, original.media_mime);
      db.prepare(`INSERT INTO stats (user_id, event) VALUES (?, 'message_sent')`).run(req.userId);

      res.json({ success: true, messageId: msgId, contactId: contactRow.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Edit Message ──────────────────────────────────────────
  router.post('/edit/message', async (req, res) => {
    try {
      const { messageId, newContent } = req.body;
      if (!messageId || !newContent) return res.status(400).json({ error: 'Missing messageId or newContent' });
      const wa = getWA(req);
      const result = await wa.editMessage(messageId, newContent);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/send/media', async (req, res) => {
    try {
      const { contactId, jid, fileName, mimeType, data, caption, sendAsDocument, isViewOnce } = req.body;
      if (!fileName || !mimeType || !data || (!contactId && !jid)) {
        return res.status(400).json({ error: 'Missing target or media payload' });
      }

      const wa = getWA(req);
      const { contactRow, targetJid } = resolveOutgoingTarget(req.userId, { contactId, jid });
      const normalizedBase64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
      const messageType = detectOutgoingMessageType(mimeType, !!sendAsDocument);

      const sendResult = await wa.sendMediaMessage(targetJid, {
        mimeType,
        data: normalizedBase64,
        fileName,
        caption,
        sendAsDocument: !!sendAsDocument,
        isViewOnce: !!isViewOnce,
      });

      const msgId = getSentMessageId(sendResult);
      const savedMedia = persistOutgoingMedia(msgId, normalizedBase64, mimeType, fileName);

      db.prepare(`
        INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, media_path, media_name, media_mime, is_view_once)
        VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, 'sent', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          contact_id = excluded.contact_id,
          jid = excluded.jid,
          content = excluded.content,
          type = excluded.type,
          direction = excluded.direction,
          timestamp = excluded.timestamp,
          status = excluded.status,
          media_path = COALESCE(excluded.media_path, messages.media_path),
          media_name = COALESCE(excluded.media_name, messages.media_name),
          media_mime = COALESCE(excluded.media_mime, messages.media_mime),
          is_view_once = excluded.is_view_once
      `).run(
        msgId,
        req.userId,
        contactRow.id,
        targetJid,
        caption || fileName,
        messageType,
        new Date().toISOString(),
        savedMedia.mediaPath,
        savedMedia.mediaName,
        savedMedia.mediaMime,
        isViewOnce ? 1 : 0,
      );

      db.prepare(`INSERT INTO stats (user_id, event) VALUES (?, 'message_sent')`).run(req.userId);

      // Auto-delete audio files from disk after successful send
      const normalizedMime = String(mimeType || '').toLowerCase();
      if (normalizedMime.startsWith('audio/') && savedMedia.mediaPath && !savedMedia.mediaPath.startsWith('wa:')) {
        try {
          const mediaDir = path.join(__dirname, '..', 'data', 'message-media');
          const filePath = path.join(mediaDir, savedMedia.mediaPath);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            // Clear media_path in DB so it doesn't try to serve a deleted file
            db.prepare(`UPDATE messages SET media_path = NULL WHERE id = ? AND user_id = ?`).run(msgId, req.userId);
            console.log(`🗑️ Auto-deleted audio file after send: ${savedMedia.mediaPath}`);
          }
        } catch (delErr) {
          console.log('⚠️ Failed to auto-delete audio file:', delErr?.message);
        }
      }

      res.json({ success: true, messageId: msgId, contactId: contactRow.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send Voice Note ─────────────────────────────────────
  router.post('/send/voice', async (req, res) => {
    try {
      const { contactId, text, voiceId, modelId, backgroundSound, bgVolume } = req.body;
      if (!contactId || !text) return res.status(400).json({ error: 'Missing contactId or text' });

      const limitCheck = checkVoiceLimit(db, req.userId);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          error: limitCheck.reason === 'voice_notes_disabled'
            ? 'Voice notes are disabled for this account by the admin.'
            : `Daily voice-note limit reached (${limitCheck.sentToday}/${limitCheck.limit}). Try again tomorrow or ask the admin to raise the limit.`,
          reason: limitCheck.reason,
          limit: limitCheck.limit,
          sentToday: limitCheck.sentToday,
        });
      }

      const apiKey = getConfig(db, req.userId, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API key not configured.' });

      const wa = getWA(req);
      const { contactRow, targetJid } = resolveOutgoingTarget(req.userId, { contactId });
      const volume = bgVolume != null ? parseFloat(bgVolume) : 0.15;
      // ALWAYS enhance — no raw-text fallback. If enhance fails or no OpenAI
      // key is set, the request errors out (400 / 500). Per user request.
      const openaiKey = getConfig(db, req.userId, 'openai_api_key') || process.env.OPENAI_API_KEY;
      if (!openaiKey) return res.status(400).json({ error: 'OpenAI API key required to enhance VN text. No fallback to raw text.' });
      const speakable = await enhanceTextForVoice(openaiKey, text);
      const audioBuffer = await generateVoiceNote(apiKey, speakable, voiceId || 'JBFqnCBsd6RMkjVDRZzb', modelId || null, backgroundSound || null, volume);

      const sendResult = await wa.sendVoiceNote(targetJid, audioBuffer);
      const msgId = getSentMessageId(sendResult);
      const savedVoice = persistOutgoingVoiceNote(msgId, audioBuffer);

      db.prepare(`
        INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, media_path, media_name, media_mime)
        VALUES (?, ?, ?, ?, ?, 'voice', 'sent', ?, 'sent', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          timestamp = excluded.timestamp,
          status = excluded.status,
          media_path = COALESCE(excluded.media_path, messages.media_path),
          media_name = COALESCE(excluded.media_name, messages.media_name),
          media_mime = COALESCE(excluded.media_mime, messages.media_mime)
      `).run(msgId, req.userId, contactRow.id, targetJid, text, new Date().toISOString(), savedVoice.mediaPath, savedVoice.mediaName, savedVoice.mediaMime);
      db.prepare(`INSERT INTO stats (user_id, event) VALUES (?, 'voice_sent')`).run(req.userId);

      res.json({ success: true, messageId: msgId, contactId: contactRow.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send Live Voice Recording ────────────────────────────
  router.post('/send/voice-recording', async (req, res) => {
    try {
      const { contactId, jid, data: audioData, mimeType } = req.body;
      if (!audioData || (!contactId && !jid)) return res.status(400).json({ error: 'Missing target or audio data' });

      const limitCheck = checkVoiceLimit(db, req.userId);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          error: limitCheck.reason === 'voice_notes_disabled'
            ? 'Voice notes are disabled for this account by the admin.'
            : `Daily voice-note limit reached (${limitCheck.sentToday}/${limitCheck.limit}). Try again tomorrow or ask the admin to raise the limit.`,
          reason: limitCheck.reason,
          limit: limitCheck.limit,
          sentToday: limitCheck.sentToday,
        });
      }

      const wa = getWA(req);
      const { contactRow, targetJid } = resolveOutgoingTarget(req.userId, { contactId, jid });

      // Convert base64 audio to buffer
      const normalizedBase64 = String(audioData).replace(/^data:[^;]+;base64,/, '');
      const rawAudioBuffer = Buffer.from(normalizedBase64, 'base64');
      const audioBuffer = normalizeRecordedVoiceAudio(rawAudioBuffer, mimeType || 'audio/webm');

      const sendResult = await wa.sendVoiceNote(targetJid, audioBuffer);
      const msgId = getSentMessageId(sendResult);

      // Don't persist to disk - use wa: reference
      const mediaRef = `wa:${msgId}`;

      db.prepare(`
        INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status, media_path, media_name, media_mime)
        VALUES (?, ?, ?, ?, ?, 'voice', 'sent', ?, 'sent', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          timestamp = excluded.timestamp,
          status = excluded.status,
          media_path = COALESCE(excluded.media_path, messages.media_path),
          media_name = COALESCE(excluded.media_name, messages.media_name),
          media_mime = COALESCE(excluded.media_mime, messages.media_mime)
      `).run(msgId, req.userId, contactRow.id, targetJid, '🎤 Voice note', new Date().toISOString(), mediaRef, 'voice-note.ogg', 'audio/ogg; codecs=opus');
      db.prepare(`INSERT INTO stats (user_id, event) VALUES (?, 'voice_sent')`).run(req.userId);

      res.json({ success: true, messageId: msgId, contactId: contactRow.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  router.post('/voice/preview', async (req, res) => {
    try {
      const { text, voiceId, modelId, backgroundSound, bgVolume } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing text' });

      // Voice Studio previews also count against the admin-set daily voice limit,
      // since each preview burns ElevenLabs character quota.
      const limitCheck = checkVoiceLimit(db, req.userId);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          error: limitCheck.reason === 'voice_notes_disabled'
            ? 'Voice notes (including Voice Studio) are disabled for this account by the admin.'
            : `Daily voice-note limit reached (${limitCheck.sentToday}/${limitCheck.limit}). This includes Voice Studio previews. Try again tomorrow or ask the admin to raise the limit.`,
          reason: limitCheck.reason,
          limit: limitCheck.limit,
          sentToday: limitCheck.sentToday,
        });
      }

      const apiKey = getConfig(db, req.userId, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API key not configured' });

      const volume = bgVolume != null ? parseFloat(bgVolume) : 0.15;
      const audioBuffer = await generatePreviewAudio(apiKey, text, voiceId || 'JBFqnCBsd6RMkjVDRZzb', modelId || null, backgroundSound || null, volume);
      // Count this preview toward today's usage so the limit truly caps Voice Studio activity.
      try { db.prepare(`INSERT INTO stats (user_id, event) VALUES (?, 'voice_sent')`).run(req.userId); } catch {}
      res.set('Content-Type', 'audio/mpeg');
      res.send(audioBuffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Enhance text ────────────────────────────────────────
  router.post('/enhance', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing text' });

      const apiKey = getConfig(db, req.userId, 'openai_api_key') || process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(400).json({ error: 'OpenAI API key not configured.' });

      const enhanced = await enhanceTextForVoice(apiKey, text);

      res.json({ enhanced });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Enhancement failed' });
    }
  });

  // ── Custom Sounds ────────────────────────────────────────
  const soundsDir = path.join(__dirname, '..', 'data', 'sounds');
  const soundUpload = multer({ dest: path.join(__dirname, '..', 'data', 'temp'), limits: { fileSize: 50 * 1024 * 1024 } });

  router.get('/sounds', (req, res) => {
    // Presets removed — only user-extracted/uploaded sounds are returned.
    const custom = db.prepare('SELECT * FROM custom_sounds WHERE user_id = ? ORDER BY created_at DESC').all(req.userId).map(s => ({
      id: s.sound_id,
      name: s.name,
      type: 'custom',
      duration: s.duration,
      dbId: s.id,
    }));
    res.json({ presets: [], custom });
  });

  router.post('/sounds/upload', soundUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const name = req.body.name || req.file.originalname.replace(/\.[^.]+$/, '');
      const soundId = `custom-${uuid()}`;
      if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
      const outputPath = path.join(soundsDir, `${soundId}.mp3`);

      // Extract audio with ffmpeg
      try {
        execSync(`ffmpeg -y -i "${req.file.path}" -vn -c:a libmp3lame -b:a 128k -ar 44100 -ac 1 "${outputPath}"`, { stdio: 'pipe' });
      } catch (ffErr) {
        return res.status(400).json({ error: 'Failed to extract audio. Is this a valid audio/video file?' });
      }

      // Get duration
      let duration = 0;
      try {
        const probe = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${outputPath}"`, { stdio: 'pipe' }).toString().trim();
        duration = Math.round(parseFloat(probe) || 0);
      } catch {}

      db.prepare('INSERT INTO custom_sounds (user_id, sound_id, name, filename, duration) VALUES (?, ?, ?, ?, ?)')
        .run(req.userId, soundId, name, `${soundId}.mp3`, duration);

      // Cleanup temp upload
      try { fs.unlinkSync(req.file.path); } catch {}

      res.json({ soundId, name, duration });
    } catch (err) {
      try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch {}
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/sounds/:id', (req, res) => {
    try {
      const sound = db.prepare('SELECT * FROM custom_sounds WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
      if (!sound) return res.status(404).json({ error: 'Sound not found' });
      try { fs.unlinkSync(path.join(soundsDir, sound.filename)); } catch {}
      db.prepare('DELETE FROM custom_sounds WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rename a custom sound
  router.patch('/sounds/:id', (req, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Missing name' });
      const sound = db.prepare('SELECT * FROM custom_sounds WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
      if (!sound) return res.status(404).json({ error: 'Sound not found' });
      db.prepare('UPDATE custom_sounds SET name = ? WHERE id = ? AND user_id = ?').run(name, req.params.id, req.userId);
      res.json({ success: true, name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stream a custom or preset sound for preview playback (with Range support)
  router.get('/sounds/:soundId/stream', (req, res) => {
    try {
      let soundFile = path.join(soundsDir, `${req.params.soundId}.mp3`);
      // Also check for preset sounds generated by elevenlabs
      if (!fs.existsSync(soundFile)) {
        // Try preset sound path
        const presetPath = path.join(soundsDir, `preset-${req.params.soundId}.mp3`);
        if (fs.existsSync(presetPath)) {
          soundFile = presetPath;
        } else {
          return res.status(404).json({ error: 'Sound file not found' });
        }
      }

      const stat = fs.statSync(soundFile);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(soundFile, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=3600',
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'audio/mpeg',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        });
        fs.createReadStream(soundFile).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trim/crop a custom sound
  router.post('/sounds/:id/trim', async (req, res) => {
    try {
      const { start, end } = req.body;
      if (start == null || end == null || start >= end) {
        return res.status(400).json({ error: 'Invalid start/end times' });
      }
      const sound = db.prepare('SELECT * FROM custom_sounds WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
      if (!sound) return res.status(404).json({ error: 'Sound not found' });

      const inputPath = path.join(soundsDir, sound.filename);
      if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'Sound file missing' });

      const tempOutput = path.join(soundsDir, `trim-temp-${sound.sound_id}.mp3`);
      try {
        execSync(`ffmpeg -y -i "${inputPath}" -ss ${start} -to ${end} -c:a libmp3lame -b:a 128k "${tempOutput}"`, { stdio: 'pipe' });
      } catch (ffErr) {
        return res.status(500).json({ error: 'Trim failed' });
      }

      // Replace original file
      fs.renameSync(tempOutput, inputPath);

      // Update duration
      let duration = Math.round(end - start);
      try {
        const probe = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${inputPath}"`, { stdio: 'pipe' }).toString().trim();
        duration = Math.round(parseFloat(probe) || duration);
      } catch {}

      db.prepare('UPDATE custom_sounds SET duration = ? WHERE id = ? AND user_id = ?').run(duration, req.params.id, req.userId);

      res.json({ success: true, duration });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  router.get('/config/:key', (req, res) => {
    const val = getConfig(db, req.userId, req.params.key);
    if (req.params.key.includes('api_key') && val) {
      res.json({ value: val.slice(0, 6) + '...' + val.slice(-4), exists: true });
    } else {
      res.json({ value: val, exists: !!val });
    }
  });

  router.post('/config', (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    setConfig(db, req.userId, key, value);

    // When automation is turned off, cancel all pending scheduled replies
    if (key === 'automation_enabled' && value !== 'true') {
      const cancelled = cancelAllPendingReplies(req.userId);
      return res.json({ success: true, cancelledReplies: cancelled });
    }

    // If Telegram credentials were just saved, (re)start the polling loop
    // immediately so the user doesn't have to restart the backend.
    if (key === 'telegram_bot_token' || key === 'telegram_chat_id') {
      try {
        // Stop any existing loop so a new token is picked up cleanly
        stopTelegramPolling(req.userId);
        ensureTelegramPolling(db, req.userId);
      } catch (e) {
        console.error('telegram restart error:', e?.message);
      }
    }

    if (key === 'conversation_starters') {
      try {
        ensureUserBackgroundServices(db, req.userId);
      } catch (e) {
        console.error('conversation starter restart error:', e?.message);
      }
    }

    res.json({ success: true });
  });

  // Cancel a specific pending auto-reply
  router.post('/cancel-reply', (req, res) => {
    try {
      const { contact } = req.body;
      if (!contact) return res.status(400).json({ error: 'Missing contact identifier' });
      const cancelled = cancelPendingReplyForContact(req.userId, contact);
      res.json({ success: true, cancelled });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/reconnect', async (req, res) => {
    try {
      const wa = getWA(req);
      const currentState = wa.getState();

      if (currentState.status === 'qr_waiting') {
        return res.json({ success: true, state: currentState, skipped: true });
      }

      await wa.reconnect({ force: true });
      res.json({ success: true, state: wa.getState() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/disconnect', async (req, res) => {
    try {
      const wa = getWA(req);
      await wa.disconnect();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/pair-phone', async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) return res.status(400).json({ error: 'Missing phoneNumber' });
      const code = await requestPairingWithPhone(req.userId, phoneNumber);
      res.json({ success: true, code });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/trigger-sync', async (req, res) => {
    try {
      const wa = getWA(req);
      await wa.triggerSync();
      const state = wa.getState();
      res.json({ success: true, syncState: state.syncState || {} });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Recover single chat history ─────────────────────────
  router.post('/recover-chat/:contactId', async (req, res) => {
    try {
      const result = await recoverSingleChat(req.userId, db, req.params.contactId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sync Diagnostics ───────────────────────────────────
  router.get('/sync-diagnostics', (req, res) => {
    try {
      const diagnostics = getSyncDiagnostics(req.userId, db);
      res.json(diagnostics);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Full Reset (wipe DB + session for clean re-pair) ──
  router.post('/full-reset', async (req, res) => {
    try {
      const wa = getOrInitWhatsApp(req.userId, db);
      await wa.clearSession();
      res.json({ success: true, message: 'Session and data wiped. Scan QR to re-pair for a full history sync.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Voice media playback ───────────────────────────────
  router.get('/voice-media/:filename', (req, res) => {
    try {
      const filePath = path.join(__dirname, '..', 'data', 'voice-media', req.params.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Voice note not found' });
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === '.mp3'
        ? 'audio/mpeg'
        : ext === '.m4a'
          ? 'audio/mp4'
          : ext === '.wav'
            ? 'audio/wav'
            : ext === '.webm'
              ? 'audio/webm'
              : 'audio/ogg';
      res.set('Content-Type', type);
      res.set('Accept-Ranges', 'bytes');
      res.sendFile(filePath);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/message-media/:filename', async (req, res) => {
    try {
      const safeFilename = path.basename(req.params.filename);

      // Check if this is an on-demand WhatsApp media reference (wa:messageId format)
      const mediaRef = safeFilename.startsWith('wa:') ? safeFilename : null;
      const messageId = mediaRef ? safeFilename.slice(3) : null;

      // Look up the media_path in DB (could be wa:msgId or legacy filename)
      const mediaRow = db.prepare(`
        SELECT id, media_mime, media_name, media_path, type
        FROM messages
        WHERE user_id = ? AND media_path = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(req.userId, safeFilename);

      // If media_path starts with wa: or we have a wa: reference, stream from WhatsApp
      const resolvedMediaPath = mediaRow?.media_path || safeFilename;
      if (resolvedMediaPath.startsWith('wa:')) {
        const waMessageId = resolvedMediaPath.slice(3);
        try {
          const streamed = await streamMediaForMessage(req.userId, waMessageId);
          let responseMime = streamed.mimetype || mediaRow?.media_mime || 'application/octet-stream';
          let responseData = streamed.data;

          // Convert audio to mp3 for browser compatibility if requested
          if (req.query.format === 'mp3' && String(responseMime).startsWith('audio/') && !responseMime.includes('mpeg')) {
            try {
              const tmpIn = path.join('/tmp', `wa_${waMessageId}_in.ogg`);
              const tmpOut = path.join('/tmp', `wa_${waMessageId}_out.mp3`);
              fs.writeFileSync(tmpIn, responseData);
              execFileSync('ffmpeg', ['-y', '-i', tmpIn, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', tmpOut], { stdio: 'ignore' });
              if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
                responseData = fs.readFileSync(tmpOut);
                responseMime = 'audio/mpeg';
              }
              try { fs.unlinkSync(tmpIn); } catch {}
              try { fs.unlinkSync(tmpOut); } catch {}
            } catch {}
          }

          res.set('Content-Type', responseMime);
          res.set('Content-Length', String(responseData.length));

          if (req.query.download === '1') {
            const downloadName = sanitizeDownloadName(mediaRow?.media_name || streamed.filename || 'attachment', 'attachment');
            res.set('Content-Disposition', `attachment; filename="${downloadName}"`);
          }

          return res.send(responseData);
        } catch (streamErr) {
          console.log(`⚠️ On-demand media stream failed for ${waMessageId}: ${streamErr?.message}`);
          return res.status(404).json({ error: 'Media no longer available from WhatsApp' });
        }
      }

      // Legacy: try to serve from local file system (for any previously saved files)
      const filePath = resolveMessageMediaPath(safeFilename);
      if (!filePath) return res.status(404).json({ error: 'Media not found' });

      let responsePath = filePath;
      let responseMime = mediaRow?.media_mime || detectMimeTypeFromFilename(filePath);

      if (req.query.format === 'mp3' && String(responseMime).startsWith('audio/')) {
        responsePath = getBrowserPlayableAudioPath(filePath);
        if (responsePath !== filePath) responseMime = 'audio/mpeg';
      }

      res.set('Content-Type', responseMime);
      res.set('Accept-Ranges', 'bytes');

      if (req.query.download === '1') {
        const fallbackName = responseMime === 'audio/mpeg'
          ? toMp3DownloadName(mediaRow?.media_name || safeFilename)
          : safeFilename;
        const downloadName = sanitizeDownloadName(mediaRow?.media_name || fallbackName, fallbackName);
        res.set('Content-Disposition', `attachment; filename="${downloadName}"`);
      }

      res.sendFile(responsePath);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Delete message ─────────────────────────────────────
  router.delete('/messages/:messageId', async (req, res) => {
    try {
      const mode = req.query.mode || 'me';
      let result;
      if (mode === 'everyone') {
        result = await deleteMessageForEveryone(req.userId, db, req.params.messageId);
      } else {
        result = await deleteMessageForMe(req.userId, db, req.params.messageId);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Delete conversation ────────────────────────────────
  router.delete('/conversations/:contactId', async (req, res) => {
    try {
      const result = await deleteConversation(req.userId, db, req.params.contactId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  // ── Statuses (Stories) ──────────────────────────────────
  router.get('/statuses', (req, res) => {
    try {
      const statuses = getStatuses(db, req.userId);
      res.json(statuses);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reply to a status (quotes the original status like WhatsApp does)
  router.post('/statuses/reply', async (req, res) => {
    try {
      const { senderJid, statusId, message } = req.body;
      if (!senderJid || !message) return res.status(400).json({ error: 'Missing senderJid or message' });

      const wa = getWA(req);
      const client = wa.getSocket();
      if (!client) return res.status(503).json({ error: 'WhatsApp not connected' });

      let sendResult = null;

      // Try to quote the original status message using whatsapp-web.js
      if (statusId) {
        try {
          // First try direct getMessageById
          let statusMsg = null;
          try {
            statusMsg = await client.getMessageById(statusId);
          } catch {}

          // If not found, try searching in status@broadcast chat
          if (!statusMsg) {
            try {
              const statusChat = await client.getChatById('status@broadcast');
              const msgs = await statusChat.fetchMessages({ limit: 50 });
              statusMsg = msgs.find(m => {
                const sid = m.id?._serialized || m.id?.id;
                return sid === statusId;
              });
            } catch (err2) {
              console.log('Could not fetch status chat messages:', err2?.message);
            }
          }

          if (statusMsg) {
            // Use reply() which quotes the original status and sends to the author's chat
            sendResult = await statusMsg.reply(message);
          } else {
            // If we can't find the status, send as a quoted-context message
            // to the sender's chat with context indicating it's a status reply
            const targetChatId = senderJid.replace(/@s\.whatsapp\.net$/, '@c.us');
            try {
              const chat = await client.getChatById(targetChatId);
              sendResult = await chat.sendMessage(message, { quotedMessageId: statusId });
            } catch {
              // Final fallback: send with status reply indicator
              const statusRow = db.prepare('SELECT content, media_type FROM statuses WHERE id = ? AND user_id = ?').get(statusId, req.userId);
              const contextNote = statusRow
                ? `↩️ Replying to status: ${statusRow.media_type !== 'text' ? `[${statusRow.media_type}]` : (statusRow.content || '').slice(0, 50)}\n\n${message}`
                : message;
              sendResult = await client.sendMessage(targetChatId, contextNote);
            }
          }
        } catch (err) {
          console.log('Could not quote status, falling back to DM:', err?.message);
        }
      }

      // Fallback: send as regular DM
      if (!sendResult) {
        sendResult = await wa.sendTextMessage(senderJid, message);
      }

      const msgId = getSentMessageId(sendResult);

      // Save as a regular message so it appears in the chat
      const { contactRow } = resolveOutgoingTarget(req.userId, { jid: senderJid });
      db.prepare(`
        INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status)
        VALUES (?, ?, ?, ?, ?, 'text', 'sent', ?, 'sent')
        ON CONFLICT(id) DO UPDATE SET content = excluded.content
      `).run(msgId, req.userId, contactRow.id, senderJid, message, new Date().toISOString());

      res.json({ success: true, messageId: msgId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Sync archive states from WhatsApp ──────────────────
  router.post('/sync-archives', async (req, res) => {
    try {
      const result = await syncArchiveStates(req.userId, db);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  router.get('/call-logs', (req, res) => {
    try {
      const logs = getCallLogs(db, req.userId);
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/status-media/:filename', (req, res) => {
    try {
      const filePath = path.join(__dirname, '..', 'data', 'status-media', req.params.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webp': 'image/webp' };
      res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.sendFile(filePath);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/clear-session', async (req, res) => {
    try {
      const wa = getWA(req);
      await wa.clearSession();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: List all users ──────────────────────────────
  router.get('/admin/users', (req, res) => {
    try {
      // Only first registered user (by created_at) is admin
      if (!req.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const users = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.created_at, u.is_admin,
          COALESCE(mc.msg_count, 0) as message_count,
          COALESCE(cc.contact_count, 0) as contact_count,
          COALESCE(mem.memory_count, 0) as memory_count,
          COALESCE(dir.directive_count, 0) as directive_count,
          COALESCE(per.persona_count, 0) as persona_count
        FROM users u
        LEFT JOIN (SELECT user_id, COUNT(*) as msg_count FROM messages GROUP BY user_id) mc ON mc.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) as contact_count FROM contacts WHERE is_group = 0 GROUP BY user_id) cc ON cc.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) as memory_count FROM contacts WHERE memory IS NOT NULL AND memory != '' GROUP BY user_id) mem ON mem.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) as directive_count FROM contacts WHERE active_directive IS NOT NULL AND active_directive != '' GROUP BY user_id) dir ON dir.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) as persona_count FROM prompts GROUP BY user_id) per ON per.user_id = u.id
        ORDER BY u.created_at ASC
      `).all();

      res.json(users.map(u => {
        const limit = getVoiceDailyLimit(db, u.id);
        const sentToday = getVoiceSentTodayCount(db, u.id);
        return {
          ...u,
          is_admin: !!u.is_admin,
          isAdmin: !!u.is_admin,
          is_current: u.id === req.userId,
          voice_daily_limit: limit,            // null = unlimited, 0 = disabled, n>0 = cap
          voice_sent_today: sentToday,
        };
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Delete a user ───────────────────────────────
  router.delete('/admin/users/:userId', async (req, res) => {
    try {
      if (!req.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const targetId = req.params.userId;
      if (targetId === req.userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
      if (!target) return res.status(404).json({ error: 'User not found' });

      // Try to disconnect their WhatsApp session
      try {
        const { getOrInitWhatsApp } = await import('./whatsapp.js');
        const wa = getOrInitWhatsApp(targetId, db);
        await wa.clearSession();
      } catch {}

      // Delete all user data in a transaction for atomicity
      const deleteUser = db.transaction(() => {
        db.prepare('DELETE FROM custom_sounds WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM prompts WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM messages WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM contacts WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM stats WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM config WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM call_logs WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM statuses WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
      });
      deleteUser();

      // Clean up auth directories
      const path = await import('path');
      const fs = await import('fs');
      const { fileURLToPath } = await import('url');
      const dataDir = path.default.join(path.default.dirname(fileURLToPath(import.meta.url)), '..', 'data');

      const authDir = path.default.join(dataDir, 'auth', targetId);
      if (fs.default.existsSync(authDir)) {
        fs.default.rmSync(authDir, { recursive: true, force: true });
      }
      const wwDir = path.default.join(dataDir, 'wwebjs_auth', `session-${targetId}`);
      if (fs.default.existsSync(wwDir)) {
        fs.default.rmSync(wwDir, { recursive: true, force: true });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Grant or revoke admin rights ──────────────
  router.put('/admin/users/:userId/admin', (req, res) => {
    try {
      if (!req.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { isAdmin } = req.body;
      const targetId = req.params.userId;
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
      if (!target) return res.status(404).json({ error: 'User not found' });

      // Prevent removing your own admin (avoid lockout)
      if (targetId === req.userId && isAdmin === false) {
        return res.status(400).json({ error: "Can't remove admin from your own account" });
      }
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, targetId);
      res.json({ success: true, isAdmin: !!isAdmin });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Set per-user daily voice-note limit ─────────
  // Body: { limit: number | null }
  //   null  → unlimited
  //   0     → disable voice notes entirely for this user
  //   n > 0 → cap that many voice notes per day
  router.put('/admin/users/:userId/voice-limit', (req, res) => {
    try {
      if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
      const targetId = req.params.userId;
      const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
      if (!target) return res.status(404).json({ error: 'User not found' });

      const { limit } = req.body || {};
      let stored;
      if (limit === null || limit === undefined || limit === '' || limit === -1) {
        stored = '-1'; // unlimited
      } else {
        const n = parseInt(limit, 10);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Limit must be a non-negative integer, or null for unlimited' });
        stored = String(Math.min(n, 1000));
      }
      setConfig(db, targetId, 'voice_daily_limit', stored);
      const effective = stored === '-1' ? null : parseInt(stored, 10);
      res.json({ success: true, voice_daily_limit: effective, voice_sent_today: getVoiceSentTodayCount(db, targetId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Debug logs ─────────────────────────────────
  router.get('/admin/debug-logs', (req, res) => {
    try {
      if (!req.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const limit = Math.min(parseInt(req.query.limit) || 200, 500);
      const targetUserId = req.query.userId || null;

      let query = `SELECT id, user_id, data, created_at FROM stats WHERE event = 'debug_log'`;
      const params = [];
      if (targetUserId) {
        query += ` AND user_id = ?`;
        params.push(targetUserId);
      }
      query += ` ORDER BY id DESC LIMIT ?`;
      params.push(limit);

      const rows = db.prepare(query).all(...params);
      res.json(rows.map(r => {
        let parsed = {};
        try { parsed = JSON.parse(r.data || '{}'); } catch {}
        return { id: r.id, userId: r.user_id, ...parsed, created_at: r.created_at };
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Prompt Library CRUD ──────────────────────────────
  router.get('/prompts', (req, res) => {
    try {
      const prompts = db.prepare('SELECT * FROM prompts WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
      res.json(prompts);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/prompts', (req, res) => {
    try {
      const { name, content } = req.body;
      if (!name || !content) return res.status(400).json({ error: 'Name and content required' });
      const id = uuid();
      db.prepare('INSERT INTO prompts (id, user_id, name, content) VALUES (?, ?, ?, ?)').run(id, req.userId, name, content);
      res.json({ id, name, content, user_id: req.userId, created_at: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.put('/prompts/:id', (req, res) => {
    try {
      const { name, content } = req.body;
      if (!name || !content) return res.status(400).json({ error: 'Name and content required' });
      const result = db.prepare('UPDATE prompts SET name = ?, content = ? WHERE id = ? AND user_id = ?').run(name, content, req.params.id, req.userId);
      if (result.changes === 0) return res.status(404).json({ error: 'Prompt not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/prompts/:id', (req, res) => {
    try {
      // Unset prompt_id on contacts using this prompt
      db.prepare('UPDATE contacts SET prompt_id = NULL WHERE prompt_id = ? AND user_id = ?').run(req.params.id, req.userId);
      const result = db.prepare('DELETE FROM prompts WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
      if (result.changes === 0) return res.status(404).json({ error: 'Prompt not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Assign prompt to a contact
  router.put('/contacts/:id/prompt', (req, res) => {
    try {
      const { promptId } = req.body;
      db.prepare('UPDATE contacts SET prompt_id = ? WHERE id = ? AND user_id = ?').run(promptId || null, req.params.id, req.userId);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Get contact's assigned prompt
  router.get('/contacts/:id/prompt', (req, res) => {
    try {
      const row = db.prepare('SELECT prompt_id FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
      res.json({ promptId: row?.prompt_id || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Admin: Clear debug logs ───────────────────────────
  router.delete('/admin/debug-logs', (req, res) => {
    try {
      if (!req.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      // Scope deletion to a specific account when userId is provided.
      // Without it, refuse to wipe logs across ALL accounts (dangerous default).
      const targetUserId = req.query.userId || null;
      if (!targetUserId) {
        return res.status(400).json({
          error: 'userId query param required. To clear logs for a specific account pass ?userId=<id>. To clear ALL accounts pass ?userId=all explicitly.'
        });
      }
      let result;
      if (targetUserId === 'all') {
        result = db.prepare(`DELETE FROM stats WHERE event = 'debug_log'`).run();
      } else {
        result = db.prepare(`DELETE FROM stats WHERE event = 'debug_log' AND user_id = ?`).run(targetUserId);
      }
      res.json({ success: true, deleted: result.changes, scope: targetUserId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Per-user: Get own debug logs (no admin required) ──
  router.get('/my/debug-logs', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 200, 500);
      const rows = db.prepare(
        `SELECT id, user_id, data, created_at FROM stats
         WHERE event = 'debug_log' AND user_id = ?
         ORDER BY id DESC LIMIT ?`
      ).all(req.userId, limit);
      res.json(rows.map(r => {
        let parsed = {};
        try { parsed = JSON.parse(r.data || '{}'); } catch {}
        return { id: r.id, userId: r.user_id, ...parsed, created_at: r.created_at };
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Per-user: Clear own debug logs ────────────────────
  router.delete('/my/debug-logs', (req, res) => {
    try {
      db.prepare(`DELETE FROM stats WHERE event = 'debug_log' AND user_id = ?`).run(req.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Telegram Bot Test ────────────────────────────────
  router.post('/telegram/test', async (req, res) => {
    try {
      const token = getConfig(db, req.userId, 'telegram_bot_token');
      const chatId = getConfig(db, req.userId, 'telegram_chat_id');
      if (!token || !chatId) return res.status(400).json({ error: 'Telegram bot token and chat ID required' });
      const success = await sendTestMessage(token, chatId);
      if (!success) return res.status(400).json({ error: 'Failed to send test message — check your token and chat ID' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Auto-initiate toggle ────────────────────────────
  router.put('/contacts/:id/auto-initiate', (req, res) => {
    try {
      const { enabled } = req.body;
      db.prepare('UPDATE contacts SET auto_initiate = ? WHERE id = ? AND user_id = ?').run(enabled ? 1 : 0, req.params.id, req.userId);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/contacts/:id/auto-initiate', (req, res) => {
    try {
      const row = db.prepare('SELECT auto_initiate FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
      res.json({ autoInitiate: row?.auto_initiate === 1 });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── AI Voice Notes: global defaults ─────────────────
  router.get('/voice-settings', (req, res) => {
    try {
      res.json({
        enabled: getConfig(db, req.userId, 'ai_voice_enabled') === '1',
        chance: parseInt(getConfig(db, req.userId, 'ai_voice_chance') || '20', 10),
        maxPerDay: parseInt(getConfig(db, req.userId, 'ai_voice_max_per_day') || '3', 10),
        bgVolume: parseFloat(getConfig(db, req.userId, 'ai_voice_bg_volume') || '0.15'),
        defaultBgSound: getConfig(db, req.userId, 'ai_voice_default_bg_sound') || 'none',
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.put('/voice-settings', (req, res) => {
    try {
      const { enabled, chance, maxPerDay, bgVolume, defaultBgSound } = req.body || {};
      if (typeof enabled === 'boolean') setConfig(db, req.userId, 'ai_voice_enabled', enabled ? '1' : '0');
      if (Number.isFinite(chance)) setConfig(db, req.userId, 'ai_voice_chance', String(Math.max(0, Math.min(100, chance))));
      if (Number.isFinite(maxPerDay)) setConfig(db, req.userId, 'ai_voice_max_per_day', String(Math.max(0, Math.min(50, maxPerDay))));
      if (Number.isFinite(bgVolume)) setConfig(db, req.userId, 'ai_voice_bg_volume', String(Math.max(0, Math.min(1, bgVolume))));
      if (typeof defaultBgSound === 'string') setConfig(db, req.userId, 'ai_voice_default_bg_sound', defaultBgSound || 'none');
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Per-contact voice overrides ─────────────────────
  router.get('/contacts/:id/voice', (req, res) => {
    try {
      const row = db.prepare('SELECT voice_enabled, voice_max_per_day, voice_bg_sound FROM contacts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
      if (!row) return res.status(404).json({ error: 'Contact not found' });
      // Today's usage count
      const sentToday = db.prepare(
        `SELECT COUNT(*) as c FROM voice_note_log WHERE user_id = ? AND contact_id = ? AND date(sent_at) = date('now')`
      ).get(req.userId, req.params.id)?.c || 0;
      res.json({
        enabled: row.voice_enabled === 1,
        maxPerDay: row.voice_max_per_day, // null = use global default
        bgSound: row.voice_bg_sound || 'none',
        sentToday,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.put('/contacts/:id/voice', (req, res) => {
    try {
      const { enabled, maxPerDay, bgSound } = req.body || {};
      const fields = [];
      const vals = [];
      if (typeof enabled === 'boolean') { fields.push('voice_enabled = ?'); vals.push(enabled ? 1 : 0); }
      if (maxPerDay === null || Number.isFinite(maxPerDay)) {
        fields.push('voice_max_per_day = ?');
        vals.push(maxPerDay === null ? null : Math.max(0, Math.min(50, maxPerDay)));
      }
      if (typeof bgSound === 'string' || bgSound === null) { fields.push('voice_bg_sound = ?'); vals.push(bgSound || null); }
      if (!fields.length) return res.json({ success: true });
      vals.push(req.params.id, req.userId);
      db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Per-persona voice assignment ────────────────────
  router.put('/prompts/:id/voice', (req, res) => {
    try {
      const { voiceId, modelId } = req.body || {};
      const result = db.prepare('UPDATE prompts SET voice_id = ?, model_id = ? WHERE id = ? AND user_id = ?')
        .run(voiceId || null, modelId || null, req.params.id, req.userId);
      if (result.changes === 0) return res.status(404).json({ error: 'Prompt not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
}

function getConfig(db, userId, key) {
  const row = db.prepare('SELECT value FROM config WHERE user_id = ? AND key = ?').get(userId, key);
  return row?.value || null;
}

function setConfig(db, userId, key, value) {
  db.prepare('INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)').run(userId, key, value);
}

function getStats(db, userId) {
  const messagesSent = db.prepare(`SELECT COUNT(*) as count FROM stats WHERE user_id = ? AND event = 'message_sent'`).get(userId).count;
  const voiceSent = db.prepare(`SELECT COUNT(*) as count FROM stats WHERE user_id = ? AND event = 'voice_sent'`).get(userId).count;
  const messagesReceived = db.prepare(`SELECT COUNT(*) as count FROM stats WHERE user_id = ? AND event = 'message_received'`).get(userId).count;
  const activeContacts = db.prepare('SELECT COUNT(*) as count FROM contacts WHERE user_id = ? AND is_group = 0').get(userId).count;
  return { messagesSent, voiceSent, messagesReceived, activeContacts };
}
