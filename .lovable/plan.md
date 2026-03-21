

## Plan: Fix Connect Button Not Responding

**Problem**: Tapping "Connect" calls `api.reconnect()` silently — no loading indicator, no toast feedback, and errors are swallowed. The user sees no visual response.

**Solution**: Add loading state, user feedback (toasts), and trigger a status refresh after connecting.

### Changes to `src/pages/DashboardPage.tsx`

1. **Add `connecting` state** — `useState(false)` to track when a connect attempt is in progress.

2. **Update `handleConnect`**:
   - Set `connecting = true` before the API call
   - Show a toast on success ("Connecting to WhatsApp...")
   - Show a toast on error with the error message
   - Call `refresh()` from `useWhatsAppStatus` after the call
   - Set `connecting = false` in finally block

3. **Update the Connect button**:
   - Disable while `connecting` is true
   - Show "Connecting..." text with a spinner icon while connecting
   - Also disable during `isReconnecting` (existing behavior)

4. **Destructure `refresh`** from `useWhatsAppStatus()` (already returned by the hook).

### Expected Result
User taps Connect → button shows "Connecting..." with spinner → toast confirms → QR code or connection appears.

