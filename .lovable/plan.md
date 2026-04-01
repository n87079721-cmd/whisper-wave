

## Enable AI to Understand Incoming Voice Notes

### What This Does
When someone sends a voice note, the system will transcribe it to text so the AI knows what the person said and can respond naturally — instead of just seeing "🎤 Voice message."

### How It Works

1. **Intercept incoming voice notes** (`backend/src/whatsapp.js`, ~line 1441)
   - When an incoming message is type `ptt`/`audio`, download the media buffer
   - Send the audio to a transcription API before passing it to the AI

2. **Add transcription function** (`backend/src/elevenlabs.js`)
   - New `transcribeAudio(audioBuffer)` function
   - Calls ElevenLabs Scribe API (`POST https://api.elevenlabs.io/v1/speech-to-text`) with the audio file
   - Returns the transcribed text

3. **Feed transcription to AI context** (`backend/src/whatsapp.js`, auto-reply logic)
   - Replace `🎤 Voice message` content with the actual transcribed text like `🎤 [Voice note]: "hey are you coming tonight?"`
   - The AI system prompt already handles text — it will now naturally respond to what was actually said

4. **Add ElevenLabs API key config** (`backend/src/.env`)
   - Reuse the existing `ELEVENLABS_API_KEY` already configured for TTS

### Technical Detail
- ElevenLabs Scribe v2 supports OGG/Opus (WhatsApp's native voice format) — no conversion needed
- Transcription adds ~1-2s latency per voice note, which is fine since reply delays are already randomized
- Fallback: if transcription fails, fall back to `🎤 Voice message` so nothing breaks

### Files
- **`backend/src/elevenlabs.js`** — Add `transcribeAudio()` function (~20 lines)
- **`backend/src/whatsapp.js`** — Call transcription on incoming voice messages and pass result to AI (~15 lines changed in 2 locations)

