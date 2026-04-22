
## Add Per-Chat Language + Auto-Translate Non-English Inbound to Telegram

Default for every chat (old + new) = **Auto**. You only override per-contact when you want a lock.

---

### What you'll see

**🧠 brain drawer** (per contact):
- New **"Reply Language"** searchable dropdown (~190 languages: ISO 639-1 + Yoruba, Igbo, Hausa, Naija Pidgin, Swahili, Twi, Amharic, Mandarin, Cantonese, etc.).
- Default = **Auto** for every contact (existing + future).
- Pick **English** → AI always replies in English even if they write Yoruba (you still get Telegram translation).
- Pick **French/etc.** → AI always replies in that language regardless of what they write.
- "Clear" resets to Auto.

**Telegram** (whenever inbound text or VN transcript is non-English, regardless of lock setting):
```
🌍 New message from Aisha (Yoruba)

Original:
Báwo ni, ṣé o ti jẹun?

English:
Hi, have you eaten?
```

Your manual Telegram custom replies stay in English — AI uses them as guidance and still respects the contact's language lock when sending.

---

### Defaulting to Auto for ALL accounts

- New column `reply_language TEXT DEFAULT NULL` — `NULL` is treated as **Auto** everywhere in code.
- Because the default is `NULL`, **every existing contact across every account is automatically Auto** the moment the column is added. No backfill, no per-account migration, no toggling needed.
- Newly inserted contacts get `NULL` → Auto by default.
- Frontend treats `null`/missing as Auto in the dropdown.

---

### Technical changes

**Backend — `backend/src/db.js`**
- Add `reply_language TEXT DEFAULT NULL` to `contacts` (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` pattern already used in this file).

**Backend — `backend/src/ai.js`**
- New `detectAndTranslate(apiKey, text)` → `{ language, languageCode, isEnglish, englishTranslation }`. `gpt-4o-mini` JSON mode, ~150 tokens. Skips emoji-only / URL-only / <3-char input.
- `generateReply(...)` accepts `replyLanguage`:
  - `null`/`"auto"` → no lock (current behavior).
  - `"english"` → appends: `🌐 LANGUAGE LOCK: Always reply in English. If the contact wrote in another language, you understood them but reply only in English.`
  - any other → appends: `🌐 LANGUAGE LOCK: Reply in {Language} only, regardless of what language the contact uses. Keep persona, tone, and length rules.`

**Backend — `backend/src/whatsapp.js`**
- Inbound text + VN transcript handler: call `detectAndTranslate` when text qualifies. If `!isEnglish` → `sendForeignLanguageAlert(...)`.
- Pass contact's `reply_language` into every `generateReply` call (auto-reply, Telegram custom-reply, voice paths).
- 5-min in-memory cache of last detected language per contact to avoid redundant detection on bursts.
- Strip `[Voice note]: "…"` prefix before detecting so language read reflects spoken content.

**Backend — `backend/src/telegram.js`**
- New `sendForeignLanguageAlert(db, userId, contactName, original, language, translation)` — same Markdown style as `sendVoiceNoteTranscript`, with 🌍 header + Original/English blocks. Silently skipped if Telegram not configured for user.

**Backend — `backend/src/api.js`**
- `GET /contacts/:id/ai-settings` includes `reply_language`.
- `PUT /contacts/:id/ai-settings` accepts and persists `reply_language` (`null` allowed = Auto).

**Frontend — `src/lib/languages.ts`** (new)
- Exported `{ code, name }[]` covering ISO 639-1 + WhatsApp-common regional/creole entries.

**Frontend — `src/lib/api.ts`**
- Add `reply_language` to `getContactAiSettings` type + `updateContactAiSettings` payload.

**Frontend — `src/pages/ConversationsPage.tsx`**
- New state `contactLanguage` (defaults to `"auto"` when value is `null`).
- New section in 🧠 drawer above "Active Directive":
  - Label: **"Reply Language"**
  - Helper: *"AI will reply in this language. Auto = match contact. English = always reply in English (foreign messages still translated to Telegram)."*
  - Searchable `<select>` with **"Auto"** as first option, then full language list.
  - Save handler reuses existing ai-settings endpoint; sending `"auto"` writes `null`.

---

### Edge cases

- Emoji/URL/<3-char inbound → skip detection (no Telegram noise).
- Detection failure → silent fallback, no alert, AI replies normally.
- English-locked + contact writes Yoruba → AI replies in English, Telegram alert fires.
- French-locked + contact writes English → AI still replies in French (lock wins).
- Auto + contact writes Yoruba → AI replies in Yoruba, Telegram alert still fires (so you see translation).
- Telegram bot not configured → alert silently skipped.
- Cost: one extra `gpt-4o-mini` call (~150 tokens) per qualifying inbound — negligible.

---

### Files touched
- `backend/src/db.js`
- `backend/src/ai.js`
- `backend/src/whatsapp.js`
- `backend/src/telegram.js`
- `backend/src/api.js`
- `src/lib/languages.ts` (new)
- `src/lib/api.ts`
- `src/pages/ConversationsPage.tsx`

After approval I'll implement. Then restart with `cd backend && npm run build && supervisorctl restart wa-controller`. Every existing chat on every account will already be on Auto — no manual reset needed.
