
Goal

Make the app honest and usable when WhatsApp itself has not fully synced, instead of showing “connected” while chats/names are still incomplete. The screenshot confirms this is not just a frontend bug: the linked device itself is in a partial-sync state.

What I found

- `backend/src/whatsapp.js` logs history/contact sync counts, but `getWhatsAppState()` only returns `status`, `qr`, and `pairingCode`. The frontend cannot tell “connected but incomplete” from “fully synced”.
- `src/hooks/useWhatsAppStatus.ts` and `src/pages/DashboardPage.tsx` only model transport state (`connected`, `qr_waiting`, `reconnecting`), so the UI overstates success.
- `src/pages/ContactsPage.tsx` and `src/pages/ConversationsPage.tsx` only show per-contact “Waiting for sync” for unresolved `@lid` rows; there is no global explanation or recovery guidance.
- `src/pages/SettingsPage.tsx` already has a Fresh Re-sync action, but it is not driven by real sync diagnostics and does not show progress/results.
- The identity layer is improved, but split-thread risk still exists unless every open/reply/new-chat path prefers the canonical `@s.whatsapp.net` thread and unresolved `@lid` rows are treated as temporary.

Implementation plan

1. Add real sync-state tracking in the backend
- Extend the per-user WhatsApp instance in `backend/src/whatsapp.js` with sync metadata:
  - phase: `idle | waiting_history | importing | partial | ready | repair_required`
  - counts: store contacts, history chats, history contacts, history messages, unresolved LID contacts
  - timestamps: connectedAt, lastHistorySyncAt
  - summary message + recommended action
- Update this state during:
  - connection open
  - `syncContacts()`
  - `messaging-history.set`
  - deferred LID sweep
  - clear session / reconnect

2. Expose sync-state to the frontend
- Extend `getWhatsAppState()` and `/api/status` in `backend/src/api.js` to return sync metadata alongside connection state.
- Stream sync updates over SSE with a dedicated event (for example `sync_state`) so the UI can update immediately during import/recovery.

3. Make the dashboard reflect reality
- Update `useWhatsAppStatus.ts` to store both connection status and sync status.
- Update `src/pages/DashboardPage.tsx` and `src/components/StatusBadge.tsx` so “Connected” can become:
  - Connected
  - Syncing history
  - Connected, partial sync
  - Re-sync required
- Add a warning card when the device is connected but WhatsApp history is incomplete, with plain-language copy explaining that this can happen even on linked devices.

4. Add clear recovery UX where users actually need it
- Add a shared warning banner to `ConversationsPage.tsx` and `ContactsPage.tsx` when sync is partial.
- Banner should explain:
  - newer/manual chats may still work
  - names/older threads may be missing
  - Fresh Re-sync is the fix when WhatsApp did not finish importing
- Link directly to Settings or trigger the existing re-sync flow from there.

5. Tighten thread identity so replies don’t split
- In `backend/src/whatsapp.js` and `backend/src/api.js`, make every send/open path prefer canonical phone JIDs when known.
- Ensure unresolved `@lid` contacts remain temporary placeholders until a trusted mapping exists.
- When a trusted mapping arrives, merge records/messages into the canonical contact so replies to people like Bev stay in one thread.

6. Turn Fresh Re-sync into a guided flow, not just a destructive button
- Keep the existing clear-session action in `src/pages/SettingsPage.tsx`, but wrap it with clearer steps:
  - why this is needed
  - what will be cleared locally
  - that phone messages are not deleted
  - what to expect after re-pair
- After re-pair, surface live sync progress from the new backend sync-state instead of leaving the user guessing.

7. Add practical completion rules
- Mark sync as `partial` when signals look incomplete, such as:
  - connected but store contacts remain 0
  - no history event after a grace period
  - history counts are very small
  - unresolved LID contacts remain after sweep
- Mark sync as `ready` only when at least one meaningful history/contact import or stable canonical contact set is present.
- This prevents the app from claiming parity with WhatsApp Web when the upstream device never finished syncing.

Files to change

- `backend/src/whatsapp.js`
- `backend/src/api.js`
- `src/hooks/useWhatsAppStatus.ts`
- `src/components/StatusBadge.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/ContactsPage.tsx`
- `src/pages/ConversationsPage.tsx`
- `src/pages/SettingsPage.tsx`

Technical notes

- The core gap is not pairing itself; it is that transport health and sync completeness are currently treated as the same thing.
- The app already has the right building blocks: history-sync logs, LID reconciliation, SSE, and Fresh Re-sync. What is missing is a real sync model shared with the UI.
- I would keep the current architecture and add a small sync-state layer rather than redesigning storage.
- QA focus:
  - connected-but-partial device shows warning instead of false success
  - Fresh Re-sync shows progress after re-pair
  - replying to an existing person does not create a duplicate thread
  - starting a chat with a new number still works during partial sync
  - contacts/conversations update live as mappings resolve
