

# Per-Chat Memory, Directives, and AI Toggle

## Features

1. **Per-chat memory** — Persistent notes about a contact (unlimited length, clearable)
2. **Per-chat directive** — Temporary behavior instruction with optional expiry (clearable)
3. **Per-chat AI toggle** — Disable/enable AI auto-reply for specific contacts

## Technical Plan

### 1. Database: Add columns to `contacts` (`backend/src/db.js`)
Add migration in `ensureCurrentTables` for 4 new columns:
- `memory TEXT` — persistent notes
- `active_directive TEXT` — current behavior instruction
- `directive_expires TEXT` — optional expiry datetime
- `ai_enabled INTEGER DEFAULT 1` — per-chat AI toggle (1 = on, 0 = off)

### 2. Backend API: New endpoints (`backend/src/api.js`)
- `PUT /contacts/:id/memory` — save or clear memory (empty string = clear)
- `PUT /contacts/:id/directive` — save or clear directive + optional expiry
- `GET /contacts/:id/memory` — fetch memory + directive + ai_enabled
- `PUT /contacts/:id/ai-toggle` — toggle AI on/off for this contact

### 3. AI Integration (`backend/src/whatsapp.js`)
- In `handleAutoReply` (~line 2136), after the archived check, add: if `ai_enabled = 0` on the contact, skip with debug log `skip_ai_disabled_for_contact`
- In `executeAutoReply` (~line 2207), after building the system prompt, append memory and active directive (if not expired) to the prompt

### 4. Frontend API (`src/lib/api.ts`)
Add methods:
- `getContactMemory(id)` — returns `{ memory, active_directive, directive_expires, ai_enabled }`
- `updateContactMemory(id, memory)`
- `updateContactDirective(id, directive, expires?)`
- `toggleContactAI(id, enabled)`

### 5. Chat UI (`src/pages/ConversationsPage.tsx`)
- Add a **brain icon** (🧠) button in the chat header next to the persona picker
- Clicking it opens a modal/panel with three sections:
  - **Memory** — large expandable textarea + Save + Clear buttons
  - **Active Directive** — textarea + date picker for expiry + Save + Clear buttons
  - **AI Toggle** — switch to enable/disable AI for this chat
- Small indicator dot on brain icon when memory or directive is set
- Load memory/directive/ai_enabled when selecting a contact
- Toast confirmations on save/clear actions

### Files Changed
| File | Change |
|------|--------|
| `backend/src/db.js` | Add 4 columns via ALTER TABLE migration |
| `backend/src/api.js` | Add 4 endpoints |
| `backend/src/whatsapp.js` | Skip if AI disabled; inject memory + directive into prompt |
| `src/lib/api.ts` | Add 4 API methods |
| `src/pages/ConversationsPage.tsx` | Add brain icon + memory/directive/AI panel UI |

