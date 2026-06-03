## Plan

Apply all fixes globally so they work for existing accounts, accounts created in the past, and any future signup — no per-user opt-in.

### 1. Fresh-account defaults start at zero

- In the user-creation path (`backend/src/auth.js` signup + any admin-create flow), initialize AI counters, daily quotas, message counts, and conversation-starter cooldowns to `0` instead of the current default of `5`.
- Add a one-time backfill on server start in `backend/src/index.js` that resets these same counters to `0` for any existing account where they still hold the legacy default, so old users get the same behavior.

### 2. AI: longer prompts, strict persona, time-of-day awareness, cooldown respect

In `backend/src/ai.js` (and persona prompt builder):

- Raise the input prompt cap (context window slice) so long incoming messages and long persona directives are no longer truncated mid-sentence; switch the chat model call to `google/gemini-2.5-pro` for replies that exceed the short-message threshold, keep `flash` for short ones.
- Expand the memory limit, there's no enough space for it rn.. it should take longer memory.
- Rebuild the system prompt so the persona block is the FIRST and LAST instruction ("You ARE {persona}. Never break character. Never mention being an AI."), and persona-custom directives are injected verbatim with higher priority than generic style rules.
- Inject current local time + part of day (morning/afternoon/evening/late-night) on every call and instruct the model to use it for greetings, references ("this morning", "tonight"), availability tone, and Night-Mode-aware language — not just for Night Mode gating.
- Enforce the per-contact question cooldown in code, not only in the prompt: if the last AI message to a contact contained a `?`, suppress any new question for the configured cooldown window and have the model produce a statement instead. Track `last_question_at` per contact.

### 3. Contact merging — one row per real person

In `backend/src/whatsapp.js` contact upsert + `src/pages/ContactsPage.tsx` display:

- Move dedup from frontend-only to the backend: when a contact arrives with both `@lid` and `@s.whatsapp.net` variants, or shares a normalized name + last-7-digit phone match, merge them into a single canonical row (prefer `@s.whatsapp.net`), point messages at the canonical id, and soft-hide the alternates.
- Update `ContactsPage` to render only the canonical row by default; the "show alternates" expander stays available but is hidden when only one variant remains after merge.
- Run a one-shot dedup pass on server start to clean up already-duplicated contacts for every existing user (scoped by `user_id`, no cross-user mixing).

### 4. Send reliability for new accounts (voice notes + text "sent on site, nothing on WhatsApp")

In `backend/src/whatsapp.js` send pipeline:

- Before reporting success to the client, await the library's actual `message.id` / ack instead of resolving on enqueue; if the client is in `OPENING`, `PAIRING`, or post-pair sync grace period, queue the send and flush once `READY`, instead of accepting it and dropping it.
- For voice notes specifically: verify the OGG/Opus blob is fully written and re-encode if duration is `0`/header is malformed (common on fresh sessions where ffmpeg path wasn't warmed); fall back to sending as audio document with a clear toast instead of silently failing.
- Surface failures: if ack never arrives within the timeout, mark the message as failed in the DB and emit `message_failed` over SSE so the UI shows a retry affordance instead of a fake "Sent" tick.
- Add structured logs around send → ack → server-store so future "ghost sends" are diagnosable from the admin panel.

### 5. Validation

- Type-check frontend (`tsc --noEmit`).
- Manually walk through: new signup → counters at 0; long inbound message → persona stays in character + time-aware reply + no back-to-back question; contacts list shows one row per person; send text + VN on a fresh-paired account → either confirmed delivered or clearly marked failed.

## Technical notes

- Files touched: `backend/src/auth.js`, `backend/src/index.js`, `backend/src/ai.js`, `backend/src/whatsapp.js`, `backend/src/db.js` (migration for `last_question_at`, canonical contact id), `src/pages/ContactsPage.tsx`, `src/lib/api.ts` (failed-message event type), `src/pages/ConversationsPage.tsx` (failed/retry UI).
- DB changes are additive columns + a one-shot dedup; no destructive drops. Strict `user_id` isolation preserved.
- AI changes stay inside the existing edge/gateway path — no new providers.