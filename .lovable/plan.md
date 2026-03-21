

## Fix: LID JIDs Are Not Phone Numbers — Need Proper Resolution

**Problem**: `@lid` JIDs (e.g., `77481361039542@lid`) contain WhatsApp's internal "Linked Identity" numbers, NOT real phone numbers. The current code strips `@lid` and prepends `+`, producing fake phone numbers like `+77481361039542`. This is why contacts show meaningless numbers with no names.

**Root Cause**: Unlike `@s.whatsapp.net` JIDs (which contain the actual phone number), `@lid` JIDs use arbitrary internal identifiers. The contact store often has BOTH formats for the same person — the `@lid` JID and the corresponding `@s.whatsapp.net` JID — but the code doesn't cross-reference them.

### Solution: 3-Layer LID-to-Phone Resolution

#### Backend: `backend/src/whatsapp.js`

1. **Add a LID-to-phone mapping** on the instance (`inst.lidMap = new Map()`). When contacts arrive, scan the store for contacts that have a `lidJid` property or where the same contact appears under both `@lid` and `@s.whatsapp.net` formats. Build the map: `lidJid → phoneNumber`.

2. **Add a `resolveLidPhone()` helper function**:
   ```
   function resolveLidPhone(inst, jid):
     - If jid ends with @s.whatsapp.net → extract phone directly
     - If jid ends with @lid:
       Layer 1: Check inst.lidMap for a cached mapping
       Layer 2: Scan inst.store.contacts for any contact whose
                .lid property matches this jid, and extract its
                @s.whatsapp.net equivalent
       Layer 3: Fallback — use the raw LID number (last resort)
     - Return { phone, resolvedJid }
   ```

3. **Build LID map from contact events**: In `contacts.update`, `contacts.upsert`, and `messaging-history.set`, when a contact has both a `lid` property and an `id` ending in `@s.whatsapp.net`, add the mapping. Also scan inversely.

4. **Replace all JID-to-phone conversions** to use `resolveLidPhone()` instead of the naive regex strip. This affects ~7 locations (messages.upsert, history sync contacts/chats/messages, contacts.update, contacts.upsert, syncContacts).

5. **Fix existing bad data**: Add a one-time cleanup query on startup that updates contacts where phone looks like a LID (very long number not matching real phone patterns) once proper mappings are available.

#### Frontend: `src/pages/ContactsPage.tsx` and `src/pages/ConversationsPage.tsx`

6. **Already has `cleanPhone` stripping `@` suffixes** — this is fine as a safety net, but the real fix is backend-side so proper phones are stored.

### Files Changed
- `backend/src/whatsapp.js` — Add LID resolution logic, update all JID-to-phone conversions, add LID map building in contact events

### After Deploy
```bash
cd /root/wass && git pull && sudo supervisorctl restart wa-controller
```
The LID map builds as contacts sync in. Existing `@lid` contacts will be updated with real phone numbers and names as the mapping resolves.

