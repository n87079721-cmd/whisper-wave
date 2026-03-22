

## Settings Cleanup: Remove Backend URL, Replace Fresh Re-sync with Sync

### Changes

**1. `backend/src/whatsapp.js`** — Add `triggerSync` to WA interface
- In both `initWhatsApp()` (line 454-462) and `getOrInitWhatsApp()` (line 472-481), add to the returned object:
  ```js
  triggerSync: () => syncContacts(userId, db),
  ```

**2. `backend/src/api.js`** — Add `POST /trigger-sync` route
- Add before the `/clear-session` route (around line 476):
  ```js
  router.post('/trigger-sync', async (req, res) => {
    try {
      const wa = getWA(req);
      wa.triggerSync();
      const state = wa.getState();
      res.json({ success: true, syncState: state.syncState || {} });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  ```

**3. `src/lib/api.ts`** — Add `triggerSync()` method
- Add to the `api` object:
  ```ts
  triggerSync: () => post('/trigger-sync'),
  ```

**4. `src/pages/SettingsPage.tsx`** — Two changes:
- **Remove** the entire Backend URL card (lines 123-139) and related state/handler (`backendUrl`, `backendSaved`, `handleSaveBackendUrl`, and the imports `getStoredApiUrl`, `setStoredApiUrl`, `isBackendConfigured`, `Globe`, `Save`)
- **Replace** the "Fresh Re-sync" card (lines 195-256) with a simple "Sync" card that:
  - Calls `api.triggerSync()` (non-destructive, no session clear, no QR re-scan)
  - Shows the same live sync stats (contacts, messages, unresolved)
  - Button label: "Sync Now" with RefreshCw icon
  - Description: "Re-sync contacts and messages from WhatsApp"
  - No confirmation dialog needed (it's non-destructive)
  - Remove the `resyncing` state, replace with `syncing` state

