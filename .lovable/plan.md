

## Plan: Fix AI Repetition, Add All Message Types to Context, and Typing Detection

### Problems from screenshots
1. **AI sends duplicate replies** — Looking at the Deborah Marie chat, the AI sent two nearly identical "Damn, that sounds rough" messages back-to-back. This happens because the 30-second cooldown is too short, and when the contact sends multiple messages in sequence, each can trigger a separate auto-reply batch.
2. **AI only reads text messages** — The query filters `type = 'text'`, so the AI has no idea about images, voice notes, stickers, or documents shared in conversation. It needs to know about ALL messages to understand context.
3. **No typing detection** — The user wants to see when a contact is typing.

### Changes

**File 1: `backend/src/whatsapp.js`**

1. **Increase cooldown from 30s to 5 minutes** — After sending a reply, block auto-reply to the same chat for 5 minutes. This prevents the rapid-fire duplicate replies seen in the screenshots.

2. **Fetch all message types for context, not just text** — Change the query from `type = 'text'` to include all types. For non-text messages (images, audio, stickers, docs), inject a placeholder description like `[Sent an image]`, `[Sent a voice note]`, `[Sent a sticker]` so the AI understands the full conversation flow.

3. **Add typing event listener** — Listen to `client.on('chat_state_changed')` which fires when contacts start/stop typing. Store the typing state and broadcast it via SSE so the frontend can show a "typing..." indicator.

4. **Add duplicate content check** — Before sending, check if the last 2-3 AI-sent messages contain very similar text (simple string similarity). If so, regenerate or skip.

**File 2: `backend/src/api.js`**

5. **Add typing state to SSE stream** — Include typing events in the SSE broadcast so the frontend receives them in real-time.

**File 3: `src/pages/ConversationsPage.tsx`**

6. **Show "typing..." indicator** — When typing events arrive via SSE for the active chat, display a "typing..." bubble or text below the contact name in the chat header.

### Technical details

**Context query change:**
```sql
-- Before: only text
WHERE type = 'text' AND content IS NOT NULL

-- After: all types
WHERE content IS NOT NULL OR type IN ('image','video','audio','sticker','document','ptt')
```

Then in code, map non-text messages:
```javascript
messages.map(m => {
  if (m.type === 'text') return m;
  const labels = { image: 'an image', video: 'a video', audio: 'a voice note', ptt: 'a voice note', sticker: 'a sticker', document: 'a document' };
  return { ...m, content: `[Sent ${labels[m.type] || 'media'}]` };
})
```

**Typing detection:**
```javascript
client.on('chat_state_changed', (chat, state) => {
  // state: 'typing' or 'available' 
  broadcastToUser(userId, { type: 'typing', jid, isTyping: state === 'typing' });
});
```

**Duplicate prevention:**
Compare new reply against last 3 sent messages using simple word overlap. If >70% similar, request a new generation with "Don't repeat yourself" appended to the prompt.

### Files to modify
1. `backend/src/whatsapp.js` — cooldown increase, all-type context, typing listener, duplicate check
2. `backend/src/api.js` — SSE typing broadcast
3. `src/pages/ConversationsPage.tsx` — typing indicator UI

