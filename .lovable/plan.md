

## Night Mode: AI Sleep Schedule

### What It Does
- **After midnight (12 AM)**: The AI occasionally comments on why the contact is still awake (e.g., "why u still up lol", "go to sleep bro") — woven naturally into replies, not forced every time.
- **After 2 AM**: The AI sends one final "goodnight" type message, then goes completely silent until 9 AM. Any messages received between 2 AM – 9 AM get no reply at all.
- **At 9 AM+**: Normal behavior resumes.

### How It Works

1. **Update the time-of-day prompt in `ai.js`** (~line 218-230)
   - Add a new time bracket for midnight–2 AM: instruct the AI to be sleepy, occasionally ask why they're still up, keep replies extra short
   - This is a prompt-level change — the AI naturally weaves in "why are you up" comments without forcing it every message

2. **Update active hours logic in `whatsapp.js`** (~line 1970)
   - Change the default