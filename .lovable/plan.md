

## Fix Contacts: Load All WhatsApp Contacts + Add Save & Message Options

### Problem
- Contacts page loads only 200 contacts (API limit), but dashboard shows 1950+
- Search only works within those 200 (client-side filtering)
- No quick "message" action on individual contacts
- Need ability to save new contacts manually

### Plan

#### 1. Backend: Raise limit & improve search (`backend/src/api.js`)
- Increase max limit from 1000 to 5000
- Add `jid` column to the search filter so LID-only contacts can be found by name or JID
- Return a `total` count alongside results so the frontend knows how many exist

#### 2. Frontend: Server-side search + load all (`src/pages/ContactsPage.tsx`)
- Fetch contacts with `limit: 5000` to load all WhatsApp contacts at once
- Move search to server-side with debounce (300ms) — calls `api.getContacts({ search, limit: 200 })` so it searches the full database
- Show total count from API response (e.g. "1950 contacts synced")
- Add a "Message" button on each contact row that opens the Send Message page or chat with that contact pre-filled
- Keep the existing "Add" button for saving new contacts manually

#### 3. Frontend API type update (`src/lib/api.ts`)
- Update `getContacts` return type to handle the new `{ contacts, total }` response shape (or keep flat array if we just raise the limit)

### Files to Change
- **`backend/src/api.js`** — Raise max limit to 5000, add `jid` to search, optionally return total count
- **`src/pages/ContactsPage.tsx`** — Load with higher limit, debounced server-side search, add Message button per contact
- **`src/lib/api.ts`** — Minor adjustment if response shape changes

