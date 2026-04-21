

## Goal
Replace the hardcoded "default" background sounds (cafe, rain, etc.) with the user's **extracted/uploaded sounds only**, and add inline play/preview buttons next to every sound in the picker — both in **AI Voice Notes settings** and **Voice Studio**. Applies to all accounts.

## Changes

### 1. Backend (`backend/src/api.js`)
- Audit the `/voice-studio/sounds` (or equivalent) endpoint that lists background sounds.
- Remove any hardcoded preset list (cafe, rain, street, etc.).
- Return **only** the user's extracted sounds from the sounds storage directory / DB table.
- Ensure each sound entry includes: `id`, `name`, `url` (streamable), `duration`.

### 2. Backend (`backend/src/whatsapp.js`)
- In `decideVoiceNote` / voice-note generation, if `bgSound` resolves to a preset name that no longer exists, treat as `none` (no background) instead of erroring.
- Validate the chosen sound ID belongs to the user's extracted library before mixing.

### 3. Frontend — Settings page (`src/pages/SettingsPage.tsx`)
- In the **AI Voice Notes → Default background sound** dropdown:
  - Remove all preset options (cafe, rain, etc.).
  - Show only extracted sounds fetched from backend.
  - Add a ▶️ **Play** button next to each option in the dropdown (preview before selecting).
  - After selecting, show a ▶️ **Play selected** button next to the dropdown trigger so the user can replay the chosen sound.
  - If the user has zero extracted sounds, show: *"No sounds yet — extract one in Voice Studio."* with a link.

### 4. Frontend — Voice Studio (`src/pages/VoiceStudioPage.tsx`)
- Same treatment: remove preset background sounds (cafe, etc.) from the picker.
- Show only extracted sounds.
- Inline ▶️ play button next to each sound option, plus a play button on the currently selected sound.

### 5. Audio playback helper
- Add a small reusable `useSoundPreview` hook (or inline `<audio>` ref) that:
  - Plays one sound at a time (stops previous on new play).
  - Toggles play/pause on the same button.
  - Shows ⏸ icon while playing.

### 6. Scope
- Applies globally — all users and admin accounts use the same logic. No role gating; the sounds list is naturally per-user (each user sees their own extracted library).

## Files to edit
- `backend/src/api.js` — strip presets from sounds endpoint
- `backend/src/whatsapp.js` — graceful fallback when bg sound missing
- `src/pages/SettingsPage.tsx` — extracted-only picker + preview buttons
- `src/pages/VoiceStudioPage.tsx` — extracted-only picker + preview buttons
- `src/lib/api.ts` — ensure sounds fetcher returns URLs for playback

## Out of scope
- No changes to extraction flow itself (already works in Voice Studio).
- No DB migrations needed (presets were hardcoded, not stored).

