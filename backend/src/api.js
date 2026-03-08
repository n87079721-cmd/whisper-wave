import express from 'express';
import { v4 as uuid } from 'uuid';
import { getWhatsAppState, onWhatsAppEvent } from './whatsapp.js';
import { generateVoiceNote, generatePreviewAudio, VOICES } from './elevenlabs.js';
import QRCode from 'qrcode';

export function createApiRouter(db, wa) {
  const router = express.Router();

  // ── Status & QR ──────────────────────────────────────────
  router.get('/status', (req, res) => {
    const state = wa.getState();
    const stats = getStats(db);
    res.json({ ...state, stats });
  });

  router.get('/qr', async (req, res) => {
    const state = wa.getState();
    if (!state.qr) {
      return res.json({ qr: null, status: state.status });
    }
    const qrDataUrl = await QRCode.toDataURL(state.qr, { width: 256, margin: 1 });
    res.json({ qr: qrDataUrl, status: state.status });
  });

  // SSE for real-time updates
  router.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const state = wa.getState();
    send('status', { status: state.status });

    const unsub = onWhatsAppEvent((event, data) => {
      if (event === 'qr') {
        QRCode.toDataURL(data, { width: 256, margin: 1 }).then(qrUrl => {
          send('qr', { qr: qrUrl });
        });
      } else if (event === 'connected') {
        send('status', { status: 'connected' });
      } else if (event === 'message') {
        send('message', data);
      } else if (event === 'status') {
        send('status', data);
      }
    });

    req.on('close', unsub);
  });

  // ── Voices ────────────────────────────────────────────────
  router.get('/voices', (req, res) => {
    res.json(VOICES);
  });

  // ── Contacts ──────────────────────────────────────────────
  router.get('/contacts', (req, res) => {
    const contacts = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM messages m WHERE m.contact_id = c.id) as message_count
      FROM contacts c 
      WHERE c.is_group = 0
      ORDER BY c.updated_at DESC
    `).all();
    res.json(contacts);
  });

  // ── Messages / Conversations ─────────────────────────────
  router.get('/messages/:contactId', (req, res) => {
    const messages = db.prepare(`
      SELECT * FROM messages WHERE contact_id = ? ORDER BY timestamp ASC
    `).all(req.params.contactId);
    res.json(messages);
  });

  router.get('/conversations', (req, res) => {
    const conversations = db.prepare(`
      SELECT c.*, m.content as last_message, m.type as last_type, m.timestamp as last_timestamp
      FROM contacts c
      INNER JOIN messages m ON m.id = (
        SELECT id FROM messages WHERE contact_id = c.id ORDER BY timestamp DESC LIMIT 1
      )
      WHERE c.is_group = 0
      ORDER BY m.timestamp DESC
    `).all();
    res.json(conversations);
  });

  // ── Send Text ─────────────────────────────────────────────
  router.post('/send/text', async (req, res) => {
    try {
      const { contactId, jid, message } = req.body;
      if (!message || (!contactId && !jid)) {
        return res.status(400).json({ error: 'Missing contactId/jid or message' });
      }

      let targetJid = jid;
      if (contactId && !jid) {
        const contact = db.prepare('SELECT jid FROM contacts WHERE id = ?').get(contactId);
        if (!contact) return res.status(404).json({ error: 'Contact not found' });
        targetJid = contact.jid;
      }

      const sent = await wa.sendTextMessage(targetJid, message);

      const msgId = uuid();
      const contactRow = db.prepare('SELECT id FROM contacts WHERE jid = ?').get(targetJid);
      if (contactRow) {
        db.prepare(`
          INSERT INTO messages (id, contact_id, jid, content, type, direction, timestamp, status)
          VALUES (?, ?, ?, ?, 'text', 'sent', ?, 'sent')
        `).run(msgId, contactRow.id, targetJid, message, new Date().toISOString());
        
        db.prepare(`INSERT INTO stats (event) VALUES ('message_sent')`).run();
      }

      res.json({ success: true, messageId: msgId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send Voice Note (PTT, no caption) ─────────────────────
  router.post('/send/voice', async (req, res) => {
    try {
      const { contactId, text, voiceId, modelId } = req.body;
      if (!contactId || !text) {
        return res.status(400).json({ error: 'Missing contactId or text' });
      }

      const apiKey = getConfig(db, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'ElevenLabs API key not configured. Set it in Settings.' });
      }

      const contact = db.prepare('SELECT jid FROM contacts WHERE id = ?').get(contactId);
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      // Generate TTS and convert to OGG/Opus
      const audioBuffer = await generateVoiceNote(
        apiKey, text,
        voiceId || 'JBFqnCBsd6RMkjVDRZzb',
        modelId || null
      );

      // Send as PTT voice note — no caption, just audio with waveform
      await wa.sendVoiceNote(contact.jid, audioBuffer);

      const msgId = uuid();
      db.prepare(`
        INSERT INTO messages (id, contact_id, jid, content, type, direction, timestamp, status)
        VALUES (?, ?, ?, ?, 'voice', 'sent', ?, 'sent')
      `).run(msgId, contactId, contact.jid, text, new Date().toISOString());
      
      db.prepare(`INSERT INTO stats (event) VALUES ('voice_sent')`).run();

      res.json({ success: true, messageId: msgId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Preview voice (MP3 for browser playback) ──────────────
  router.post('/voice/preview', async (req, res) => {
    try {
      const { text, voiceId, modelId } = req.body;
      if (!text) return res.status(400).json({ error: 'Missing text' });

      const apiKey = getConfig(db, 'elevenlabs_api_key') || process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'ElevenLabs API key not configured' });
      }

      const audioBuffer = await generatePreviewAudio(
        apiKey, text,
        voiceId || 'JBFqnCBsd6RMkjVDRZzb',
        modelId || null
      );
      res.set('Content-Type', 'audio/mpeg');
      res.send(audioBuffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Settings ──────────────────────────────────────────────
  router.get('/config/:key', (req, res) => {
    const val = getConfig(db, req.params.key);
    if (req.params.key.includes('api_key') && val) {
      res.json({ value: val.slice(0, 6) + '...' + val.slice(-4), exists: true });
    } else {
      res.json({ value: val, exists: !!val });
    }
  });

  router.post('/config', (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    setConfig(db, key, value);
    res.json({ success: true });
  });

  router.post('/reconnect', async (req, res) => {
    try {
      await wa.reconnect();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/clear-session', async (req, res) => {
    try {
      await wa.clearSession();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function getConfig(db, key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row?.value || null;
}

function setConfig(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

function getStats(db) {
  const messagesSent = db.prepare(`SELECT COUNT(*) as count FROM stats WHERE event = 'message_sent'`).get().count;
  const voiceSent = db.prepare(`SELECT COUNT(*) as count FROM stats WHERE event = 'voice_sent'`).get().count;
  const messagesReceived = db.prepare(`SELECT COUNT(*) as count FROM stats WHERE event = 'message_received'`).get().count;
  const activeContacts = db.prepare('SELECT COUNT(*) as count FROM contacts WHERE is_group = 0').get().count;
  return { messagesSent, voiceSent, messagesReceived, activeContacts };
}
