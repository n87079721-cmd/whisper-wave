

# Making Voice Output Sound More Human

## Problem
The voice output sounds robotic despite using ElevenLabs v3. Two root causes:

1. **Audio quality loss during conversion** — The ffmpeg OGG/Opus conversion uses `-application voip` (optimized for telephony, strips richness) and only 64kbps bitrate, which degrades the natural quality of the v3 output.
2. **Voice settings can be further optimized** — Adding a slight speed reduction (0.95x) and fine-tuning stability/style makes speech more natural and less "perfect" (which paradoxically sounds more human).

## Changes

### 1. Backend: `backend/src/elevenlabs.js`

**Improve voice settings for human-like output:**
- Add `speed: 0.95` — slightly slower speech sounds more natural and thoughtful
- Keep stability low (0.3) for natural variation
- Bump style to 0.8 for maximum expressiveness

**Fix audio conversion quality:**
- Change ffmpeg from `-application voip` to `-application audio` (preserves tonal richness)
- Increase OGG bitrate from 64k to 128k
- These two changes alone will make a significant difference — voip mode aggressively strips frequencies that make voices sound warm and human

### 2. Frontend: `src/pages/VoiceStudioPage.tsx`

- Set default model to `eleven_v3` and move it to the top of the models list (already done)
- Add a "Human Mode" tip in the UI explaining that v3 with these settings produces the most natural output

## Summary of Setting Changes

```text
Before                          After
─────────────────────────────── ───────────────────────────────
stability: 0.3                  stability: 0.3  (unchanged)
similarity_boost: 0.6           similarity_boost: 0.65
style: 0.7                      style: 0.8
speed: (not set, default 1.0)   speed: 0.95
ffmpeg: -application voip 64k   ffmpeg: -application audio 128k
```

