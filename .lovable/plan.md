

# Fix: Show WhatsApp Names for Contacts

## Problem
Contacts are showing phone numbers instead of their WhatsApp display names. The sync code only checks `c.notify || c.name` but Baileys provides names in several fields depending on the contact type.

## Changes

### 1. `backend/src/whatsapp.js` — Use all Baileys name fields

Create a helper that picks the best available name from a Baileys contact/chat object:

```javascript
function resolveName(obj) {
  return obj?.notify || obj?.verifiedName || obj?.name || obj?.pushName || null;
}
```

Update all 4 places where contact names are resolved:

- **`messaging-history.set` contacts** (line ~330): `resolveName(c)` instead of `c.notify || c.name || null`
- **`messaging-history.set` chats** (line ~344): `resolveName(chat)` instead of `chat.name || null`
- **`messaging-history.set` messages** (line ~361): `resolveName(msg)` plus `msg.pushName` instead of just `msg.pushName`
- **`contacts.upsert`** (line ~418): `resolveName(c)` instead of `c.notify || c.name || null`
- **`contacts.update`** (line ~397): Also check `update.verifiedName || update.name` in addition to `update.notify`

### 2. `backend/src/whatsapp.js` — Update existing contacts with better names

In `getOrCreateContact`, also update the name if the existing name is just the phone number (starts with `+`), even if `pushName` differs — to overwrite phone-number-only entries with actual names when they become available.

## Files Modified
- `backend/src/whatsapp.js`

