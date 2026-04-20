/**
 * Telegram Bot module — Reply Preview, Sensitive Topic Alerts
 * Uses polling (getUpdates) to receive callback queries and text responses.
 * No external Telegram library — raw HTTP via fetch.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Per-user bot state
const botInstances = new Map(); // userId -> { polling, offset, awaitingCustom: Map<jid, true>, lastReplies: Map<jid, string> }

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
    botInstances.set(userId, { polling: false, offset: 0, awaitingCustom: new Map(), lastReplies: new Map() });
  }
  const inst = botInstances.get(userId);
  if (!inst.lastReplies) inst.lastReplies = new Map();
  if (!inst.awaitingCustom) inst.awaitingCustom = new Map();
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

  // Remember this draft so /custom can edit/extend it later
  const state = getBotState(userId);
  state.lastReplies.set(jid, replyText);

  // Show which persona produced this reply so the user can verify the right
  // character/prompt is active for this contact.
  const personaLine = persona ? `🎭 _${escapeMarkdown(persona)}_\n` : '';
  const text = `💬 Reply to *${escapeMarkdown(contactName)}*:\n${personaLine}\n${escapeMarkdown(replyText)}`;
  const keyboard = {
    inline_keyboard: [[
      { text: '❌ Cancel', callback_data: `cancel_${jid}` },
      { text: '🔄 Rewrite', callback_data: `rewrite_${jid}` },
      { text: '✏️ Custom', callback_data: `custom_${jid}` },
    ]],
  };

  await Promise.all(chatIds.map(async (cid) => {
    try {
      await telegramRequest(token, 'sendMessage', {
        chat_id: cid,
        text,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
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
            const [action, ...jidParts] = cbData.split('_');
            const jid = jidParts.join('_');

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
