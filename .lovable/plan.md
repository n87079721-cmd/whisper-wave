

## Delay AI Reactions to Feel More Natural

### Problem
Currently, the AI reaction (emoji) fires almost immediately (1-3s delay), while the reply takes much longer (typing delay + response delay). This means the reaction always lands well before the reply, which looks unnatural. Real people either react after reading and replying, or react quickly then reply later — but not with a robotic 1-3s reaction every time.

### Change

**`backend/src/whatsapp.js`** — Two locations where reactions are sent (lines ~2206 and ~2181):

**When AI also replies (line ~2206):**
- Move the reaction to fire **after** the reply is sent (inside the typing timer callback, after `sendTextMessage`)
- Add a small random delay after the reply (3-8s) before reacting

**When AI only reacts, no reply (line ~2181):**
- Keep the existing delay (2-7s) — this is fine since there's no reply to coordinate with

**Implementation sketch (reply path, ~line 2206):**
```
// Remove the immediate setTimeout for reaction here
// Instead, store reactionEmoji + latestOriginalMsg on pendingReply
// After sendTextMessage succeeds (~line 2285), send the reaction:
if (pendingReply.reactionEmoji && pendingReply.reactionMsg) {
  const postReplyDelay = Math.floor(Math.random() * 5000) + 3000;
  setTimeout(() => sendReaction(userId, jid, pendingReply.reactionMsg, pendingReply.reactionEmoji), postReplyDelay);
}
```

### Files
- **`backend/src/whatsapp.js`** — Move reaction send to after reply in 1 code path (~10 lines changed)

