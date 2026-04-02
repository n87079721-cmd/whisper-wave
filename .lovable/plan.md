

# Updated Plan: Smarter React-Only + Memory Panel UX Fixes

## Three things to address

### 1. Smarter React-Only Logic (backend)
Replace the blind 60/40 coin flip in `shouldAlsoReplyAfterReaction()` with context-aware logic.

**`backend/src/ai.js`** — Update the function signature to accept `unrepliedCount` and `messageText`:
- 2+ unreplied messages → always reply (they're waiting)
- Message contains `?` → always reply
- Message is a conversation-ender ("ok", "lol", "haha", "bet", single emoji, "k", "cool") → 70% react-only
- Otherwise → 85% reply, 15% react-only

**`backend/src/whatsapp.js`** (~line 2278) — Move the unreplied count computation (lines 2291-2295) **before** line 2278, then pass `unrepliedCount` and `latestMsgText` to `shouldAlsoReplyAfterReaction()`.

### 2. Close Memory Panel by Tapping Outside
**`src/pages/ConversationsPage.tsx`** — Convert the inline `showMemoryPanel` div (line 1197) into a proper **Sheet** (slide-out drawer) using the existing `Sheet` component from `src/components/ui/sheet.tsx`. This gives:
- Tap the overlay/outside to close
- Smooth slide-in/out animation
- Proper scrollable content area on all screen sizes
- No landscape-mode issues — Sheet content scrolls within its own viewport

The Sheet will contain the same three sections (AI toggle, Memory textarea, Directive textarea + expiry) but laid out in a full-height scrollable panel that works on any device orientation.

### 3. Settings Panel Responsive Fix
The current memory panel uses `max-h-[60vh]` which clips content on small screens or landscape. By moving to a Sheet, this is solved — the Sheet takes full available height and scrolls internally.

## Files Changed
| File | Change |
|------|--------|
| `backend/src/ai.js` | Context-aware `shouldAlsoReplyAfterReaction(unrepliedCount, messageText)` |
| `backend/src/whatsapp.js` | Move unreplied count before reaction check, pass context |
| `src/pages/ConversationsPage.tsx` | Replace inline memory panel with Sheet component, add close-on-outside-tap |

