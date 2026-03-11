

# Human-Like Timing, Emotions & Availability

## Changes

### 1. Backend: `backend/src/ai.js` — Enhanced System Prompt
Update the default prompt to include emotional depth and natural emoji/reaction usage:
- Express real emotions: excitement, frustration, sarcasm, humor, boredom
- Sometimes react to messages with just an emoji reaction (👀, 😂, 💀, ❤️) instead of a full reply
- Occasionally send voice-note-style short bursts ("wait what", "noo way", "lmaooo")
- Don't reply to every single message — sometimes just react
- Celebrity personality: busy, selective, unbothered but genuine with close people

Also increase `temperature` to 0.85 for more varied/natural responses.

### 2. Backend: `backend/src/whatsapp.js` — Delayed Replies + Availability
Replace the instant reply with human-like timing:

**Random delay before replying:**
- Short incoming messages (< 20 chars): 5–25 seconds
- Medium messages: 15–60 seconds  
- Long messages (100+ chars): 30–120 seconds
- Add WhatsApp "composing" (typing indicator) 2-4 seconds before sending

**Availability system:**
- Active hours check (configurable, default 10:00–23:00)
- Reply probability (configurable, default 70%) — celebrities don't reply to everything
- Message batching: if multiple messages arrive within 10 seconds, wait for them all before replying once

**New config keys:** `ai_active_hours_start`, `ai_active_hours_end`, `ai_reply_chance`, `ai_response_speed`

### 3. Backend: `backend/src/whatsapp.js` — Emoji Reactions
Use Baileys' `sendMessage` with `react` type to occasionally send emoji reactions (👀, 😂, 💀, ❤️, 🔥) on messages — separate from the text reply. ~30% chance to react with an emoji before/instead of replying.

### 4. Frontend: `src/pages/SettingsPage.tsx` — New Controls
When automation is ON, show additional settings:
- **Active Hours**: start/end time inputs (default 10:00–23:00)
- **Reply Chance**: slider 0–100% (default 70%) with label "How often should I reply?"
- **Response Speed**: dropdown — Fast / Normal / Slow (celebrity mode)

### Safety
- All delays use `setTimeout` so they don't block other messages
- Cooldown increased from 5s to match the delay system
- Typing indicator sent via `sock.sendPresenceUpdate('composing', jid)`

