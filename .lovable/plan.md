

# Plan: Four Features — Sensitive Topics, Telegram Reply Preview, Conversation Starter, Conversation Summaries

## Overview

Add four intelligence features to the WhatsApp AI auto-reply system. No Telegram connector exists yet — we'll set it up. The reply preview flow sends drafts to Telegram with Cancel/Rewrite/Custom buttons (no approve needed — AI sends automatically unless you intervene).

---

## 1. Sensitive Topic Detection

**What it does**: Before generating a reply, the AI checks the incoming message for sensitive topics (death, medical, money requests, legal, emergencies, suicidal content). If detected, the AI pauses and does NOT reply. Instead, it sends you a Telegram alert.

**Changes**:

**`backend/src/ai.js`** — New `detectSensitiveTopic(apiKey, messageText)` function:
- Uses gpt-4o-mini with a focused prompt to classify messages
- Returns `{ isSensitive: boolean, topic: string, reason: string }` or `null`
- Checks for: death/grief, medical emergencies, money requests, legal threats, suicidal/self-harm, abuse, explicit content

**`backend/src/whatsapp.js`** — In `executeAutoReply()`, before generating the reply:
- Call `detectSensitiveTopic()` on the latest message text
- If sensitive: skip reply, send Telegram notification, log `skip_sensitive_topic`

---

## 2. Telegram Reply Preview (Cancel / Rewrite / Custom)

**What it does**: The AI generates and sends the reply as it does now (no approval needed). But it ALSO sends the draft to your Telegram bot so you can intervene BEFORE the typing delay finishes. Buttons: **Cancel** (stop the reply), **Rewrite** (AI generates a new one), **Custom** (you tell the AI how to respond).

**Flow**:
1. AI generates reply → schedules it with the usual delay
2. Simultaneously sends to Telegram: `"💬 Reply to **John**: 'nah that's crazy lol'"`
3. Three inline buttons: `Cancel | Rewrite | Custom`
4. **Cancel**: Cancels the pending reply (calls `clearPendingAutoReply`)
5. **Rewrite**: Cancels current, regenerates, reschedules, sends new preview
6. **Custom**: Bot asks "How should I respond?", you type instructions, AI generates based on that

**Changes**:

**`backend/src/telegram.js`** — New module:
- `initTelegramBot(db)` — sets up polling via `getUpdates` loop
- `sendReplyPreview(userId, contactName, replyText, jid)` — sends inline keyboard message
- `sendSensitiveAlert(userId, contactName, topic, messagePreview)` — sends sensitive topic alert
- Handles callback queries: `cancel_{jid}`, `rewrite_{jid}`, `custom_{jid}`
- Handles custom text responses after `custom_` callback
- Config keys: `telegram_bot_token`, `telegram_chat_id`

**`backend/src/whatsapp.js`** — After generating `replyText` in `executeAutoReply()`:
- Before scheduling the delay timer, call `sendReplyPreview()` to Telegram
- Store a reference so Telegram callbacks can cancel/modify the pending reply

**`backend/src/db.js`** — No schema changes needed (uses existing `config` table for bot token + chat ID)

**`backend/src/index.js`** — Initialize Telegram bot on startup

**`src/pages/SettingsPage.tsx`** — New "Telegram Bot" section:
- Input for Bot Token (from BotFather)
- Input for Chat ID (your personal chat ID)
- Test button to send a test message

**`src/lib/api.ts`** — Add API calls for Telegram config

**`backend/src/api.js`** — Add endpoint to test Telegram connection: `POST /telegram/test`

---

## 3. Conversation Starter

**What it does**: Periodically (configurable), the AI initiates conversations with contacts you've marked as "close". Uses memory context and time-of-day awareness.

**Changes**:

**`backend/src/db.js`** — Add `auto_initiate` column to contacts table (INTEGER DEFAULT 0)

**`backend/src/ai.js`** — New `generateConversationStarter(apiKey, contactName, memory, lastConvoSummary)` function:
- Generates a natural opener based on memory, time of day, and how long since last conversation
- Prompt emphasizes casual, natural initiation (not "Hey how are you?")

**`backend/src/whatsapp.js`** — New `conversationStarterLoop(userId, db)`:
- Runs every 2 hours (configurable)
- Finds contacts where `auto_initiate = 1` AND last message was 1+ days ago
- Generates and sends a natural opener
- Max 2 starters per day across all contacts
- Respects active hours

**`src/pages/ConversationsPage.tsx`** — In the brain/memory Sheet, add toggle: "Auto-start conversations"

**`backend/src/api.js`** — Add endpoint to toggle `auto_initiate` per contact

---

## 4. Conversation Summaries

**What it does**: After a long conversation (20+ messages exchanged in a session), or daily at a configured time, the AI auto-generates a brief summary and appends it to the contact's memory field.

**Changes**:

**`backend/src/ai.js`** — New `generateConversationSummary(apiKey, messages, contactName, existingMemory)` function:
- Summarizes key topics, decisions, emotional tone, and notable info
- Returns a 2-3 sentence summary with a date stamp
- Prompt: "Extract key facts worth remembering. Don't repeat what's already in memory."

**`backend/src/whatsapp.js`** — Two triggers:
1. **Post-conversation**: After the AI sends a reply, check if the conversation session has 20+ messages. If so, generate summary and append to `memory` column
2. **Daily digest**: New `dailySummaryLoop(userId, db)` — runs once per day, summarizes all contacts with 10+ new messages since last summary

**`backend/src/db.js`** — Add `last_summary_at` column to contacts table

---

## Settings UI for all features

**`src/pages/SettingsPage.tsx`** additions:
- **Telegram Bot** section: token, chat ID, test button
- **Sensitive Topics** toggle (on/off, uses config key `sensitive_topic_detection`)
- **Conversation Starters** global toggle + frequency setting
- **Auto-Summarize** toggle

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `backend/src/telegram.js` | New — Telegram bot polling, inline keyboards, callback handling |
| `backend/src/ai.js` | Add `detectSensitiveTopic()`, `generateConversationStarter()`, `generateConversationSummary()` |
| `backend/src/whatsapp.js` | Integrate sensitive check + Telegram preview in `executeAutoReply()`, add starter + summary loops |
| `backend/src/db.js` | Add `auto_initiate`, `last_summary_at` columns to contacts |
| `backend/src/index.js` | Init Telegram bot on startup |
| `backend/src/api.js` | Telegram test endpoint, auto_initiate toggle, sensitive topics config |
| `src/pages/SettingsPage.tsx` | Telegram bot config, sensitive topics toggle, starters toggle, auto-summarize toggle |
| `src/pages/ConversationsPage.tsx` | Auto-start conversations toggle in brain Sheet |
| `src/lib/api.ts` | API methods for new config keys |

