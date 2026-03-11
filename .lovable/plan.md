

# Fix: Clear Data on Logout + Ensure Chat/Contact Sync Works

## Problem
1. **Logout doesn't clear data** — `clearSession()` deletes auth files but leaves messages, contacts, and stats in the database. Old data persists when a new account connects.
2. **History sync works** — the `messaging-history.set` listener already imports chats, contacts, and messages. But if old data remains, it creates confusion.

## Changes

### 1. `backend/src/whatsapp.js` — Wipe DB tables on logout
In `clearSession()`, add three DELETE statements before the auth directory cleanup:
```javascript
db.prepare('DELETE FROM messages').run();
db.prepare('DELETE FROM contacts').run();
db.prepare('DELETE FROM stats').run();
```

### 2. `backend/src/api.js` — Emit `history_sync` via SSE
The `history_sync` event is already emitted from whatsapp.js but the SSE handler in `api.js` doesn't forward it. Add it so the frontend knows when new data arrives and can refresh:
```javascript
} else if (event === 'history_sync') {
  send('history_sync', data);
}
```

### 3. `src/pages/ContactsPage.tsx` — Auto-refresh on history sync
Listen to the SSE `history_sync` event to re-fetch contacts when sync completes, so contacts appear without a manual page reload.

### 4. `src/pages/ConversationsPage.tsx` — Auto-refresh on history sync
Same treatment — re-fetch conversations when history sync event arrives.

### 5. `src/pages/DashboardPage.tsx` — Auto-refresh stats on history sync
Re-fetch dashboard stats when history sync completes.

## Why chats/contacts aren't loading now
The sync code is correct. The most likely issue is that after logout + re-login, stale data from the previous account remains, and the `INSERT OR IGNORE` prevents new data from overwriting it (same message IDs won't re-insert). Wiping the DB on logout fixes this. The SSE forwarding ensures the UI refreshes automatically as sync data streams in.

