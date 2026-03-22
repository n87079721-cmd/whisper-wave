

## View WhatsApp Statuses (Stories)

### Overview
Add a "Status" tab that displays WhatsApp status updates (stories) from your contacts — text, image, and video statuses — similar to how WhatsApp shows them.

### Backend Changes

**1. New `statuses` table (`backend/src/db.js`)**
- Columns: `id`, `user_id`, `sender_jid`, `sender_phone`, `sender_name`, `content` (text or caption), `media_type` (text/image/video), `media_path` (saved file path), `timestamp`, `expires_at` (24h after timestamp)
- Auto-cleanup of expired statuses on fetch

**2. Capture status messages (`backend/src/whatsapp.js`)**
- In `messages.upsert` handler, instead of skipping `status@broadcast`, capture those messages into the `statuses` table
- Download media (images/videos) to `data/status-media/` using `sock.downloadMediaMessage()`
- Extract sender info from `msg.key.participant` (the person who posted the status)

**3. New API routes (`backend/src/api.js`)**
- `GET /api/statuses` — returns all non-expired statuses grouped by sender
- `GET /api/status-media/:id` — serves saved media files
- Cleanup expired statuses (>24h) on each fetch

### Frontend Changes

**4. New `StatusPage.tsx`**
- Grouped by contact: each contact who posted a status shown as a row with their name and time
- Tapping a contact opens a full-screen status viewer (like WhatsApp):
  - Text statuses shown as colored cards
  - Image/video statuses shown full-screen with caption overlay
  - Progress bar at top, tap left/right to navigate between statuses
  - Auto-advance after 5 seconds for images/text

**5. Navigation updates**
- Add `'status'` to the `Page` type union in `Index.tsx`, `DashboardSidebar.tsx`, `MobileBottomNav.tsx`
- Use `CircleDot` icon from lucide-react
- Place between "Chats" and "Contacts" in nav order

### Technical Details

- Status media is downloaded via Baileys' `downloadMediaMessage()` and saved to disk since WhatsApp media URLs expire quickly
- Statuses auto-expire after 24h matching WhatsApp behavior
- The sender JID for statuses comes from `msg.key.participant` since `remoteJid` is always `status@broadcast`
- Only statuses from known contacts will show names; others show phone numbers using the existing `contactDisplay` utility

