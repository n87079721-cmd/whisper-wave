

# iMessage Theme Transformation

Restyle the entire app to look and feel like Apple's iMessage, while keeping all WhatsApp backend functionality intact.

## What Changes

### 1. Color Palette (src/index.css)
Replace the WhatsApp green theme with iMessage colors:
- **Light mode**: White/gray backgrounds, blue (#007AFF) as primary, sent bubbles in iMessage blue with white text, received bubbles in light gray (#E9E9EB)
- **Dark mode**: True black/dark gray backgrounds (#000/#1C1C1E), blue primary, sent bubbles in blue, received bubbles in dark gray (#2C2C2E)
- Remove WhatsApp-specific variables (`wa-teal-dark`), repurpose `wa-bubble-out` to iMessage blue and `wa-bubble-in` to gray

### 2. Typography (src/index.css)
Switch font from Inter to SF Pro Display / system Apple fonts:
```
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
```

### 3. Chat Bubbles (src/pages/ConversationsPage.tsx)
- Sent messages: Blue background (#007AFF), white text, rounded with tail on right
- Received messages: Light gray background, dark text, rounded with tail on left
- Remove the `wa-pattern` background, use flat white/dark background instead
- Status ticks: Use "Delivered"/"Read" text labels like iMessage instead of checkmark icons
- Remove green accent from voice note waveforms, use blue

### 4. Navigation - Sidebar (src/components/DashboardSidebar.tsx)
- Rename "WA Controller" to "Messages" with a blue chat bubble icon
- Use iOS-style active states (blue highlight, SF-style icons)
- Clean white/dark sidebar with subtle separators

### 5. Navigation - Mobile Bottom Nav (src/components/MobileBottomNav.tsx)
- iOS tab bar style: thin top border, frosted glass background
- Blue active tab color, gray inactive

### 6. Dashboard (src/pages/DashboardPage.tsx)
- Replace "WA Controller" branding with "Messages"
- Use blue accent color for stat cards and connection status
- Rounded iOS-style cards with subtle shadows

### 7. Chat List (ConversationsPage.tsx - left panel)
- iOS-style row layout with slightly larger avatars
- Blue unread indicators instead of green
- Swipe-friendly styling, clean dividers between rows

### 8. Empty State (ConversationsPage.tsx)
- Replace WhatsApp pattern with flat background
- Blue message icon, "Messages" title

### 9. Reply Box (ConversationsPage.tsx)
- iOS-style input with rounded capsule shape
- Blue send arrow button
- Voice mode toggle in blue

### 10. Other Pages
- **CallsPage**: Blue missed call indicators (red stays for missed, blue for other calls)
- **ContactsPage**: iOS-style contact list with alphabet sidebar
- **StatusPage**: Keep as-is but with blue accents
- **VoiceStudioPage**: Blue accents throughout

## Files to Modify
1. `src/index.css` — Full color palette + font swap + remove wa-pattern
2. `src/pages/ConversationsPage.tsx` — Bubble colors, status labels, flat chat background
3. `src/components/DashboardSidebar.tsx` — Branding + blue active states
4. `src/components/MobileBottomNav.tsx` — iOS tab bar styling
5. `src/pages/DashboardPage.tsx` — Branding update
6. `src/pages/CallsPage.tsx` — Blue accent colors
7. `tailwind.config.ts` — No structural changes needed (uses CSS variables)

