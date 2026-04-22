/**
 * Telegram Bot module — Reply Preview, Sensitive Topic Alerts
 * Uses polling (getUpdates) to receive callback queries and text responses.
 * No external Telegram library — raw HTTP via fetch.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Per-user bot state
const botInstances = new Map();
// userId -> {
//   polling, offset,
//   awaitingCustom: Map<jid, true>,
//   lastReplies: Map<jid, string>,             // back-compat: latest preview text per jid (used by /custom edit)
//   previews: Map<token, { jid, text, messages: [{chat_id, message_id}] }>,  // token-keyed previews
//   activeTokenByJid: Map<jid, token>,        // newest token for a jid (so we can disable older ones)
//   vnInFlight: Set<token>,                    // tokens currently being processed
// }

function makeToken() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function parseChatIds(raw) {
  if (!raw) return [];
  // Accept comma, newline, semicolon, or whitespace separators. Dedupe & trim.
  return [...new Set(
    String(raw)
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
  )];
}

function getBotConfig(db, userId) {
  const tokenRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'telegram_bot_token'").get(userId);
  const chatIdRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'telegram_chat_id'").get(userId);
  const chatIds = parseChatIds(chatIdRow?.value);
  return {
    token: tokenRow?.value || null,
    chatIds,
    // Back-compat: first chat id (used as the canonical reply destination for callbacks)
    chatId: chatIds[0] || null,
  };
}

function getBotState(userId) {
  if (!botInstances.has(userId)) {
    botInstances.set(userId, {
      polling: false, offset: 0,
      awaitingCustom: new Map(),
      lastReplies: new Map(),
      previews: new Map(),
      activeTokenByJid: new Map(),
      vnInFlight: new Set(),
    });
  }
  const inst = botInstances.get(userId);
  if (!inst.lastReplies) inst.lastReplies = new Map();
  if (!inst.awaitingCustom) inst.awaitingCustom = new Map();
  if (!inst.previews) inst.previews = new Map();
  if (!inst.activeTokenByJid) inst.activeTokenByJid = new Map();
  if (!inst.vnInFlight) inst.vnInFlight = new Set();
  return inst;
}

/**
 * Look up the most recently previewed AI reply for a jid (used by custom mode
 * so the AI can EDIT the previous draft rather than write a fresh one).
 */
export function getLastPreviewedReply(userId, jid) {
  const state = botInstances.get(userId);
  if (!state?.lastReplies) return null;
  return state.lastReplies.get(jid) || null;
}

/**
 * Token-based claim. Each Telegram preview message carries its own short token,
 * so re-tapping an OLD preview's button (after a newer reply was generated) will
 * NOT pick up the newer text — it will fail cleanly with "expired".
 * Returns { text, jid, release(commit) } or { busy: true } / { text: null }.
 */
export function claimPreviewByToken(userId, token) {
  const state = botInstances.get(userId);
  if (!state?.previews) return { text: null };
  const entry = state.previews.get(token);
  if (!entry) return { text: null };
  if (state.vnInFlight.has(token)) return { busy: true };
  state.vnInFlight.add(token);
  return {
    text: entry.text,
    jid: entry.jid,
    messages: entry.messages,
    release: (commit) => {
      const s = botInstances.get(userId);
      if (!s) return;
      s.vnInFlight.delete(token);
      if (commit) {
        s.previews.delete(token);
        // Only clear activeTokenByJid if this WAS the active one
        if (s.activeTokenByJid.get(entry.jid) === token) {
          s.activeTokenByJid.delete(entry.jid);
        }
      }
    },
  };
}

/** Look up just the jid for a token (used by Cancel/Rewrite/Custom callbacks). */
export function resolveJidFromToken(userId, token) {
  const state = botInstances.get(userId);
  if (!state?.previews) return null;
  return state.previews.get(token)?.jid || null;
}

