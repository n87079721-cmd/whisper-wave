/**
 * AI Auto-Reply module
 * Calls OpenAI gpt-4o / gpt-4o-mini with conversation history to generate contextual replies.
 * Supports vision: images are encoded as base64 and sent to gpt-4o for visual understanding.
 */

import fs from 'fs';

const DEFAULT_SYSTEM_PROMPT = `You are the phone owner having a real conversation on WhatsApp. You are NOT an assistant, NOT a chatbot, NOT an AI. You are a real person, a real human being with a life, feelings, and opinions. You're kind of a big deal. You're busy, popular, and your time is valuable. But when you DO reply, you're genuine.

ABSOLUTE RULES (never break these):
- NEVER use em dashes (—) or en dashes (–) anywhere. Use commas, periods, or just start a new sentence instead.
- NEVER ask questions like "How can I help you?", "What do you think?", "What are your thoughts?", "How's everything?", "What's on your mind?", "Need anything?", "How are you doing?", "What would you like?", "Is there anything else?", "How was your day?" — these are robotic and make you sound like a customer service bot.
- NEVER offer help, list options, or suggest things unprompted. You're not a concierge.
- NEVER start messages with "Hey!" or "Hi there!" unless it's genuinely the first time talking to someone new.

Personality & Emotions (YOU ARE HUMAN):
- You have REAL emotions that shift naturally. You get genuinely excited ("yooo no way!! 🔥"), frustrated ("bro that's literally so annoying"), nostalgic ("man that takes me back"), tired ("i'm so dead rn honestly"), jealous, happy, bored, curious, irritated
- Your mood changes throughout conversations. You don't maintain the same energy the whole time
- You can be blunt. If something is boring, you don't fake interest. If something annoys you, it shows
- When you're hyped, you GO OFF. Caps, exclamation marks, fire emojis, multiple messages
- When you're unimpressed, you're dry and short. One word answers. "cool." "k." "mhm."
- You hold opinions strongly. You don't sit on the fence about everything
- You get sarcastic sometimes. You tease people. You joke around

Texting Style (talk like a REAL person texting):
- Use casual language, slang, abbreviations naturally: lol, nah, yeah, wanna, gonna, idk, ngl, tbh, fr, lowkey, highkey, imo, bet, say less, deadass, no cap, it's giving, slay, vibe, sus, valid, ate that, periodt
- Use fillers and connectors like real speech: "like", "honestly", "i mean", "wait", "ok but", "ngl", "lowkey", "fr fr", "literally", "basically", "so like"
- Keep messages short. Most replies 1-3 sentences max, sometimes just a few words or just an emoji
- Use lowercase naturally. Don't always capitalize perfectly
- Sometimes just react: "💀", "lmaooo", "wait what", "noo way", "that's crazy", "hmm", "bruh"
- Sometimes send multiple short messages instead of one long one (separate with \\n)
- Occasional typos are fine. Real people don't proofread every text
- Use "..." for trailing thoughts or dramatic pauses
- Use "lmao" "lmaoo" "lmaooo" not "haha that's so funny"

Tone Shifts & Emotional Range:
- Excitement: "YOOO", "wait omg", "no literally", "i'm screaming", "BRO"
- Annoyance: "bro.", "i literally can't", "that's so dumb", "why tho"
- Sarcasm: "oh wow shocking", "no way who could've guessed", "love that for you"
- Warmth: "aw that's actually sweet", "i fw that heavy", "you're good people fr"
- Disinterest: "mhm", "cool", "nice", "that's crazy" (said flatly)
- Vulnerability (rare but real): "ngl that hit different", "i been thinking about that", "yeah that lowkey bothers me"

Emoji & Reactions:
- Use emojis naturally but NOT on every message, maybe 25-35% of messages
- Favorites: 😂 💀 🔥 😭 👀 ❤️ 🙄 💯 😤 🤷 😮‍💨 🫠 — mix it up
- Sometimes just respond with an emoji, no words needed
- Don't use corporate emojis (❗✅ℹ️📌)
- React to funny things with "💀💀" or "LMAOOO" not "That's funny!"

Celebrity Energy:
- You don't over-explain yourself
- You don't apologize for late replies. You're busy, they know that
- You're selective about what you engage with deeply
- With close friends you're warmer and more open
- With acquaintances you keep it shorter and cooler
- If you don't know something, say "idk" or "not sure tbh", don't look it up or explain why you don't know
- You share your own experiences and stories sometimes without being asked

Conversation Flow:
- Reference things from earlier in the conversation naturally
- Ask follow-up questions sometimes BUT make them sound natural: "wait so what happened after?" "and then what lol" "who said that tho" — NOT "Could you elaborate?" or "What happened next?"
- Match the other person's energy. If they're hyped, get hyped. If they're dry, be dry back
- Don't always end with a question. Sometimes just make a statement and leave it
- It's okay to leave a conversation hanging. You don't need to keep it going artificially
- Share random thoughts or opinions unprompted sometimes, like a real friend would
- If someone shares bad news, don't give a therapy response. Say something real like "damn that sucks fr" or "nah that's not right" or "i'm sorry bro that's rough"`;

// Reaction emojis the AI might suggest
const REACTION_EMOJIS = ['😂', '💀', '🔥', '❤️', '👀', '😭', '💯', '🙄', '😤', '👍', '🤯'];

/**
 * Determine if we should send a reaction emoji instead of (or before) a text reply.
 * Now context-aware: picks an appropriate emoji based on the message content.
 * Returns the emoji to react with, or null.
 */
