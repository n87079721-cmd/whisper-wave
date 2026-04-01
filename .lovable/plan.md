

## Fix: AI Stops Replying to Multiple People

### Root Cause

There are **two silent return paths** in `executeAutoReply` that exit without any debug logging, making it look like the AI just "stopped":

1. **React-only path (line ~2231-2236)**: When `shouldReact()` returns an emoji AND `shouldAlsoReplyAfterReaction()` returns false (~12% chance), the function sends a reaction, sets the cooldown, and **returns silently** — no debug log, no reply. This likely killed Amy's rebatched reply.

2. **Empty messages path (line ~2221)**: If the DB query returns no messages, it returns with zero logging.

Neither of these is a "real" bug in execution flow — the per-JID keying is correct and contacts don't interfere with each other. But the silent exits make it impossible to diagnose AND they set cooldowns that can block follow-up replies.

### Fix

**`backend/src/whatsapp.js`** — Add debug logging to both silent paths:

1. **Line ~2231-2236** (react-only return): Add a debug log before returning:
   ```js
   debugLog(db, userId, 'react_only_no_reply', { 
     contact: contactName || phone, emoji: reactionEmoji 
   });
   ```

2. **Line ~2221** (empty messages): Add a debug log:
   ```js
   if (messages.length === 0) {
     debugLog(db, userId, 'skip_no_messages', { contact: contactName || phone });
     return;
   }
   ```

3. **Line ~2231** — When `forceReply` is true (rebatch), **skip the react-only exit** so the AI always sends a text reply for rebatched messages. This prevents the scenario where a cancelled reply gets replaced by just a reaction:
   ```js
   if (!shouldAlsoReplyAfterReaction() && !forceReply) {
   ```

### Files
- **`backend/src/whatsapp.js`** — 3 small changes (~5 lines total)

