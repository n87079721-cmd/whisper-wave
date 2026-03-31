

## Plan: Smart Batching — Cancel In-Progress Replies on New Messages

### What's Happening Now

When someone texts and the AI starts its delay/typing phase, a follow-up message 2 minutes later triggers `clearPendingAutoReply` which cancels the old reply, but then starts a whole new 12-second batch timer + AI generation + delay cycle. The old reply is wasted, and the new generation may only focus on the latest message instead of addressing everything unreplied.

### Changes

#### 1. Add abort flag to pending replies (`backend/src/whatsapp.js`)

In `clearPendingAutoReply`, set an `aborted = true` flag on the pending reply object before deleting it. In the `delayTimer` and `typingTimer` callbacks (lines ~2228-2280), check `if (pendingReply.aborted) return;` so even if timers fire late, the stale reply won't send.

This is a safety net — the timers are already cleared, but race conditions with async code can cause them to fire anyway.

#### 2. Count unreplied messages and hint the AI (`backend/src/whatsapp.js` + `backend/src/ai.js`)

In `executeAutoReply`, after fetching the last 50 messages, count how many incoming messages appear after the last outgoing message. Pass this count to `generateReply` as an optional parameter.

In `generateReply` (`backend/src/ai.js`), accept an optional `unrepliedCount` parameter. When > 1, append to the system prompt:

```
"The contact sent {N} messages since your last reply. Make sure your response addresses all of them naturally."
```

This ensures the AI reads and responds to ALL unreplied messages in one go, not just the latest.

#### 3. Signature change for `generateReply`

```javascript
// backend/src/ai.js
export async function generateReply(apiKey, messages, systemPrompt, contactName, { unrepliedCount } = {}) {
  // ... existing code ...
  // Add to system prompt when unrepliedCount > 1:
  // "The contact sent N messages since your last reply. Address all of them."
}
```

### Files Changed

- **backend/src/whatsapp.js** — Add `aborted` flag in `clearPendingAutoReply`; check it in timer callbacks; count unreplied messages in `executeAutoReply` and pass to `generateReply`
- **backend/src/ai.js** — Accept `unrepliedCount` option; inject hint into system prompt when > 1

