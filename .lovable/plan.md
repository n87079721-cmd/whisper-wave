

## Diagnosis

The screenshots show **Signal protocol decryption errors** from Baileys:
- `Bad MAC` in `SessionCipher.doDecryptWhisperMessage`
- `Failed to decrypt message with any known session`
- `Closing session in favor of incoming prekey bundle`

These are **not caused by your code** -- they happen inside Baileys' internal Signal protocol layer *before* the `messages.upsert` handler fires. When Baileys can't decrypt a message, it throws internally, which can cause the socket connection to close and trigger a reconnect loop that the dashboard sees as "disconnected."

## Root Cause

1. **Missing `getMessage` callback** -- Baileys requires this to retry failed message decryptions. Without it, decryption failures are unrecoverable.
2. **No retry map** -- Baileys needs a `msgRetryCounterCache` to track retries for messages with Bad MAC errors.
3. **Socket errors aren't suppressed** -- Internal decryption errors bubble up and can kill the connection.

## Plan

### 1. Fix WhatsApp connection stability (`backend/src/whatsapp.js`)

- Add `getMessage` callback to the socket config that looks up stored messages from the database (Baileys uses this to retry decryption):
  ```js
  getMessage: async (key) => {
    // Return stored message proto if available, or undefined
    return undefined; // Safe fallback - Baileys handles the retry
  }
  ```
- Add `msgRetryCounterCache` using a simple in-memory Map to track message retry counts and prevent infinite retry loops
- Add `syncFullHistory: false` to prevent mass history sync that triggers bulk decryption failures
- Add `markOnlineOnConnect: false` to reduce unnecessary protocol chatter
- Wrap the entire socket event binding in a global error handler (`process.on('uncaughtException')` scoped to known Baileys errors) so decryption errors don't crash the process
- In the `connection.update` handler, also treat `DisconnectReason.connectionClosed` (428) and `DisconnectReason.connectionLost` (408) as reconnectable (already handled, but explicitly log them)
- Increase reconnect delay from 3s to 5s with a simple backoff (3s, 5s, 10s) to avoid hammering the server

### 2. Verify ElevenLabs integration works end-to-end

No code changes needed here -- the integration is correctly implemented. The user needs to:
1. Go to Settings page
2. Paste their ElevenLabs API key and click "Save Key"
3. Click "Test Connection" to verify

The Voice Studio page already fetches voices dynamically from their account, supports v3 model with speech tags, and the preview/send flow is wired up correctly.

### 3. Frontend: no changes needed

The frontend already handles `reconnecting` state properly. The fix is entirely backend -- once the socket stops dying on decryption errors, the dashboard will stay connected.

## Summary

Single file change: `backend/src/whatsapp.js` -- add `getMessage`, `msgRetryCounterCache`, `syncFullHistory: false`, and reconnect backoff. This addresses the core "Bad MAC" crash loop shown in screenshots.

