

# Fix Chat Sync + Contact Names + Add Diagnostics

## Real Problems Found

1. **`fetchMessageHistory` is called with invalid arguments** — the code passes `{ remoteJid, fromMe: false, id: '' }` with `undefined` timestamp. The Baileys API requires a valid `IMessageKey` and a numeric timestamp. An empty `id` and undefined timestamp likely cause silent failures or no-ops.

2. **`onWhatsApp()` does NOT return names** — the enrichment function calls `sock.onWhatsApp(phone)` hoping to get pushName, but Baileys only returns `{ exists: boolean, jid: string }`. The subsequent store lookup still finds nothing because the store was never populated for that contact. This whole enrichment path is broken.

3. **`chats.upsert` event is not listened to** — Baileys fires `chats.upsert` when new chats appear (including from on-demand sync results). The code only listens to `contacts.upsert`, `contacts.update`, and `messaging-history.set`. Missing `chats.upsert` means chat metadata from on-demand fetches may be silently dropped.

4. **No `syncType` handling in `messaging-history.set`** — On-demand history results arrive via the same event but with `syncType === ON_DEMAND`. The handler doesn't differentiate, which is fine for storage, but it also doesn't log or track on-demand results separately, making debugging impossible.

5. **No diagnostics visible to the user** — The user cannot see: how many contacts are unnamed, how many chats have 0 messages, whether on-demand fetch actually ran, or what the recovery sync did. There's no way to tell what's working vs broken.

6. **Contact store pre-population is one-directional** — It loads `@s.whatsapp.net` contacts from DB into store on reconnect, but never writes newly discovered names back to the store, so the store diverges from DB over time.

## Plan

### 1. Fix `fetchMessageHistory` call signature (`backend/src/whatsapp.js`)
- For chats with existing messages in DB, use the oldest message's key (remoteJid + id) and timestamp
- For chats with 0 messages, use `chatModify` to mark unread (triggers server-side sync) instead of `fetchMessageHistory` with invalid args
- Add proper error logging for each attempt

### 2. Replace broken `enrichUnnamedContacts` with profile-based lookup (`backend/src/whatsapp.js`)
- Remove the `onWhatsApp` path since it doesn't return names
- Instead, use `sock.fetchStatus(jid)` or check if `contacts.update` events arrive after the socket reconnects
- For contacts where the store has a name but DB doesn't, write store name to DB (this already partially works but only on events)
- Run a targeted DB scan matching store contacts to unnamed DB entries after every `contacts.upsert` batch

### 3. Listen to `chats.upsert` event (`backend/src/whatsapp.js`)
- Add handler for `chats.upsert` — create/update contact entries from chat metadata
- This captures chats that arrive from on-demand history or delayed sync

### 4. Add sync diagnostics endpoint + UI (`backend/src/api.js`, `src/pages/SettingsPage.tsx`)
- New `GET /api/sync-diagnostics` endpoint returning:
  - Total contacts, unnamed contacts count, contacts with 0 messages
  - LID map size, store contacts count vs DB contacts count
  - Last recovery sync time, last history event time
  - List of top 10 unnamed contacts (so user can see what's unresolved)
- Add a "Sync Diagnostics" card in Settings showing this data
- Add a "Full Re-sync" button that does: clear session + reconnect (since user approved one-time reset)

### 5. Improve recovery sync logging (`backend/src/whatsapp.js`)
- Log each step with counts: "Found X store contacts, Y missing from DB, Z with 0 messages"
- Log fetchMessageHistory results (success/fail per JID)
- Emit SSE events with recovery progress details

### 6. Add a "Reset & Re-pair" option in Settings (`src/pages/SettingsPage.tsx`)
- Clear button that wipes session + DB and starts fresh QR pairing
- Explain this is needed when history sync was permanently partial
- Since user confirmed they're willing to re-pair, this gives them a clean baseline

## Files to Change
1. `backend/src/whatsapp.js` — Fix fetchMessageHistory args, add chats.upsert handler, fix enrichment, improve logging
2. `backend/src/api.js` — New sync-diagnostics endpoint
3. `src/pages/SettingsPage.tsx` — Diagnostics card + Reset & Re-pair button
4. `src/lib/api.ts` — New API method for diagnostics

