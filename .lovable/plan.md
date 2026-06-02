## Plan — fix sync, navigation, loading, and mobile spacing

### 1. Chats deleted on WhatsApp should disappear from the site
- During each `syncChats` pass on the backend, compare the chats returned by WhatsApp Web to the contacts already stored locally.
- For any local contact whose chat no longer exists in WhatsApp:
  - Remove its messages and stored media for that user.
  - Remove the contact row (and its archive/unread state).
- Also handle `chat_archive` / chat-removal events from `whatsapp-web.js` so deletes propagate in real time, not only on next sync.
- Emit a `contacts_sync` event after a removal so the frontend list refreshes immediately.

### 2. Returning from a chat in Archive should stay in Archive
- In `ConversationsPage.tsx`, when the user taps an archived chat, do not flip `showArchived` to `false` — keep the archive view active so the back arrow returns to the archived list, matching WhatsApp Web behavior.

### 3. Chat loading no longer "bounces" up and down
- Keep the message viewport scroll-locked to the bottom during the initial load by using `overflow-hidden` (not just opacity) until layout is stable.
- Reveal only after: messages are rendered, fonts/images have settled (or the 700ms safety net fires), and a final scroll-to-bottom is applied. No more visible drift while images and media size in.

### 4. Read / unread behaves correctly
- When a chat is opened, call WhatsApp Web's "send seen" for that chat so the backend stops reporting it as unread on the next sync, then zero the local counter.
- In `syncChats`, only overwrite `unread_count` upward (never reset to a stale higher value after the user just read it).
- Listen for live read-state changes via `message_ack` / chat updates and push them into the DB and through SSE so the badge updates immediately.

### 5. Mobile: Voice Studio buttons hidden under the bottom nav
- Increase the bottom padding of scrollable pages on mobile so the Preview Voice Note, Generate, Send, and recipient picker are not covered by the fixed bottom nav, even with iOS safe-area insets.
- Verify on the current mobile viewport (Voice Studio, Conversations composer, Settings) that the last action button has clear space above the nav without rotating the device.

### Quick clarifying question
- You mentioned "if I use settings, only my WhatsApp chat is supposed to be there." Could you point me at the screen you mean? I want to make sure I touch the right list (Settings doesn't currently show a chat list, so it might be the Send Message page, the Voice Studio recipient picker, or the contacts dropdown).

### Files likely touched
- `backend/src/whatsapp.js` — chat removal, read receipts, unread sync rules.
- `backend/src/api.js` — surface chat-removed events.
- `src/pages/ConversationsPage.tsx` — archive back-navigation, chat-loading reveal.
- `src/pages/VoiceStudioPage.tsx` and/or `src/pages/Index.tsx` — mobile bottom padding.