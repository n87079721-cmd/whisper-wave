

## Plan: Fix Contacts Names, Chat Navigation, and Sync Issues

There are multiple interrelated problems visible in the screenshots and code:

### Problems Identified

1. **Contacts show JIDs instead of names** — Contacts display raw identifiers like `+77481361039542@lid` because the backend doesn't strip the `@lid` suffix (a newer Baileys JID format). The phone extraction only handles `@s.whatsapp.net` and `@g.us`.

2. **Clicking contacts doesn't open chat** — The `ContactsPage` passes `contact.id` to `onOpenChat`, and `Index.tsx` does wire it to `ConversationsPage`. However, the `onOpenChat` prop type expects a `string` but `ContactsPage` calls `onOpenChat?.(contact.id)` correctly. The issue is likely that the page switch happens but no conversation exists for contacts with 0 messages, so nothing loads visibly.

3. **Chats don't sync / load** — The `@lid` JID format means messages arriving from those JIDs create contacts with broken phone numbers like `+77481361039542@lid` and names that are just the raw JID.

4. **Messages not up to date** — The history sync stores messages with `INSERT OR IGNORE`, which is correct. But if the contact cache (`inst.store.contacts`) is empty at connection time (since we removed `makeInMemoryStore`), the `syncContacts` function finds 0 contacts to sync initially.

### Solution

#### Backend: `backend/src/whatsapp.js`

1. **Handle `@lid` JID format everywhere** — Add `@lid` to all JID-stripping patterns. The `@lid` suffix is a newer WhatsApp identifier format. Update all instances of `.replace('@s.whatsapp.net', '').replace('@g.us', '')` to also strip `@lid`:
   ```js
   jid.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '')
   ```
   This affects ~6 locations: `messages.upsert`, `messaging-history.set` (contacts, chats, messages sections), `contacts.update`, `contacts.upsert`, and `syncContacts`.

2. **Improve contact name resolution for `@lid` JIDs** — When a JID uses `@lid`, the contact store may have the name under the equivalent `@s.whatsapp.net` JID. Add a fallback lookup:
   ```js
   const storeContact = inst.store?.contacts?.[jid] 
     || inst.store?.contacts?.[rawNumber + '@s.whatsapp.net'];
   ```

3. **Don't skip contacts with no name in `contacts.update`** — Line 503 has `if (!candidate.name) continue;` which skips contacts that only have a phone number, preventing them from being created/updated at all. Remove this guard.

#### Frontend: `src/pages/ContactsPage.tsx`

4. **Display phone cleanly** — Strip `@lid` suffix from displayed phone numbers in case the backend stored them with it:
   ```tsx
   const cleanPhone = (p: string) => p?.replace(/@.*$/, '') || '';
   ```

#### Frontend: `src/pages/ConversationsPage.tsx`  

5. **When navigating from contacts with no chat history** — The auto-select logic already handles this (lines 62-79), fetching from contacts API as fallback. Verify it shows the empty chat view with the reply box so users can start a conversation.

### Technical Details

- The `@lid` JID format is a LinkedIn-derived identifier format that newer Baileys versions expose
- All 6 JID-parsing locations in `whatsapp.js` need the same regex fix
- The contact store fallback lookup ensures names resolve even when the cache key format differs from the incoming JID format
- No database schema changes needed

### Files Changed
- `backend/src/whatsapp.js` — Fix JID parsing, improve name resolution, remove skip guard
- `src/pages/ContactsPage.tsx` — Clean phone display
- `src/pages/ConversationsPage.tsx` — Minor: ensure empty chat state works for contacts navigation

