

## Plan: Per-Contact AI Personas (Custom Prompts per Contact)

### What This Adds

A "Prompt Library" where you create named character personas (e.g. "Jeff Dunham", "Peanut", "Achmed"), then assign any persona to specific contacts. When the AI replies to that contact, it uses that persona's prompt instead of the global one.

### How It Works

1. **New DB table `prompts`** — stores reusable persona templates
2. **New DB column on `contacts`** — `prompt_id` links a contact to a specific persona
3. **When generating a reply** — check if the contact has an assigned `prompt_id`, use that prompt instead of the global `ai_system_prompt`
4. **New UI section in Settings** — "Prompt Library" to create/edit/delete personas
5. **Contact-level assignment** — in the contact info or conversations view, a dropdown to pick which persona that contact uses

### Database Changes (`backend/src/db.js`)

New table:
```sql
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Add column to contacts:
```sql
ALTER TABLE contacts ADD COLUMN prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL;
```

### Backend API (`backend/src/api.js`)

New endpoints:
- `GET /api/prompts` — list all prompts for the user
- `POST /api/prompts` — create a new prompt `{name, content}`
- `PUT /api/prompts/:id` — update a prompt
- `DELETE /api/prompts/:id` — delete a prompt
- `PUT /api/contacts/:id/prompt` — assign a prompt to a contact `{promptId}` (or `null` to unset)

### Auto-Reply Logic (`backend/src/whatsapp.js`)

In `executeAutoReply`, after fetching the contact, check if the contact has a `prompt_id`. If so, fetch that prompt's content and use it as `systemPrompt` instead of the global one:

```javascript
// Replace the current global prompt lookup with:
const contact = db.prepare("SELECT prompt_id FROM contacts WHERE id = ? AND user_id = ?").get(contactId, userId);
let systemPrompt = '';
if (contact?.prompt_id) {
  const promptRow = db.prepare("SELECT content FROM prompts WHERE id = ? AND user_id = ?").get(contact.prompt_id, userId);
  systemPrompt = promptRow?.content || '';
}
if (!systemPrompt) {
  const globalRow = db.prepare("SELECT value FROM config WHERE user_id = ? AND key = 'ai_system_prompt'").get(userId);
  systemPrompt = globalRow?.value || '';
}
```

### Frontend Changes

**Settings Page (`src/pages/SettingsPage.tsx`):**
- New "Prompt Library" section below the existing system prompt
- List of saved personas with name + preview
- Create/edit/delete buttons
- The global prompt remains as the "default fallback"

**Conversations Page (`src/pages/ConversationsPage.tsx`):**
- In the chat header or contact info area, add a small dropdown/chip showing which persona is assigned
- Clicking it opens a selector to pick from the prompt library or "Default"

**API client (`src/lib/api.ts`):**
- Add `getPrompts()`, `createPrompt()`, `updatePrompt()`, `deletePrompt()`, `setContactPrompt()`

### About "Looking Up Info"

The AI cannot currently browse the web. It relies on what's in its training data and the conversation context. For a Jeff Dunham persona, the prompt itself would contain all the character details. The AI model (GPT-4o) already knows about public figures like Jeff Dunham from its training data — the prompt just needs to tell it to act as that character.

### Example Jeff Dunham Prompt

A pre-built "Jeff Dunham" persona would be included as a starter template:

> *"You are Jeff Dunham, the world-famous ventriloquist and comedian. You're known for your characters like Peanut, Walter, Achmed the Dead Terrorist, Bubba J, and José Jalapeño. You're witty, sharp, and love making people laugh. You sometimes slip into your characters mid-conversation..."*

### Files Changed

- **backend/src/db.js** — Add `prompts` table, add `prompt_id` column to contacts
- **backend/src/api.js** — CRUD endpoints for prompts + contact prompt assignment
- **backend/src/whatsapp.js** — Per-contact prompt lookup in `executeAutoReply`
- **src/lib/api.ts** — New API methods
- **src/pages/SettingsPage.tsx** — Prompt Library UI
- **src/pages/ConversationsPage.tsx** — Per-contact persona selector in chat