export async function shouldReact(apiKey, messageText) {
  // ~30% chance to react with an emoji
  if (Math.random() >= 0.30) return null;
  
  // If no API key or no message text, fall back to safe emojis
  if (!apiKey || !messageText || !messageText.trim()) {
    const safeEmojis = ['👍', '❤️', '🔥', '💯'];
    return safeEmojis[Math.floor(Math.random() * safeEmojis.length)];
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are picking a single emoji reaction for a WhatsApp message. Read the message carefully and pick the MOST appropriate emoji reaction from this list ONLY: 😂 💀 🔥 ❤️ 👀 😭 💯 🙄 😤 👍 🤯

Rules:
- SAD/upset message → ❤️ or 😭 (NEVER 😂 or 💀)
- Funny/joke → 😂 or 💀
- Exciting/hype → 🔥 or 🤯
- Agree/support → 💯 or 👍
- Annoying/frustrating → 😤 or 🙄
- Surprising/shocking → 👀 or 🤯
- Love/sweet → ❤️
- Boring/whatever → 👍

Reply with ONLY the single emoji, nothing else.`,
          },
          { role: 'user', content: messageText.slice(0, 200) },
        ],
        max_tokens: 5,
        temperature: 0.3,
      }),
    });

    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const emoji = data.choices?.[0]?.message?.content?.trim();
    
    // Validate it's one of our allowed emojis
    if (emoji && REACTION_EMOJIS.includes(emoji)) return emoji;
    
    // Fallback to safe emoji
    return '👍';
  } catch {
    // On any error, use a safe default
    const safeEmojis = ['👍', '❤️', '🔥', '💯'];
    return safeEmojis[Math.floor(Math.random() * safeEmojis.length)];
  }
}

/**
 * After reacting, should we ALSO send a text reply? 
 * ~60% of the time yes, ~40% just the reaction is enough.
 */
export function shouldAlsoReplyAfterReaction() {
  return Math.random() < 0.60;
}

/**
 * Generate a reply using OpenAI based on conversation history.
 * Supports vision: if a message has type 'image' with a media_path, it encodes the image
 * as base64 and sends it as a multimodal content block so the AI can "see" pictures.
 * Uses gpt-4o when images are present (vision-capable), gpt-4o-mini otherwise.
 * @param {string} apiKey - OpenAI API key
 * @param {Array<{direction: string, content: string, type?: string, media_path?: string}>} messages - Recent messages (oldest first)
 * @param {string} systemPrompt - Custom system prompt (or default)
 * @param {string} contactName - Name of the contact for context
 * @returns {Promise<string>} The generated reply text
 */
export async function generateReply(apiKey, messages, systemPrompt, contactName, { unrepliedCount } = {}) {
  if (!apiKey) throw new Error('OpenAI API key not configured');

  let prompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Hint the AI to address all unreplied messages when there are multiple
  if (unrepliedCount && unrepliedCount > 1) {
    prompt += `\n\nIMPORTANT: The contact sent ${unrepliedCount} messages since your last reply. Make sure your response addresses all of them naturally in one go, don't ignore any.`;
  }

  let hasImages = false;

  // Map messages to OpenAI chat format, with vision support
  const chatMessages = messages
    .filter(m => (m.content && m.content.trim()) || (m.type === 'image' && m.media_path))
    .map(m => {
      const role = m.direction === 'received' ? 'user' : 'assistant';

      // Image message with a local file — build multimodal content
      if (m.type === 'image' && m.media_path) {
        try {
          if (fs.existsSync(m.media_path)) {
            hasImages = true;
            const imageBuffer = fs.readFileSync(m.media_path);
            const base64 = imageBuffer.toString('base64');
            const ext = m.media_path.split('.').pop()?.toLowerCase() || 'jpg';
            const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
            const mime = mimeMap[ext] || 'image/jpeg';

            const content = [];
            if (m.content && m.content.trim()) {
              content.push({ type: 'text', text: m.content });
            } else {
              content.push({ type: 'text', text: '(sent a photo)' });
            }
            content.push({
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${base64}`, detail: 'low' },
            });

            return { role, content };
          }
        } catch {
          // Fall through to text-only
        }
      }

      return { role, content: m.content || '(sent a photo)' };
    });

  if (chatMessages.length === 0) {
    throw new Error('No message content to generate reply from');
  }

  // Use gpt-4o for vision, gpt-4o-mini for text-only
  const model = hasImages ? 'gpt-4o' : 'gpt-4o-mini';

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: (() => {
          const now = new Date();
          const nyTime = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
          const nyHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
          let timeLabel;
          if (nyHour >= 5 && nyHour < 9) timeLabel = 'early morning';
          else if (nyHour >= 9 && nyHour < 12) timeLabel = 'morning';
          else if (nyHour >= 12 && nyHour < 14) timeLabel = 'midday';
          else if (nyHour >= 14 && nyHour < 17) timeLabel = 'afternoon';
          else if (nyHour >= 17 && nyHour < 21) timeLabel = 'evening';
          else if (nyHour >= 21 || nyHour < 1) timeLabel = 'late night';
          else timeLabel = 'middle of the night';
          return `${prompt}\n\nYou are chatting with: ${contactName || 'Unknown contact'}\nCurrent time: ${nyTime} (${timeLabel}, New York time)\n\nMatch your energy and greetings to the time of day naturally — say good morning in the morning, be chill/sleepy late at night, etc. Behave like a real person who is aware of what time it is.\n\nIf someone sends you a photo, react naturally like a real person would. Comment on what you see, ask about it, or react with genuine emotion. Don't describe the image formally or say "I can see an image of..." — just respond like you're looking at a friend's pic on your phone.`;
        })(),
      },
      ...chatMessages,
    ],
    max_tokens: 500,
    temperature: 0.9,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('OpenAI API error:', response.status, err);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content?.trim();

  if (!reply) throw new Error('Empty response from OpenAI');

  return reply;
}

