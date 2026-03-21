

## Phase 1: Stabilize Contacts, Names, and Live Sync

There are three root causes for the broken state:

### Problem Analysis

1. **LID-to-phone mapping fails silently** — The current `buildLidMapping()` relies on contacts having a `.lid` property alongside an `@s.whatsapp.net` id. In practice, most contacts arrive as `@lid`-only with no cross-reference. The real mapping sources are never used:
   - `msg.key.remoteJidAlt` (PN when remoteJid is @lid) — available in Baileys 6.8+
   - `msg.key.participantAlt` (PN when participant is @lid, for groups)
   - `sock.signalRepository.lidMapping.getPNForLID()` — Baileys' internal mapping store

2. **Duplicate contact entries** — Messages from the same person create two contacts: one with `@lid` JID, one with `@s.whatsapp.net` JID. The conversations page only shows contacts with messages, but they fragment across these duplicates.

3. **Frontend shows stale data** — The SSE + polling infrastructure works, but the data being polled is broken (wrong JIDs, no names), so it appears non-functional.

### Solution

#### Backend: `backend/src/whatsapp.js`

**1. Use `remoteJidAlt` and `participantAlt` for LID mapping**

In `messages.upsert`, extract the alt JID fields from every message key:

```text
For each message:
  - If msg.key.remoteJid ends with @lid AND msg.key.remoteJidAlt exists:
    → Store mapping: remoteJid → phone from remoteJidAlt
  - If msg.key.participant ends with @lid AND msg.key.participantAlt exists:
    → Store mapping: participant → phone from participantAlt
```

Do the same in `messaging-history.set` for history messages.

**2. Use `sock.signalRepository.lidMapping` as fallback**

Update `resolveLidPhone()` to add a Layer 1.5: call `inst.sock?.signalRepository?.lidMapping?.getPNForLID(jid)` before scanning the contact store. This is Baileys' authoritative mapping.

**3. Merge/deduplicate @lid and @s.whatsapp.net contacts**

When a LID→PN mapping is discovered and both contacts exist in the DB:
- Move all messages from the @lid contact to the @s.whatsapp.net contact
- Delete the @lid contact entry
- Update the @s.whatsapp.net contact's name if the @lid one had a better name

Add a `reconcileLidContacts(db, userId, lidJid, phone)` function called whenever a new mapping is discovered.

**4. Always use resolved JID for storing messages**

In `messages.upsert`, use `resolvedJid` (the @s.whatsapp.net version) for the `jid` column in the messages INSERT, not the raw `jid`. This prevents future fragmentation.

**5. Use contact.phoneNumber field**

Per Baileys v7 migration docs: contacts with `@lid` as their `id` have a `phoneNumber` field. Update `buildLidMapping` to check `contact.phoneNumber`:

```javascript
if (id.endsWith('@lid') && contact.phoneNumber) {
  const phone = contact.phoneNumber.replace(/[^0-9]/g, '');
  inst.lidMap.set(id, phone);
}
```

**6. Listen for `lid-mapping.update` event**

Add a new event listener:
```javascript
inst.sock.ev.on('lid-mapping.update', (mappings) => {
  for (const [lid, pn] of Object.entries(mappings)) {
    inst.lidMap.set(lid, pn.replace('@s.whatsapp.net', ''));
    reconcileLidContacts(db, userId, lid, pn.replace('@s.whatsapp.net', ''));
  }
  emit(userId, 'contacts_sync', { count: Object.keys(mappings).length });
});
```

#### Frontend: `src/pages/ConversationsPage.tsx`

**7. Clean phone display in conversation list**

The conversation list shows raw `@lid` suffixed values. Apply the same `cleanPhone` stripping as ContactsPage for the phone display and initials generation.

#### Frontend: `src/pages/ContactsPage.tsx`

**8. Already has cleanPhone** — No changes needed, already strips `@` suffixes.

### Files Changed
- `backend/src/whatsapp.js` — Add remoteJidAlt/participantAlt extraction, use signalRepository.lidMapping, add contact.phoneNumber check, add lid-mapping.update listener, add reconcileLidContacts, use resolvedJid in message inserts
- `src/pages/ConversationsPage.tsx` — Clean phone display

### After Deploy
```bash
cd /root/wass && git pull && sudo supervisorctl restart wa-controller
```

The LID mappings will populate from three new sources (remoteJidAlt, signalRepository, lid-mapping.update event). Existing @lid contacts will be automatically merged with their @s.whatsapp.net counterparts as mappings resolve. New messages will store under the correct JID immediately.

### Phase 2 (Future)
Migrate to LID-primary architecture as recommended by Baileys docs — store LID as the canonical identifier and PN as metadata. This is a larger refactor for later.

