

## Investigation: Why the AI Didn't Send the Reply

### What Happened (from the debug log)

1. **05:05:37** — Deborah sent "Still hurting but imma be ok"
2. **05:05:49** — AI generated a reply and scheduled it with a **424-second delay** (~7 minutes)
3. **05:06:02** — Deborah sent another message "Glad you getting some rest babe"
4. **05:06:14** — Smart batching kicked in: **cancelled the first reply** (correct) and started a new batch
5. **After 05:06:14** — The second batch should have generated a new reply... but **nothing happened**

### Root Cause: `ai_reply_chance` (70%)

When the second batch fired `executeAutoReply`, it hit the **reply chance roll** (line 2168-2180 in whatsapp.js). There's a 70% chance to reply, 30% chance to skip. The second attempt likely rolled above 70 and was skipped silently — so the reply was never regenerated or sent.

This is a design flaw: when a valid reply has already been generated and gets cancelled due to a new incoming message, the **replacement attempt should always reply** (100% chance), since we already committed to replying.

### Fix

**In `backend/src/whatsapp.js`** — pass a `forceReply` flag from the batch handler when there was a previously cancelled reply, and skip the reply-chance roll when `forceReply` is true.

Alternatively (simpler): when smart batching cancels an existing pending reply to re-batch, bypass the `replyChance` check on the next `executeAutoReply` call for that contact. This ensures that once the AI "decided" to reply, a follow-up message doesn't randomly cause it to ghost.

### Changes

1. **`backend/src/whatsapp.js`** — Track when a pending reply was cancelled due to re-batching. Pass `forceReply: true` to `executeAutoReply` when the batch includes a cancelled prior reply. Skip the `replyChance` roll when `forceReply` is true.

2. **`src/pages/AdminPage.tsx`** — Fix the "✔ sending now" display to check for `reply_cancelled` entries more reliably (the cancelled entry may arrive after the countdown reaches 0, causing a brief incorrect "sending now" state). Add a small poll/refresh when countdown hits 0 to re-check.

### Summary

The AI **did** try to reply, but smart batching cancelled the first reply when a new message came in. The second attempt then randomly rolled a "skip" on the 70% reply chance. The fix ensures that re-batched replies always go through (100% chance) since the AI already committed to replying.

