

## Plan: Custom Background Sounds from Video + Volume Control + Sound Library

### What we're building
Add a **Background Sound** section to Voice Studio with three capabilities:
1. Select from preset AI-generated sounds (cafe, rain, etc.) — already supported in backend, just needs UI
2. **Upload a video/audio file**, extract its audio, and save it as a reusable custom background sound
3. **Volume slider** to control how loud the background sound is (0%–100%)
4. All custom sounds are **persisted** and appear in a personal library for reuse

### Changes

**1. Backend: Custom sound upload + extraction** (`backend/src/api.js`)
- New `POST /api/sounds/upload` endpoint — accepts video/audio file via multer
- Uses ffmpeg to extract audio → saves as `custom-{uuid}.mp3` in `backend/data/sounds/`
- Stores metadata (name, duration, userId) in a `custom_sounds` SQLite table
- New `GET /api/sounds` — returns preset list + user's custom sounds
- New `DELETE /api/sounds/:id` — removes a custom sound

**2. Backend: Volume-aware mixing** (`backend/src/elevenlabs.js`)
- `getBackgroundSound()` — also resolve `custom-xxx` IDs by checking the sounds directory
- `mixAudioWithBackground()` — accept `bgVolume` param (0.0–1.0) instead of hardcoded `0.15`
- `generateVoiceNote()` and `generatePreviewAudio()` — pass through `bgVolume`

**3. Backend: Routes update** (`backend/src/api.js`)
- `/api/voice/preview` and `/api/send/voice` — accept `bgVolume` in request body, pass to elevenlabs

**4. Backend: DB table** (`backend/src/db.js`)
- Add `custom_sounds` table: `id, user_id, sound_id, name, filename, duration, created_at`

**5. Frontend: API helpers** (`src/lib/api.ts`)
- `uploadCustomSound(file: File, name: string)` — POST multipart to `/api/sounds/upload`
- `getSounds()` — GET `/api/sounds`
- `deleteSound(id)` — DELETE `/api/sounds/:id`
- Update `previewVoice` and `sendVoice` to pass `bgVolume`

**6. Frontend: Background Sound UI** (`src/pages/VoiceStudioPage.tsx`)
- New "Background Sound" section between text input and Generate button
- Row of preset sound chips (None, Cafe, Rain, Street, etc.)
- "Upload Custom" button — file picker for video/audio → calls upload endpoint → adds to library
- Custom sounds listed as chips with an X to delete
- Volume slider (0%–100%, default 15%) below the sound selector
- State: `backgroundSound`, `bgVolume`, `customSounds[]`
- Pass `backgroundSound` and `bgVolume` to `previewVoice()` and `sendVoice()`

### UI Layout
```text
Background Sound
[None] [☕ Cafe] [🌧 Rain] [🏙 Street] [🌳 Nature] ...
[🎵 My Recording 1 ✕] [🎵 Meeting Audio ✕] [+ Upload]

Volume: ─────●──────── 15%
```

### Files to modify
1. `backend/src/db.js` — add `custom_sounds` table
2. `backend/src/elevenlabs.js` — resolve custom sounds, accept bgVolume
3. `backend/src/api.js` — upload/list/delete sound endpoints, pass bgVolume to voice routes
4. `src/lib/api.ts` — new API methods + bgVolume param
5. `src/pages/VoiceStudioPage.tsx` — background sound selector, upload, volume slider

