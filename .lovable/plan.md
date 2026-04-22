

## Findings

**Directive — works correctly**
- Wrapped at top AND bottom of the system prompt on every reply (`buildContactSystemPrompt`, lines 2028–2030).
- Expiry honored via `directive_expires` check (line 2020).
- Survives across replies (re-read from DB every time, not cached).

**Summary — works, but has gaps**
- Auto-fires after **20+ new messages** since the last summary (per contact).
- Uses correct timezone-stamped date `[Mon DD, YYYY]`.
- Appended (never replaces) to `contacts.memory` — so memory grows over time.
- **Gap 1:** Summary prompt only captures *topics/decisions/tone*. It does NOT extract "questions already asked" or "facts already shared," so the AI has no structured signal to avoid repeating itself.
- **Gap 2:** Memory is injected as plain "things you know" — no instruction telling the model "don't re-ask things in here."
- **Gap 3:** Only triggers on the auto-reply path. Manual-only chats never summarize.
- **Gap 4:** Memory grows unbounded — no compaction, will eventually bloat the prompt.

## Changes

### 1. `backend/src/ai.js` — smarter summary
Update `generateConversationSummary` to also extract:
- **Questions you already asked** (so AI doesn't repeat them)
- **Facts they shared** (name, job, family, plans, preferences)
- **Open loops** (things they said they'd do / you said you'd follow up on)

New summary format:
```
[Apr 22, 2026] <2-3 sentence narrative>
Asked: <comma list of questions you already asked>
Knows: <key facts they shared>
Open: <unresolved threads>
```

### 2. `backend/src/whatsapp.js` — anti-repetition framing
In `buildContactSystemPrompt`, change the memory injection from:
> "THINGS YOU KNOW ABOUT THIS PERSON…"

to:
> "MEMORY OF PAST CONVERSATIONS — DO NOT REPEAT QUESTIONS ALREADY ASKED OR ASK FOR INFO ALREADY KNOWN. Build on what's here, don't restart. If they already told you their job/plans/feelings, reference them naturally instead of asking again."

### 3. `backend/src/whatsapp.js` — also summarize on inbound (not just auto-reply)
Move the `triggerConversationSummary` call so it also fires when a message arrives in a chat where AI auto-reply is OFF, so manual chats still build memory.

### 4. `backend/src/whatsapp.js` — memory compaction
When `contacts.memory` exceeds ~4000 chars, ask GPT-4o-mini to compact it into a single consolidated block (keeps Asked/Knows/Open lists deduped, keeps last 3 dated narratives). Triggered inside `triggerConversationSummary` after appending.

### 5. Applies to all accounts
All logic is keyed by `user_id` already — admins and regular users get the same behavior automatically. No role-specific code paths.

## Files
- `backend/src/ai.js` — upgrade summary prompt + add `compactMemory()` helper
- `backend/src/whatsapp.js` — stronger memory framing, summarize on inbound regardless of auto-reply, call compaction

## Out of scope
- No UI changes to the Memory & AI Settings drawer (the existing textarea already shows the richer summary).
- No DB migration (uses existing `memory`, `last_summary_at` columns).

