

## Plan: Automation Settings Cleanup + AI Persona Improvements

### What you're asking for
1. **Remove Active Hours section** and **Timezone section** from Settings UI
2. **Hardcode timezone to America/New_York** — when automation is on, it always uses New York time
3. **Skip archived chats** (already done in backend, just confirming)
4. **Improve AI persona** — remove dashes from output, never ask robotic questions, add emotions/tone shifts/human feelings

### Changes

**1. Frontend: Remove Active Hours + Timezone UI** (`src/pages/SettingsPage.tsx`)
- Delete the "Active Hours" section (lines 312-334) — the From/To time pickers
- Delete the "Timezone" section (lines 336-359) — the timezone dropdown
- Remove related state variables (`activeHoursStart`, `activeHoursEnd`, `timezone`) and their `useEffect` config fetches
- Keep Reply Chance, Response Speed, and System Prompt sections intact

**2. Backend: Hardcode New York timezone + remove active hours check** (`backend/src/whatsapp.js`)
- In `isWithinActiveHours()`: hardcode timezone to `'America/New_York'` instead of reading from config
- Actually, since you want to remove the time section entirely: **remove the active hours check altogether** — when automation is ON, it replies 24/7 using New York time for any time-based logic
- OR: hardcode sensible always-on hours. Based on the screenshot, you want to remove the time restriction entirely, so remove the `isWithinActiveHours` call from `handleAutoReply`

**3. Backend: Improve AI default prompt** (`backend/src/ai.js`)
- Strengthen the "never ask AI-like questions" rule — add explicit examples of what NOT to say
- Add tone shift instructions: "Your mood changes naturally throughout conversations"
- Add emotional depth: "You get genuinely excited, annoyed, nostalgic, tired — show it"
- Emphasize: "NEVER use dashes (— or –) in your messages. Use periods, commas, or just start a new message"
- Add: "Don't ask 'How are you?' 'What do you think?' 'What are your thoughts?' — those are robotic. Instead say things like 'that's wild tho' or 'wait tell me more' or just react"
- Add text filters: use fillers like "like", "honestly", "ngl", "lowkey", "fr fr"

**4. Backend: Strengthen dash removal** (`backend/src/whatsapp.js`)
- Current regex on line 1814 handles `—` and `–` but also catches regular hyphens in words — refine to only strip em/en dashes, not compound words
- Also strip any remaining single `—` or `–` characters

### Files to modify
1. `src/pages/SettingsPage.tsx` — Remove Active Hours + Timezone sections
2. `backend/src/whatsapp.js` — Remove `isWithinActiveHours` check from `handleAutoReply`, hardcode NY timezone for any remaining time logic
3. `backend/src/ai.js` — Rewrite DEFAULT_SYSTEM_PROMPT with stronger human-like rules, emotions, no dashes, no robotic questions

