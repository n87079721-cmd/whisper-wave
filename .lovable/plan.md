

## Fix: Night Mode Not Working + Remove "New York" From Time

### Problems

1. **Night mode doesn't work** — `isWithinActiveHours()` is defined (line 1970) but never called anywhere. No code checks active hours before generating a reply, so the AI replies 24/7.

2. **AI mentions "New York"** — The system prompt (ai.js line 238) includes `(${timeLabel}, New York time)` which the AI parrots when asked about the time.

### Fix

**`backend/src/whatsapp.js`** — Add active hours check at the top of `handleAutoReply` (after automation_enabled check, ~line 2110):
```js
if (!isWithinActiveHours(db, userId)) {
  debugLog(db, userId, 'skip_outside_active_hours', { contact: contactName || phone });
  return;
}
```

**`backend/src/ai.js`** — Change the time format in the system prompt (line 238):
- Replace `Current time: ${nyTime} (${timeLabel}, New York time)` with `Current time: ${nyTime} (${timeLabel})`
- This removes the location reference so the AI just says the time naturally without mentioning New York.

### Files
- **`backend/src/whatsapp.js`** — Add 4 lines after line 2110
- **`backend/src/ai.js`** — Remove ", New York time" from 1 line

