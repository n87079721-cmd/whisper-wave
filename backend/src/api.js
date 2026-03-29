import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { getWhatsAppState, onWhatsAppEvent, getOrInitWhatsApp, requestPairingWithPhone, getStatuses, getCallLogs, recoverSingleChat, getSyncDiagnostics, deleteMessage, deleteMessageForMe, deleteMessageForEveryone, deleteConversation } from './whatsapp.js';
import { initWhatsApp } from './whatsapp.js';
import { archiveChat, markChatRead, syncArchiveStates } from './whatsapp.js';
import { generateVoiceNote, generatePreviewAudio } from './elevenlabs.js';
import { authMiddleware, registerUser, loginUser, createToken } from './auth.js';
import QRCode from 'qrcode';

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
      res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName } });
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
      // Don't auto-start WhatsApp on login — user clicks Connect on dashboard
      res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName } });
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  });

  router.get('/auth/me', auth, (req, res) => {
    res.json({ user: req.user });
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

  function persistOutgoingVoiceNote(messageId, audioBuffer) {
    const mediaDir = path.join(__dirname, '..', 'data', 'message-media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

    const filename = `${messageId}.ogg`;
    const filePath = path.join(mediaDir, filename);
    fs.writeFileSync(filePath, audioBuffer);

    return {
      mediaPath: filename,
      mediaName: 'voice-note.ogg',
      mediaMime: 'audio/ogg; codecs=opus',
    };
  }

  function getSentMessageId(sendResult) {
    return sendResult?.id?._serialized || sendResult?.id?.id || sendResult?.key?.id || uuid();
  }

  function detectOutgoingMessageType(mimeType, forceDocument = false) {
    if (forceDocument) return 'document';
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.startsWith('image/')) return 'image';
    if (normalized.startsWith('video/')) return 'video';
    return 'document';
  }

  function persistOutgoingMedia(messageId, base64Data, mimeType, fileName) {
    const mediaDir = path.join(__dirname, '..', 'data', 'message-media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

    const extension = getMediaExtension(mimeType, fileName);
    const filename = `${messageId}.${extension}`;
    const filePath = path.join(mediaDir, filename);
    const normalizedBase64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(normalizedBase64, 'base64'));

    return {
      mediaPath: filename,
      mediaName: sanitizeDownloadName(fileName, `attachment.${extension}`),
      mediaMime: mimeType || detectMimeTypeFromFilename(fileName),
    };
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
      db.prepare("UPDATE contacts SET name = COALESCE(?, name), phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ?")
        .run(betterName, canonicalPhone, canonical.id);
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
    const contacts = db.prepare(`
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
    `).all(req.userId, req.userId);
    res.json(contacts);
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

  // ── Get Starred Messages ──────────────────────────────────
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
      const { contactId, jid, message } = req.body;
      if (!message || (!contactId && !jid)) return res.status(400).json({ error: 'Missing contactId/jid or message' });

      const wa = getWA(req);
      const { contactRow, targetJid } = resolveOutgoingTarget(req.userId, { contactId, jid });

      const sendResult = await wa.sendTextMessage(targetJid, message);
      const msgId = getSentMessageId(sendResult);

      db.prepare(`
        INSERT INTO messages (id, user_id, contact_id, jid, content, type, direction, timestamp, status)
        VALUES (?, ?, ?, ?, ?, 'text', 'sent', ?, 'sent')
        ON CONFLICT(id) DO UPDATE SET
          contact_id = excluded.contact_id,
          jid = excluded.jid,
          content = excluded.content,
          direction = excluded.direction,
          timestamp = excluded.timestamp,
          status = excluded.status
      `).run(msgId, req.userId, contactRow.id, targetJid, message, new Date().toISOString());
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
      res.json({ success: true, messageId: msgId, contactId: contactRow.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send Voice Note ─────────────────────────────────────
  router.post('/send/voice', async (req, res) => {
    try {
      const { contactId, text, voiceId, modelId, backgroundSound } = req.body;
      if (!contactId || !text) return res.status(400).json({ error: 'Missing contactId or text' });

      const apiKey = getConfig(db, req.userId, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API key not configured.' });

      const contact = db.prepare('SELECT jid FROM contacts WHERE id = ? AND user_id = ?').get(contactId, req.userId);
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      const wa = getWA(req);
      const audioBuffer = await generateVoiceNote(apiKey, text, voiceId || 'JBFqnCBsd6RMkjVDRZzb', modelId || null, backgroundSound || null);

      // Send voice note — captures message key or throws on complete failure
      const sendResult = await wa.sendVoiceNote(contact.jid, audioBuffer);
      const msgId = getSentMessageId(sendResult);
      const savedVoice = persistOutgoingVoiceNote(msgId, audioBuffer);

      // Only insert to DB after confirmed send
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
      `).run(msgId, req.userId, contactId, contact.jid, text, new Date().toISOString(), savedVoice.mediaPath, savedVoice.mediaName, savedVoice.mediaMime);
      db.prepare(`INSERT INTO stats (user_id, event) VALUES (?, 'voice_sent')`).run(req.userId);

      res.json({ success: true, messageId: msgId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Preview voice ──────────────────────────────────────
  router.post('/voice/preview', async (req, res) => {
    try {
      const { text, voiceId, modelId, backgroundSound } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing text' });

      const apiKey = getConfig(db, req.userId, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API key not configured' });

      const audioBuffer = await generatePreviewAudio(apiKey, text, voiceId || 'JBFqnCBsd6RMkjVDRZzb', modelId || null, backgroundSound || null);
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

      const cleanedInput = String(text)
        .replace(/\[[^\]\n]{1,40}\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || String(text).trim();

      const systemPrompt = `You rewrite text for ElevenLabs v3 Human Mode so it sounds like a real person speaking in a WhatsApp voice note.

AVAILABLE EXPRESSION TAGS (use the ones that fit the emotion/context):
Emotions: [happy] [sad] [angry] [excited] [nervous] [scared] [disgusted] [surprised] [confused] [bored] [proud] [shy] [jealous] [grateful] [hopeful] [disappointed] [embarrassed] [anxious] [frustrated] [amused]
Reactions: [laughing] [crying] [gasping] [sighing] [groaning] [screaming] [giggling] [chuckling] [sniffling] [yawning]
Delivery: [whispering] [shouting] [singing] [mumbling] [sarcastically] [dramatically] [deadpan] [breathlessly] [cheerfully] [sadly] [angrily] [nervously] [excitedly] [lovingly] [coldly] [mockingly]
Physical: [clearing throat] [coughing] [sneezing] [hiccupping] [clicking tongue] [tutting] [blowing raspberry] [kissing teeth] [inhaling sharply] [exhaling deeply] [clapping]
Pacing cues: [pause] [hesitates] [breathes] [slows down] [drawn out] [continues after a beat] ... —

RULES:
- Output ONE rewritten version only
- Make it sound spoken, not written
- Use 2-4 total cues, and at least 1 of them must shape pacing naturally
- Use the RIGHT cue in the RIGHT spot; never spam tags or stack them everywhere
- If the input already had tags, rewrite from the meaning and create a fresh new version instead of keeping the same tags
- Break long sentences into shorter spoken chunks when needed
- Use contractions (I'm, don't, can't, won't, it's)
- Add natural pauses with tags or punctuation where helpful, but keep it believable
- Add filler words only when they genuinely help the delivery
- Keep the same meaning but make it feel conversational and human-paced
- Match tags to context: happy news → [excited] [happy], bad news → [sighing] [sadly], funny → [laughing] [chuckling], serious → [clearing throat] [inhaling sharply]
- Return ONLY the enhanced text. No quotes, no explanation, no preamble.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Rewrite this for a natural WhatsApp voice note:\n\n${cleanedInput}` }
          ],
          temperature: 1.15,
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const details = await response.text();
        return res.status(response.status).json({ error: `OpenAI request failed: ${details}` });
      }

      const data = await response.json();
      const enhanced = data.choices?.[0]?.message?.content?.trim();
      if (!enhanced) return res.status(500).json({ error: 'No response from OpenAI' });

      res.json({ enhanced });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Enhancement failed' });
    }
  });

  // ── Settings ──────────────────────────────────────────────
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
    res.json({ success: true });
  });

  router.post('/reconnect', async (req, res) => {
    try {
      // Force-start a fresh connection
      initWhatsApp(req.userId, db);
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

  router.get('/message-media/:filename', (req, res) => {
    try {
      const safeFilename = path.basename(req.params.filename);
      const filePath = resolveMessageMediaPath(safeFilename);
      if (!filePath) return res.status(404).json({ error: 'Media not found' });

      const mediaRow = db.prepare(`
        SELECT media_mime, media_name, type
        FROM messages
        WHERE user_id = ? AND media_path = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(req.userId, safeFilename);

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
      let sendResult;

      // Try to quote the original status message
      if (statusId) {
        try {
          const statusMsg = await wa.getMessageById(statusId);
          if (statusMsg) {
            // reply() quotes the original status and sends to the status author's chat
            sendResult = await statusMsg.reply(message);
          }
        } catch (err) {
          console.log('Could not quote status, falling back to DM:', err?.message);
        }
      }

      // Fallback: send as quoted-context DM
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
