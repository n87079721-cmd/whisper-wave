

## Plan: Audio Upload Support + Auto-Delete After Send

### What's changing
1. **Audio files sent as audio, not documents** — currently uploaded audio files (mp3, m4a, ogg, etc.) get classified as "document" because `detectOutgoingMessageType` only checks for image/video. Fix this so audio attachments send as proper audio messages.

2. **Auto-delete audio file from server after sending** — once the audio is successfully sent to WhatsApp, delete the saved file from disk so it doesn't persist on the VPS.

3. **Frontend audio preview** — when an audio file is attached via the + button, show an audio player preview (instead of a document icon) so the user can listen before sending.

### Technical details

**File 1: `backend/src/api.js`**
- In `detectOutgoingMessageType`: add `if (normalized.startsWith('audio/')) return 'audio';`
- In the `/send/media` route: after successful send, if the mimeType is `audio/*`, schedule deletion of the persisted file from `data/message-media/` using `fs.unlinkSync` (or set the media_path to null in the DB so it doesn't try to serve it later)
- The DB record stays (so the message shows in chat history) but the local file is removed

**File 2: `src/pages/ConversationsPage.tsx`**
- In `handleSelectAttachment`: add `audio` as a recognized kind alongside image/video/document
- In the attachment preview area: render an `<audio controls>` element for audio attachments instead of the document preview
- The pending attachment type already includes `kind` — just extend the union type to include `'audio'`

### Files to modify
1. `backend/src/api.js` — detect audio type + delete file after send
2. `src/pages/ConversationsPage.tsx` — audio attachment kind + audio preview player

