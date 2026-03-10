

# Add AI-Powered "Enhance" Button Using OpenAI

## Overview
Add an **✨ Enhance** button that uses OpenAI's GPT API to intelligently rewrite text so it sounds natural and human when spoken by ElevenLabs v3. The AI will add expression tags, natural pauses, conversational tone, and emotional reactions — far better than rule-based text manipulation.

## How It Works

1. User writes text in Voice Studio
2. Taps **✨ Enhance** 
3. Text is sent to a new backend endpoint (`/api/enhance`)
4. Backend calls OpenAI API with a specialized prompt that rewrites the text for spoken delivery
5. Enhanced text replaces the original (with **Undo** option)

## Changes

### 1. Backend: `backend/src/api.js`
Add a new `POST /api/enhance` endpoint:
- Reads `openai_api_key` from config/env (same pattern as ElevenLabs key)
- Sends text to OpenAI with a prompt instructing it to:
  - Rewrite for natural spoken delivery
  - Add ElevenLabs v3 tags (`[laughing]`, `[sighing]`, `[whispering]`, `...`, `—`)
  - Use contractions, fillers, and conversational phrasing
  - Preserve the original meaning
- Returns the enhanced text as JSON

### 2. Frontend: `src/pages/VoiceStudioPage.tsx`
- Add **✨ Enhance** button next to the character count (below textarea)
- Shows loading state while AI processes
- On success, replaces text and stores original for undo
- Add small **↩ Undo** button to revert to original text
- Only visible when v3 model is selected (tags only work with v3)

### 3. Frontend: `src/lib/api.ts`
- Add `enhanceText(text: string): Promise<{ enhanced: string }>` method

### 4. Settings: `src/pages/SettingsPage.tsx`
- Add OpenAI API key field (same pattern as ElevenLabs key field)

```text
┌─────────────────────────────────┐
│ Text to speak                   │
│ ┌─────────────────────────────┐ │
│ │ Hey I wanted to tell you    │ │
│ │ something important         │ │
│ └─────────────────────────────┘ │
│ 42 chars  [✨ Enhance] [↩ Undo]│
└─────────────────────────────────┘

After Enhance:
"Hey — I wanted to tell you something... 
[sighing] honestly, it's pretty important, you know?"
```

### OpenAI Prompt (backend-side)
```
You rewrite text for natural voice delivery using ElevenLabs v3.
Rules:
- Add expression tags: [laughing], [sighing], [whispering], [gasping], [crying]
- Add natural pauses: ... (long pause), — (short pause)  
- Use contractions (I'm, don't, can't)
- Add subtle fillers where natural (honestly, you know, I mean)
- Keep the same meaning and length roughly similar
- Return ONLY the enhanced text, nothing else
```

