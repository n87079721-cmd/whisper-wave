
Goal: fix three related reliability problems: voice notes getting stuck as “waiting for message,” chats not appearing even though WhatsApp Web has them, and slow/incomplete syncing/loading.

What I found
- Voice notes are sent as `audio/ogg; codecs=opus` with `ptt: true`, which is correct in principle, but the current flow does not validate delivery or retry on failure. It also stores the outgoing voice note immediately in SQLite before confirming WhatsApp accepted it.
- History sync currently depends heavily on Baileys’ `messaging-history.set` event. That event is often incomplete or one-time-only after pairing, so if it misses older chats, the app stays partial while WhatsApp Web still shows them.
- “Sync Now” currently only re-runs local contact sync from the in-memory store; it does not fetch missing chats/messages from the live socket, so it cannot truly recover missing history.
- The conversations UI loads whole message lists per chat and refreshes often via SSE + polling. That is workable for small data, but it makes the app feel slow when the database grows.
- The sync state logic can mark the app as “ready” too early just because some history arrived, even if many chats are still missing.

Likely root causes
1. Voice note pipeline reliability
- ElevenLabs output + ffmpeg conversion may produce files WhatsApp accepts inconsistently on some recipients/devices.
- No send acknowledgement/retry/failure tracking.
- No fallback path when PTT send fails.

2. Incomplete history import
- The app relies on passive history events instead of doing an active recovery pass.
- If the session was paired before full history came in, the local DB can remain permanently incomplete.

3. Perceived slowness
- Frequent conversation/message refreshes.
- Full message list fetch for active chats.
- No pagination/windowing for large conversations.
- SSE events trigger list reloads broadly.

Implementation plan

1. Harden voice note sending on the backend
- Update `backend/src/elevenlabs.js` to generate more WhatsApp-safe Opus output:
  - ensure mono, 48kHz, Opus in OGG, consistent bitrate/frame settings
  - optionally add duration probing after conversion
- Update `backend/src/whatsapp.js` `sendVoiceNote()` to:
  - wrap send in a robust try/catch
  - return/send the WhatsApp message key when successful
  - add a fallback send mode if PTT fails once (regular audio or regenerated opus payload)
- Update `backend/src/api.js` `/send/voice` route so the DB insert reflects the real WhatsApp send result, not just local optimism.
- Store richer message status for outgoing voice notes: `pending`, `sent`, `failed`.

2. Add a real recovery sync path instead of only store sync
- Extend `backend/src/whatsapp.js` with a true “recovery sync” flow that:
  - reads current chats from the live socket/store after connection
  - backfills recent messages for chats that exist in WhatsApp but are missing locally
  - reconciles contacts and chat rows even when `messaging-history.set` was incomplete
- Keep existing LID reconciliation, but run it after recovery import too.
- Make `triggerSync()` call this stronger recovery path, not just `syncContacts()`.

3. Make sync state honest and actionable
- Refine sync phases in `backend/src/whatsapp.js`:
  - stay `partial` when only contacts exist but conversation/message totals are still low
  - only mark `ready` after recovery pass completes and minimum chat/message thresholds are met
- Emit more precise SSE sync progress so the frontend can show “Recovering chats…” vs “Connected only”.

4. Improve conversations loading performance
- Update `backend/src/api.js` message endpoints to support pagination for chat messages instead of always loading the full thread.
- Keep the optimized conversations query, but make sure refreshes happen only when the changed contact is affected.
- Reduce unnecessary full refresh behavior triggered from SSE.

5. Update chat UI to handle large histories better
- Refactor `src/pages/ConversationsPage.tsx` to:
  - load initial recent messages only
  - add “load older messages” / infinite scroll upward
  - avoid re-fetching the entire chat on every event
  - refresh only the active chat when relevant
- Keep the current search UI, but scope it to loaded messages unless expanded later to server search.

6. Improve recovery visibility in the UI
- Update `src/hooks/useWhatsAppStatus.ts`, `src/pages/SettingsPage.tsx`, `src/pages/DashboardPage.tsx`, and `src/components/SyncBanner.tsx` to show:
  - connected but still recovering history
  - partial sync warning with clearer guidance
  - better “Sync Now” wording so users know it fetches missing chats/messages

Files to change
- `backend/src/whatsapp.js`
- `backend/src/api.js`
- `backend/src/elevenlabs.js`
- `src/pages/ConversationsPage.tsx`
- `src/hooks/useWhatsAppStatus.ts`
- `src/pages/SettingsPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/components/SyncBanner.tsx`

Expected outcome
- Voice notes should stop randomly hanging for recipients as often, and failures will be visible/recoverable.
- “Sync Now” will actually recover missing chats/messages already visible in WhatsApp Web.
- The app will feel faster because chats won’t fully reload so aggressively and large histories won’t be fetched all at once.

Technical details
```text
Current weak point:
Connect -> wait for messaging-history.set -> maybe partial DB forever

Proposed:
Connect
  -> passive history import if available
  -> active recovery sync pass
  -> reconcile contacts/LIDs
  -> mark ready only after recovery completes
```

```text
Current voice send:
generate ogg -> send -> insert local message

Proposed:
generate validated ogg
  -> send
  -> confirm success / capture key
  -> insert with real status
  -> fallback/retry if ptt send fails
```
