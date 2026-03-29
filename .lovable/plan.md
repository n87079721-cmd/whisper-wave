

## Plan: Fix Sound Library + Add Audio Trimming Editor

### Issues identified
1. **Uploading a second sound breaks the first** — after upload, `setBackgroundSound(lastSoundId)` auto-selects the new one, but the real bug is the sound stream endpoint doesn't require auth, so it works. The actual issue: when uploading multiple sounds, the `custom-` prefix in `soundId` combined with `getSoundStreamUrl` works fine, but the **first sound stops working** because the file list refresh replaces state and the selected `backgroundSound` ID may not match. Need to verify IDs are stable across refreshes.

2. **Can't edit/crop/adjust sounds** — the pencil icon only renames. Need a real audio trimmer UI with waveform visualization and start/end handles.

3. **3-second delay on play** — the stream endpoint works but the browser needs to download the full file before playing. Fix: add `Content-Length` header and support range requests for instant streaming.

4. **Background sound not actually mixed into VN** — the mixing logic in `elevenlabs.js` looks correct (ffmpeg amix filter). Need to verify the `backgroundSound` param is passed through the API chain correctly.

5. **"Adjust" button does nothing** — there's no adjust button in the current code, only Pencil (rename) and X (delete). The user expects an editing interface.

### Changes

**1. Fix sound streaming for instant playback** (`backend/src/api.js`)
- Add `Content-Length` and `Accept-Ranges` headers to `/sounds/:soundId/stream`
- Support HTTP Range requests so the browser can start playing immediately without downloading the full file

**2. Fix multiple upload stability** (`src/pages/VoiceStudioPage.tsx`)
- After uploading multiple files, refresh the sound list and preserve previously selected sound if it still exists
- Don't auto-select the last uploaded sound — keep current selection unless user had "none" selected

**3. Add audio trim/crop editor** (`src/pages/VoiceStudioPage.tsx` + `backend/src/api.js`)
- Frontend: When user taps a sound's edit icon, open a trim modal with:
  - A simple waveform or time bar showing the sound duration
  - Two draggable handles (start time, end time) to select a portion
  - Play button to preview the trimmed section
  - "Save Trim" button that sends the trim range to the backend
- Backend: New endpoint `POST /api/sounds/:id/trim` accepting `{ start: number, end: number }` in seconds
  - Uses ffmpeg to trim: `ffmpeg -i input.mp3 -ss {start} -to {end} -c:a libmp3lame -b:a 128k output.mp3`
  - Overwrites the existing file and updates the duration in the DB
  - Returns updated duration

**4. Verify background sound is passed through API** (`backend/src/api.js`)
- Check `/send/voice` and `/voice/preview` routes pass `backgroundSound` and `bgVolume` to `generateVoiceNote` / `generatePreviewAudio`
- The code already does this — the issue may be that preset sounds haven't been generated yet (first use triggers ElevenLabs Sound Effects API). Add better error logging.

**5. Add preset sound preview** (`src/pages/VoiceStudioPage.tsx` + `backend/src/api.js`)
- Allow playing preset sounds too (not just custom)
- Backend: extend stream endpoint to also serve preset sounds from the sounds directory
- Frontend: add play button to preset sound chips

### Files to modify
1. `backend/src/api.js` — fix stream endpoint (range requests, Content-Length), add trim endpoint, extend preset streaming
2. `src/pages/VoiceStudioPage.tsx` — add trim modal UI, fix upload behavior, add preset preview buttons
3. `src/lib/api.ts` — add `trimSound(id, start, end)` API method

