## Plan

1. Fix phone-number linking so it generates a real WhatsApp pairing code
   - Change the backend flow so phone linking starts a fresh pairing-mode WhatsApp browser session instead of reusing the normal QR-only session.
   - Initialize `whatsapp-web.js` with `pairWithPhoneNumber.phoneNumber` and capture the generated code from the library callback.
   - Return only when an actual pairing code is available; otherwise show a clear error instead of saying a request was sent.
   - Keep QR login working as the fallback, but do not present phone linking as successful unless a code is generated.

2. Update the Dashboard phone-link UI copy
   - Replace “Pairing request sent” style wording with code-only wording.
   - Keep the code visible and easy to copy/read once generated.

3. Fix Voice Studio on mobile and small screens
   - Make the Voice Studio page use the full available width on mobile instead of a narrow/hidden layout.
   - Add enough safe-area bottom spacing inside the page and preview panel so Preview, Generate, recipient selector, Send, and Discard remain above the bottom menu on all devices.
   - Convert the preview action row and recipient dropdown into mobile-safe stacking/wrapping layout so controls do not sit behind the Home/Chats/Status/Contacts menu.

4. Validate the relevant paths
   - Run a targeted type/check test for the changed frontend/backend code.
   - Inspect the mobile layout at the current phone-sized viewport to confirm the Voice Studio actions are visible without rotating the device.

## Technical notes

- Backend files likely touched: `backend/src/whatsapp.js`, possibly `backend/src/api.js`.
- Frontend files likely touched: `src/pages/DashboardPage.tsx`, `src/pages/VoiceStudioPage.tsx`, possibly `src/pages/Index.tsx` if global bottom spacing still needs adjustment.