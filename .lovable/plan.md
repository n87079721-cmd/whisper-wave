

# AI Auto-Reply System

## Overview
When the automation toggle is ON, incoming WhatsApp messages will trigger an AI-powered auto-reply. The bot reads the full conversation history from SQLite before every reply, ensuring contextual responses. When OFF, messages are received and stored but never auto-replied to.

## Architecture

```text
Incoming message (Baileys notify, !isFromMe, !isGroup)
    │
    ▼
Check config: automation_enabled === 'true'?
    │ no → stop (manual mode)
    │ yes
    ▼
Load last 50 messages for this contact from SQLite
    │
    ▼
Call OpenAI (gpt-4o-mini) with conversation as context
  + configurable system prompt from config table
    │
    ▼
Send reply via WhatsApp, save to DB
```

## Changes

### 1. New file: `backend/src/ai.js`
- `generateReply(apiKey, messages, systemPrompt, contactName)` function
- Calls OpenAI `gpt-4o-mini` with the conversation history mapped to user/assistant roles
- Uses the system prompt from config (or a sensible default: "You are [user]. Reply naturally based on the conversation.")
- Returns the reply text string

### 2. Backend: `backend/src/whatsapp.js`
- In the `messages.upsert` handler, after saving the message and inside the `type === 'notify' && !isFromMe` block:
  - Check `automation_enabled` config flag from DB
  - Skip group chats (`jid.endsWith('@g.us')`)
  - Apply a 5-second per-contact cooldown (in-memory Map) to prevent loops
  - Load last 50 messages for the contact from SQLite
  - Call `generateReply()` with the OpenAI key from config
  - Send the reply via `sendTextMessage()` and save it to the messages table
  - Log errors gracefully without crashing

### 3. Frontend: `src/pages/SettingsPage.tsx`
- When automation is toggled ON, expand the section to show:
  - A textarea for the **AI System Prompt** (saved as `ai_system_prompt` in config)
  - Helper text explaining what the prompt does
  - A note that it uses the OpenAI API key configured above
- Load/save the system prompt via existing `api.getConfig`/`api.setConfig`

### 4. No new dependencies needed
- OpenAI is called via raw `fetch` (already done in the enhance endpoint)
- No new npm packages required

## Safety Guards
- 5-second cooldown per contact (in-memory) prevents rapid-fire/loop replies
- Group chats ignored entirely
- Self-messages (`isFromMe`) already filtered
- Max 50 messages context to control API costs
- Graceful error handling: failed AI calls logged, never crash the bot
- Toggle OFF = zero auto-reply behavior

