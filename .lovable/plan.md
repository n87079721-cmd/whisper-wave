

## Fix: AI Can't See or Reply to Voice Notes

### Problem
Voice notes are being transcribed correctly and saved to the database, but the AI never sees them because:

1. **SQL filter excludes voice messages** — the query that builds conversation history only fetches `type IN ('text', 'image')`, so voice notes (type `'voice'`) are completely invisible to the AI.
2. **Debug log shows blank body** — it reads `originalMsg.body` (the raw WhatsApp message, which is empty for voice notes) instead of the transcribed content from the DB.

### Fix

**`backend/src/whatsapp.js`** — 3 small changes:

1. **Line ~2214** — Add `'voice'` to the SQL type filter so transcribed voice notes appear in conversation history:
   ```sql
   WHERE ... AND type IN ('text', 'image', 'voice') ...
   ```

2. **Line ~2119** — Update the debug log to show transcribed content for voice notes. Pass `resolvedContent` to `handleAutoReply` so the debug log and batch entry can use it:
   - Add `resolvedContent` as a parameter to `handleAutoReply` (line ~1268)
   - Use it in the debug log body field (line ~2119)
   - Use it in the batch entry content (line ~2146) and for `shouldReact` calls (lines ~2199, ~2224)

3. **Lines ~2199, ~2224** — Use the DB-stored content (which has the transcription) for `shouldReact()` instead of the raw empty `originalMsg.body`.

### Files
- **`backend/src/whatsapp.js`** — Add `'voice'` to SQL filter, pass transcribed content through auto-reply pipeline (~6 lines changed across 4 locations)

