

# Fix Chat History & Contact Names

## Root Causes Found

### 1. Recovery sync doesn't fetch messages
The `recoverSync()` function (line 1189-1261) only creates empty contact entries for missing chats — it never fetches actual messages. Baileys supports **on-demand history sync** via `sock.fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp)` which can pull older messages for specific chats. This is not being used at all.

### 2. Contact names are lost because the store is too minimal
The in-memory contact store (`inst.store = { contacts: {} }`) only populates from live `contacts.update`/`contacts.upsert` events. If those events don't fire (common after reconnect without re-pairing), the store stays empty and all name lookups fail — contacts show as phone numbers or "WhatsApp contact • XXXX".

### 3. No `onWhatsApp` validation for contact names
Baileys has `sock.onWhatsApp(...jids)` which can verify if numbers exist on WhatsApp. Combined with store lookups, this could help populate names, but it's never called.

### 4. History sync fires once, then never again
`messaging-history.set` typically fires only after initial pairing. On reconnect, it usually doesn't re-fire, so if the initial sync was partial, the DB stays incomplete forever. The on-demand fetch API exists to solve exactly this.

## Plan

### 1. Use on-demand history fetch in recovery sync (`backend/src/whatsapp.js`)
- In `recoverSync()`, for contacts that exist in the WA store but have 0 messages locally, call `sock.fetchMessageHistory(50, oldestMsgKey, oldestMsgTimestamp)` to request recent messages from the phone
- Handle the response in the existing `messaging-history.set` handler (Baileys delivers on-demand results there with `syncType === ON_DEMAND`)
- Limit to ~20 chats per recovery pass to avoid rate-limiting
- Add a small delay between requests (500ms)

### 2. Actively fetch contact profiles for unnamed contacts (`backend/src/whatsapp.js`)
- After sync, query the DB for contacts with phone-like names or "WhatsApp contact" placeholder names
- For those contacts, check `inst.store.contacts[jid]` for any name updates
- For contacts still unnamed, use `sock.onWhatsApp(phone)` to verify the number exists and check if pushName is available from the response
- Update DB contact names when better names are discovered

### 3. Persist contact store across reconnects (`backend/src/whatsapp.js`)
- On `contacts.upsert`/`contacts.update`, also write a lightweight contact cache to SQLite (reuse existing `contacts` table — already happens)
- On reconnect, pre-populate `inst.store.contacts` from the DB contacts table so name lookups work even before new events arrive
- This prevents the "empty store after reconnect" problem

### 4. Trigger on-demand history for active chats opened in UI (`backend/src/api.js`)
- Add a new API endpoint `POST /api/recover-chat/:contactId` 
- When a user opens a chat that has 0 or very few messages, the frontend can call this to request on-demand history for that specific chat
- Backend calls `sock.fetchMessageHistory()` for the chat's JID

### 5. Frontend: add "Fetch History" button for empty chats (`src/pages/ConversationsPage.tsx`)
- When a chat is opened and has 0 messages, show a "Fetch chat history" button
- Calls the new recover-chat endpoint
- Shows a loading spinner while fetching

### 6. Add `api.recoverChat` method (`src/lib/api.ts`)
- Add the API call method for the new endpoint

## Files to Change
1. `backend/src/whatsapp.js` — On-demand history fetch, store pre-population from DB, contact name enrichment
2. `backend/src/api.js` — New `/recover-chat/:contactId` endpoint
3. `src/pages/ConversationsPage.tsx` — "Fetch chat history" button for empty chats
4. `src/lib/api.ts` — New API method

## How it works vs WhatsApp Web
WhatsApp Web gets a complete history dump on first pair because it uses the official protocol. Baileys (being reverse-engineered) gets a partial dump. The on-demand history API lets us request specific chat histories after the fact — this is the same mechanism WhatsApp Web uses when you scroll up in old chats. This plan brings the app closer to WhatsApp Web behavior by actively requesting missing data instead of passively waiting for it.

