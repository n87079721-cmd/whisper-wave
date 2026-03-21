
Goal: stop chasing an unreliable “perfect sync” first, and make the app usable again even when WhatsApp history/name sync is incomplete.

What I found

1. Manual chat start is genuinely broken
- `src/lib/api.ts` can send to a raw phone/JID.
- But `backend/src/api.js` only saves the sent message if a contact row already exists.
- So for a brand-new number, the message may send to WhatsApp but no local contact/message is created, which makes it look like nothing happened.

2. Contact tap flow is fragile
- `src/pages/ContactsPage.tsx` sends only `contact.id`.
- `src/pages/ConversationsPage.tsx` then re-fetches conversations/contacts and tries to find that id again.
- If sync is stale or the contact is not in the conversations query yet, the chat view stays empty.

3. Sync recovery is not reliable after data loss
- In `backend/src/whatsapp.js`, full history comes from `messaging-history.set`.
- Your logs already showed contact store = 0 and history sync only appearing during certain pairings.
- That means once the DB is wiped or partially wrong, reconnecting alone may not repopulate everything. A clean re-pair is the only reliable way to ask WhatsApp/Baileys for the initial history burst again.

4. Existing bad contacts are legacy `@lid` rows
- The DB output proves many contacts were already written as fake phone-like values from raw `@lid`.
- Those names cannot be magically reconstructed from the current DB alone.

Plan

Phase 1: Make chats usable even without perfect sync
1. Fix “start conversation” persistence in `backend/src/api.js`
- When `/send/text` receives a raw `jid` and no contact exists:
  - upsert/create a contact row immediately
  - insert the outgoing message immediately
  - return the created `contactId`
- This makes new chats appear instantly after sending.

2. Make Contacts → Chat open directly
- Pass the full contact object from `ContactsPage` to `Index.tsx`, not just the id.
- Let `ConversationsPage` accept either an initial contact object or id.
- If the contact has no existing thread, open an empty composer immediately instead of waiting on another fetch.

3. Keep the new-chat picker fresh
- Refresh `allContacts` on SSE/polling the same way conversations refresh now.
- That fixes “contacts aren’t showing” inside the new conversation flow.

4. Add explicit sync-state UI
- Show a clear banner in Conversations/Contacts when WhatsApp is connected but only partial history is present.
- Example: “Only partial WhatsApp history is available. Re-pair to re-import older chats.”
- This avoids the current “app looks broken” feeling.

Phase 2: Stop corrupting contact identity
5. Tighten contact creation rules in `backend/src/whatsapp.js`
- Do not treat unresolved `@lid` values as trustworthy phone numbers.
- Store unresolved LID contacts as unresolved identities instead of fabricating a “+number”.
- Only promote them to canonical `@s.whatsapp.net` phone contacts once a real mapping is known.

6. Preserve and reuse resolved mappings better
- Reconcile LID contacts only when a trusted source exists (`senderPn`, alt jid, signal mapping).
- Avoid creating duplicate contact rows early.

Phase 3: Recovery flow for old chats
7. Add a guided “Fresh Re-sync” action
- UI action from Dashboard/Settings:
  - explain that older chats/names need a clean re-pair
  - clear local session/data
  - guide user through QR/pair-code again
  - show sync progress counts
- This is the realistic path for restoring older conversations already lost from the local DB.

Files to change
- `backend/src/api.js`
- `backend/src/whatsapp.js`
- `src/pages/ContactsPage.tsx`
- `src/pages/ConversationsPage.tsx`
- `src/pages/Index.tsx`
- optionally `src/pages/DashboardPage.tsx` or `src/pages/SettingsPage.tsx` for the guided re-sync action

Technical notes
- The “can’t start chat” bug is not a WhatsApp problem; it is a local persistence bug in `/api/send/text`.
- The “tap contact, nothing opens” issue is mostly a frontend state handoff problem.
- The “missing older chats/names” issue is partly recoverable only through fresh pairing because Baileys full-history sync is typically initial-sync dependent.
- So the right implementation is:
  1) restore usability immediately
  2) stop writing bad identity data
  3) provide a deliberate re-sync path instead of pretending live reconnect will recover everything
