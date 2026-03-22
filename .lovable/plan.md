

## WhatsApp-Style UI Redesign with Light/Dark Mode

### What we're building

A complete visual overhaul modeled on WhatsApp Web's layout (as shown in your screenshot), with light and dark mode support, profile picture avatars, and a cleaner, more professional feel across all pages.

### Design reference

The WhatsApp Web screenshot shows:
- Left sidebar: search bar, filter chips (All/Unread/Favourites/Groups), conversation list with profile pictures, name, timestamp, and message preview
- Right panel: empty state with branding when no chat selected, full chat view when selected
- Clean white/light background with subtle borders
- Green accent color for active elements

### Changes

**1. Add light mode + dark mode toggle**

- Add a proper light theme to `src/index.css` with WhatsApp-accurate colors (white backgrounds, light gray cards, green accents)
- Dark mode stays as current theme but refined
- Default to light mode, add a toggle in the sidebar and settings
- Store preference in localStorage

Light mode palette:
- Background: white (#ffffff)
- Sidebar/header: #f0f2f5
- Chat area: #efeae2 (WhatsApp doodle bg)
- Sent bubble: #d9fdd3
- Received bubble: #ffffff
- Primary accent: #00a884 (WhatsApp green)
- Text: #111b21

**2. Redesign the Conversations page to match WhatsApp Web**

- Left panel: proper WhatsApp-style conversation list
  - Profile picture circles (with avatar_url if available, initials fallback with colored backgrounds)
  - Name bold, timestamp right-aligned
  - Last message preview below name
  - Active conversation highlighted with subtle background
  - Search bar at top with WhatsApp styling
- Right panel: chat view
  - Header with profile pic, name, phone number
  - WhatsApp doodle background pattern
  - Proper chat bubbles: sent = green tint with tail, received = white with tail
  - Timestamps inside bubbles, check marks for sent status
  - Input bar at bottom with rounded input field
- Empty state when no chat selected (like WhatsApp Web shows)

**3. Redesign the sidebar (desktop) and bottom nav (mobile)**

- Sidebar: cleaner WhatsApp-style with icon-only or slim text
- Add theme toggle button (sun/moon icon)
- Bottom nav: keep current structure but match the new color scheme

**4. Profile pictures / avatars**

- Use `avatar_url` from contacts when available
- Generate consistent colored circle with initials as fallback (hash contact name to pick from a set of WhatsApp-like colors)
- Apply everywhere: conversation list, chat header, contacts page, new chat picker

**5. Dashboard page cleanup**

- Simplify to a cleaner card layout that fits the new theme
- Remove excessive motion animations that cause glitchy feel
- Keep sync status and connection controls, but styled consistently

**6. Contacts page styling**

- Match the conversation list style with avatars
- Clean card-free list layout like WhatsApp's contact picker

### Files to change

- `src/index.css` — add light theme variables, refine dark theme
- `tailwind.config.ts` — no structural changes needed
- `src/components/DashboardSidebar.tsx` — add theme toggle, style updates
- `src/components/MobileBottomNav.tsx` — theme-aware styling
- `src/pages/ConversationsPage.tsx` — full WhatsApp Web-style redesign
- `src/pages/ContactsPage.tsx` — avatar colors, cleaner list
- `src/pages/DashboardPage.tsx` — cleaner cards, remove excessive motion
- `src/pages/Index.tsx` — pass theme context
- `src/hooks/useTheme.ts` — new hook for light/dark toggle
- `src/lib/avatarColors.ts` — new utility for consistent avatar color generation

### Technical notes

- Theme toggle uses `class` strategy already configured in tailwind (`darkMode: ["class"]`)
- Current CSS only defines dark variables; we add `:root` as light and `.dark` as the current dark values
- Avatar colors: hash the contact name/jid to pick from ~12 predefined WhatsApp-like colors for consistent per-contact coloring
- No new dependencies needed
- All existing functionality (send, receive, voice, new chat, sync banners) preserved — this is purely visual

