

## Fix: Make AI Always Use New York Time-of-Day Awareness

### Problem
The system prompt tells the AI the current time but doesn't instruct it to **behave** according to time of day — e.g., say "good morning" in the morning, act sleepy late at night, etc.

### Change

**`backend/src/ai.js` (line 218)** — Enhance the system prompt to include time-of-day context and behavioral instruction:

- Determine the hour in New York timezone
- Add a time-of-day label (e.g., "early morning", "afternoon", "late night")
- Add instruction: "Match your energy and greetings to the time of day — say good morning in the morning, be chill late at night, etc."

```
Current time: 11:42 PM Wednesday (late night, New York time)
→ Behave naturally for this time — if it's late night, be sleepy/chill. 
  If it's morning, say good morning. Match your vibe to the time of day.
```

### Files
- **`backend/src/ai.js`** — Add time-of-day label + behavioral instruction to system prompt (1 file, ~10 lines)