/**
 * Disable an old preview's inline keyboard in Telegram so it can no longer be
 * tapped. Best-effort — silently ignores errors (message too old, deleted, etc.).
 */
async function disablePreviewMessages(token, messages) {
  if (!messages?.length) return;
  await Promise.all(messages.map(async ({ chat_id, message_id }) => {
    try {
      await telegramRequest(token, 'editMessageReplyMarkup', {
        chat_id, message_id, reply_markup: { inline_keyboard: [] },
      });
    } catch {}
  }));
}

async function telegramRequest(token, method, body = {}) {
  const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram API error [${method}]:`, data.description);
  }
  return data;
}

/**
 * Send a reply preview to the user's Telegram with Cancel/Rewrite/Custom buttons.
 */
export async function sendReplyPreview(db, userId, contactName, replyText, jid, { persona } = {}) {
  const { token, chatIds } = getBotConfig(db, userId);
  if (!token || chatIds.length === 0) return;

  const state = getBotState(userId);
  // Remember this draft so /custom can edit/extend it later (back-compat helper)
  state.lastReplies.set(jid, replyText);

  // Disable any prior preview for this jid so its buttons can't fire wrong text.
  const oldToken = state.activeTokenByJid.get(jid);
  if (oldToken) {
    const old = state.previews.get(oldToken);
    state.previews.delete(oldToken);
    if (old?.messages?.length) {
      disablePreviewMessages(token, old.messages).catch(() => {});
    }
  }

  // Mint a fresh token for THIS preview
  const previewToken = makeToken();
  state.activeTokenByJid.set(jid, previewToken);
  state.previews.set(previewToken, { jid, text: replyText, messages: [] });

  // Show which persona produced this reply so the user can verify the right
  // character/prompt is active for this contact.
  const personaLine = persona ? `🎭 _${escapeMarkdown(persona)}_\n` : '';
  const text = `💬 Reply to *${escapeMarkdown(contactName)}*:\n${personaLine}\n${escapeMarkdown(replyText)}`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: '❌ Cancel', callback_data: `cancel_${previewToken}` },
        { text: '🔄 Rewrite', callback_data: `rewrite_${previewToken}` },
        { text: '✏️ Custom', callback_data: `custom_${previewToken}` },
      ],
      [
        { text: '🎤 Send as VN', callback_data: `vn_${previewToken}` },
      ],
    ],
  };

  await Promise.all(chatIds.map(async (cid) => {
    try {
      const res = await telegramRequest(token, 'sendMessage', {
        chat_id: cid,
        text,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      const message_id = res?.result?.message_id;
      if (message_id) {
        const entry = state.previews.get(previewToken);
        if (entry) entry.messages.push({ chat_id: cid, message_id });
      }
    } catch (err) {
      console.error(`[${userId}] Failed to send Telegram preview to ${cid}:`, err?.message);
    }
  }));
}

/**
 * Send a sensitive topic alert to the user's Telegram.
 */
export async function sendSensitiveAlert(db, userId, contactName, topic, messagePreview) {
  const { token, chatIds } = getBotConfig(db, userId);
  if (!token || chatIds.length === 0) return;

  const text = `🚨 *Sensitive Topic Detected*\n\nFrom: *${escapeMarkdown(contactName)}*\nTopic: ${escapeMarkdown(topic)}\n\nMessage: _${escapeMarkdown(messagePreview.slice(0, 200))}_\n\nAI reply has been paused. Please respond manually.`;

  await Promise.all(chatIds.map(async (cid) => {
    try {
      await telegramRequest(token, 'sendMessage', {
        chat_id: cid,
        text,
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error(`[${userId}] Failed to send Telegram sensitive alert to ${cid}:`, err?.message);
    }
  }));
}

/**
 * Forward a transcribed inbound voice note to the user's Telegram chats.
 * Called for every received WhatsApp voice note that we successfully transcribe.
 */
export async function sendVoiceNoteTranscript(db, userId, contactName, transcript) {
  const { token, chatIds } = getBotConfig(db, userId);
  if (!token || chatIds.length === 0) return;
  if (!transcript || !transcript.trim()) return;

  const text = `🎤 *Voice note from ${escapeMarkdown(contactName || 'Unknown')}*\n\n_${escapeMarkdown(transcript.trim())}_`;

  await Promise.all(chatIds.map(async (cid) => {
    try {
      await telegramRequest(token, 'sendMessage', {
        chat_id: cid,
        text,
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error(`[${userId}] Failed to forward VN transcript to ${cid}:`, err?.message);
    }
  }));
}

/**
 * Forward a non-English inbound message to the user's Telegram chats with the
 * original text + an English translation. Silently skipped if the user has
 * not configured a Telegram bot.
 */
export async function sendForeignLanguageAlert(db, userId, contactName, original, language, translation) {
  const { token, chatIds } = getBotConfig(db, userId);
  if (!token || chatIds.length === 0) return;
  if (!original || !translation) return;

  const text =
    `🌍 *New message from ${escapeMarkdown(contactName || 'Unknown')}* _(${escapeMarkdown(language || 'Unknown')})_\n\n` +
    `*Original:*\n_${escapeMarkdown(String(original).trim())}_\n\n` +
    `*English:*\n_${escapeMarkdown(String(translation).trim())}_`;

  await Promise.all(chatIds.map(async (cid) => {
    try {
      await telegramRequest(token, 'sendMessage', {
        chat_id: cid,
        text,
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error(`[${userId}] Failed to send Telegram foreign-language alert to ${cid}:`, err?.message);
    }
  }));
}

/**
 * Send a test message to verify the bot token and chat IDs.
 * Accepts a single chat ID string or a multi-id string (comma/newline separated).
 * Returns true if at least one chat ID accepted the message.
 */
export async function sendTestMessage(token, chatIdOrIds) {
  const ids = parseChatIds(chatIdOrIds);
  if (ids.length === 0) return false;
  const results = await Promise.all(ids.map(cid => telegramRequest(token, 'sendMessage', {
    chat_id: cid,
    text: '✅ Telegram bot connected successfully! You will receive AI reply previews and sensitive topic alerts here.',
  }).catch(() => ({ ok: false }))));
  return results.some(r => r.ok);
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Start polling for Telegram callback queries and messages for a user.
 * Calls the provided handlers when actions are received.
 */
export function startTelegramPolling(db, userId, handlers) {
  const { token, chatIds } = getBotConfig(db, userId);
  if (!token || chatIds.length === 0) return;

  const state = getBotState(userId);
  if (state.polling) return; // Already polling
  state.polling = true;

  console.log(`🤖 [${userId}] Starting Telegram bot polling`);

  const poll = async () => {
    if (!state.polling) return;
    try {
      const data = await telegramRequest(token, 'getUpdates', {
        offset: state.offset,
        timeout: 30,
        allowed_updates: ['callback_query', 'message'],
      });

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          state.offset = update.update_id + 1;

          // Re-read chat IDs each iteration so newly added IDs work without restart.
          const currentChatIds = getBotConfig(db, userId).chatIds.map(String);

          // Determine the chat where this update originated, and only honor
          // updates from authorised chat IDs (security: ignore strangers who
          // somehow find the bot).
          const incomingChatId = String(
            update.callback_query?.message?.chat?.id ??
            update.message?.chat?.id ??
            ''
          );
          if (!incomingChatId || !currentChatIds.includes(incomingChatId)) {
            continue;
          }

          // Handle callback queries (button presses)
          if (update.callback_query) {
            const cbData = update.callback_query.data;
            const [action, ...rest] = cbData.split('_');
            const tokenOrJid = rest.join('_');
            // New format: tokenOrJid is a short token. Old format (back-compat
            // for in-flight previews after deploy): tokenOrJid is the jid itself.
            const resolvedJid = resolveJidFromToken(userId, tokenOrJid) || tokenOrJid;
            const jid = resolvedJid;

            // Acknowledge the callback
            await telegramRequest(token, 'answerCallbackQuery', {
              callback_query_id: update.callback_query.id,
            });

            if (action === 'cancel' && handlers.onCancel) {
              await handlers.onCancel(jid);
              await telegramRequest(token, 'sendMessage', {
                chat_id: incomingChatId,
                text: `✅ Reply cancelled.`,
              });
            } else if (action === 'rewrite' && handlers.onRewrite) {
              await handlers.onRewrite(jid);
              await telegramRequest(token, 'sendMessage', {
                chat_id: incomingChatId,
                text: `🔄 Generating new reply...`,
              });
            } else if (action === 'custom') {
              state.awaitingCustom.set(jid, true);
              // Cancel the current reply while waiting for custom instructions
              if (handlers.onCancel) await handlers.onCancel(jid);
              await telegramRequest(token, 'sendMessage', {
                chat_id: incomingChatId,
                text: `✏️ Tell me how you want to respond:`,
              });
            } else if (action === 'vn' && handlers.onSendVN) {
              // User pressed "Send as VN" — cancel pending text send, then synthesize
              // the previewed reply as a voice note and send it.
              if (handlers.onCancel) await handlers.onCancel(jid);
              await telegramRequest(token, 'sendMessage', {
                chat_id: incomingChatId,
                text: `🎤 Generating voice note...`,
              });
              try {
                const result = await handlers.onSendVN(jid, tokenOrJid);
                if (result && result.ok) {
                  // Strip the inline keyboard from the original preview so it
                  // cannot be re-tapped (prevents accidental duplicate sends).
                  const msgChatId = update.callback_query.message?.chat?.id;
                  const msgId = update.callback_query.message?.message_id;
                  if (msgChatId && msgId) {
                    telegramRequest(token, 'editMessageReplyMarkup', {
                      chat_id: msgChatId, message_id: msgId,
                      reply_markup: { inline_keyboard: [] },
                    }).catch(() => {});
                  }
                  await telegramRequest(token, 'sendMessage', {
                    chat_id: incomingChatId,
                    text: `✅ Voice note sent.`,
                  });
                } else {
                  await telegramRequest(token, 'sendMessage', {
                    chat_id: incomingChatId,
                    text: `⚠️ Could not send VN: ${result?.reason || 'unknown error'}`,
                  });
                }
              } catch (err) {
                await telegramRequest(token, 'sendMessage', {
                  chat_id: incomingChatId,
                  text: `⚠️ VN failed: ${err?.message || 'error'}`,
                });
              }
            }
          }

          // Handle text messages (custom reply instructions)
          if (update.message?.text && !update.message.text.startsWith('/')) {
            // Check if we're awaiting custom instructions for any jid
            const awaitingEntries = [...state.awaitingCustom.entries()];
            if (awaitingEntries.length > 0 && handlers.onCustom) {
              const [jid] = awaitingEntries[awaitingEntries.length - 1]; // Most recent
              state.awaitingCustom.delete(jid);
              await handlers.onCustom(jid, update.message.text);
              await telegramRequest(token, 'sendMessage', {
                chat_id: incomingChatId,
                text: `✅ Custom reply being generated...`,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`[${userId}] Telegram polling error:`, err?.message);
    }

    // Continue polling
    if (state.polling) {
      setTimeout(poll, 1000);
    }
  };

  poll();
}

/**
 * Stop polling for a user.
 */
export function stopTelegramPolling(userId) {
  const state = botInstances.get(userId);
  if (state) {
    state.polling = false;
    state.awaitingCustom.clear();
  }
}

/**
 * Check if Telegram bot is configured for a user.
 */
export function isTelegramConfigured(db, userId) {
  const { token, chatIds } = getBotConfig(db, userId);
  return !!(token && chatIds.length > 0);
}
