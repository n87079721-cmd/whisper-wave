

## Stop AI from Always Quoting/Replying to Messages

### Problem
Every AI auto-reply uses WhatsApp's "reply-to" (quoted message) feature, dragging the last message into the reply bubble. Real people rarely do this — they just type a new message most of the time.

### Change

**`backend/src/whatsapp.js` (~line 2284)** — Randomize whether the AI quotes the message or sends a plain message:

- ~20% chance: quote/reply to the last message (feels natural occasionally)
- ~80% chance: just send a plain text message with no quote

Apply the same logic in the batch-reply path (~line 2359).

```
// Before sending, randomly decide whether to quote
const shouldQuote = Math.random() < 0.2;
const sent = await sendTextMessage(userId, jid, replyText, { 
  quotedMessageId: shouldQuote ? latestMessageId : null 
});
```

Also update the reply metadata stored in DB — only set `replyToId`/`replyToContent`/`replyToSender` when `shouldQuote` is true.

### Files
- **`backend/src/whatsapp.js`** — Add quote randomization in 2 places (~5 lines each)

