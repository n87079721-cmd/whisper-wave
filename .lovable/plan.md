

## Plan: Fix Multi-Person AI Replies, Handle Ignored Messages, and Add Emoji Reactions

### Problems Identified

1. **AI can only chat with 1 person at a time** — The `autoReplyCooldowns` map has a 30-second cooldown per JID, which is fine. The real issue is likely that the cooldown or batch buffer from one conversation blocks another. Looking at the code, each JID has its own batch buffer and cooldown, so concurrent conversations should work. However, if a reply is being generated (async), the cooldown gets set even before sending, which could cause timing issues. The main suspect: the `executeAutoReply` function runs sequentially — if one AI generation takes long, the 12-second batch timer for another contact fires but the generation blocks.

2. **New messages get ignored** — When someone sends follow-up messages while the AI is already generating/waiting to send a reply, the `clearPendingAutoReply` at line 2054 cancels the scheduled reply but the new message only resets the 12-second batch timer. If the cooldown (30s) was already set from a previous reply, the new batch fires `executeAutoReply` which immediately returns due to cooldown. Messages get ignored.

3. **No emoji reactions in the chat UI** — The backend sends reactions via WhatsApp but there's no listener for `message_reaction` events, no DB storage, and no UI to display or send reactions.

### Changes

#### 1. Backend: Fix concurrent AI replies (backend/src/whatsapp.js)
- Remove the 30-second cooldown skip in `executeAutoReply` — it causes messages to be ignored. Instead, if a reply is already pending for a JID, cancel it and generate a fresh one that includes the new messages.
- Ensure `handleAutoReply` properly cancels any in-progress pending reply AND resets cooldown when new messages arrive, so the AI always responds to the latest batch.
- Make the cooldown only apply AFTER a successful send, not as a pre-check blocker.

#### 2. Backend: Listen for reaction events (backend/src/whatsapp.js)
- Add `client.on('message_reaction', ...)` listener to capture incoming and outgoing reactions.
- Store reactions in a new `reactions` column on the messages table (JSON array of `{emoji, sender, timestamp}`).
- Emit a `message_reaction` SSE event to the frontend.

#### 3. Backend: API endpoint for sending reactions (backend/src/api.js)
- Add `POST /api/messages/:id/react` endpoint that accepts `{emoji}` and calls `msg.react(emoji)` on the WhatsApp client.

#### 4. Frontend: Display reactions on messages (src/pages/ConversationsPage.tsx)
- Show emoji reaction badges below each message bubble.
- Add a reaction picker (long-press/right-click on a message) with common emojis: 👍 ❤️ 😂 😮 😢 🙏.
- Call the new API endpoint when user picks a reaction.

#### 5. Database: Add reactions storage
- Add `reactions` TEXT column to messages table (JSON string).
- Migration handled inline via the existing `try { ALTER TABLE }` pattern.

### Technical Flow

```text
User sends reaction in UI
  → POST /api/messages/:id/react {emoji: "❤️"}
  → Backend fetches WA message, calls msg.react(emoji)
  → WhatsApp fires message_reaction event
  → Backend updates DB, emits SSE event
  → Frontend updates reaction badge on message

Incoming reaction from contact
  → message_reaction event fires
  → Backend stores in DB
  → SSE → Frontend shows reaction badge
```

