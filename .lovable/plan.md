## Plan

1. **Make phone pairing start a proper phone-code session**
   - Update the backend connection starter so it can initialize WhatsApp specifically for phone pairing, not only QR pairing.
   - Pass the entered phone number into the WhatsApp client startup options, so the library exposes the pairing-code callback at the right time.

2. **Make the pairing endpoint recover from the common stuck state**
   - If there is no active client, or the client is still reconnecting/restoring, start a fresh pairing-ready connection before requesting the code.
   - Keep the user’s existing data/history safe; this will only reset the live browser connection when needed.

3. **Fix the dashboard button flow**
   - When the user taps **Get Code**, call the new phone-pairing flow directly instead of first starting a normal QR reconnect and then asking for a code.
   - Keep showing the generated code immediately and keep QR as fallback if phone pairing fails.

4. **Improve feedback**
   - Return clearer backend errors for invalid phone numbers, already-connected sessions, or WhatsApp Web refusing a pairing code.
   - Avoid leaving the UI stuck on “Generating...” when the backend cannot produce a code.

## Technical notes

- Main files: `backend/src/whatsapp.js`, `backend/src/api.js`, `src/pages/DashboardPage.tsx`.
- The likely root issue is that the current frontend starts a normal QR-mode reconnect before requesting the phone code. The backend then calls `requestPairingCode()` on a client that was not initialized for phone-number pairing, so the code callback may never be available or may fail.
- I’ll preserve existing session/storage behavior and the current QR login path.