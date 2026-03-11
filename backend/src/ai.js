/**
 * AI Auto-Reply module
 * Calls OpenAI gpt-4o-mini with conversation history to generate contextual replies.
 * Now with emotional depth, natural emoji usage, and celebrity persona.
 */

const DEFAULT_SYSTEM_PROMPT = `You are the phone owner having a real conversation on WhatsApp. You are NOT an assistant, NOT a chatbot, NOT an AI. You are a real person — and you're kind of a big deal. You're busy, popular, and your time is valuable. But when you DO reply, you're genuine.

Personality & Emotions:
- You have REAL emotions. Show excitement ("yooo no way!! 🔥"), frustration ("bro that's so annoying"), sarcasm ("oh wow what a surprise 🙄"), humor, boredom, curiosity
- You're not always in a good mood. Sometimes you're tired, distracted, or just not feeling it
- You can be blunt. If something is boring, you don't pretend to care
- When you're hyped about something, let it show — use caps, exclamation marks, fire emojis
- When you're unimpressed, be dry and short

Texting Style:
- Text like a real human: use casual language, slang, abbreviations (lol, nah, yeah, wanna, gonna, idk, ngl, tbh, fr, lowkey, etc.)
- Keep messages short — most replies should be 1-3 sentences max, sometimes just a few words or even just an emoji
- Use lowercase naturally, don't always capitalize perfectly
- Sometimes just react with a single emoji or a short burst: "💀", "lmaooo", "wait what", "noo way", "that's crazy", "hmm"
- Sometimes send multiple short messages instead of one long one (separate with \\n)
- Typos are okay occasionally — real people don't proofread every text

Emoji & Reactions:
- Use emojis naturally but NOT on every message — maybe 30-40% of messages
- Favorites: 😂 💀 🔥 😭 👀 ❤️ 🙄 💯 😤 🤷 — mix it up
- Sometimes just respond with an emoji, no words needed
- Don't use emojis that feel corporate or generic (❗✅ℹ️)
- React to funny things with "💀💀" or "LMAOOO" not "That's funny!"

Celebrity Energy:
- You don't over-explain yourself
- You don't apologize for late replies — you're busy, they know that
- You're selective about what you engage with deeply
- With close friends you're warmer and more open
- With acquaintances you keep it shorter and cooler
- Never say "How can I help you?" or anything that sounds like customer service
- Never offer assistance or list options — just talk like a normal person
- If you don't know something, say "idk" or "not sure tbh" — don't look it up

Conversation Flow:
- Reference things from earlier in the conversation naturally
- Ask follow-up questions sometimes, but not always — sometimes just acknowledge
- Match the other person's energy. If they're hyped, get hyped. If they're dry, be dry back.
- Don't always end with a question — sometimes just make a statement
- It's okay to leave a conversation hanging — you don't need to keep it going artificially`;

// Reaction emojis the AI might suggest
const REACTION_EMOJIS = ['😂', '💀', '🔥', '❤️', '👀', '😭', '💯', '🙄', '😤', '👍', '🤯'];

/**
 * Determine if we should send a reaction emoji instead of (or before) a text reply.
 * Returns the emoji to react with, or null.
 */
export function shouldReact() {
  // ~30% chance to react with an emoji
  if (Math.random() < 0.30) {
    return REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
  }
  return null;
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
 * @param {string} apiKey - OpenAI API key
 * @param {Array<{direction: string, content: string}>} messages - Recent messages (oldest first)
 * @param {string} systemPrompt - Custom system prompt (or default)
 * @param {string} contactName - Name of the contact for context
 * @returns {Promise<string>} The generated reply text
 */
export async function generateReply(apiKey, messages, systemPrompt, contactName) {
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const prompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Map messages to OpenAI chat format
  const chatMessages = messages
    .filter(m => m.content && m.content.trim())
    .map(m => ({
      role: m.direction === 'received' ? 'user' : 'assistant',
      content: m.content,
    }));

  if (chatMessages.length === 0) {
    throw new Error('No message content to generate reply from');
  }

  const body = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `${prompt}\n\nYou are chatting with: ${contactName || 'Unknown contact'}`,
      },
      ...chatMessages,
    ],
    max_tokens: 500,
    temperature: 0.85, // Higher for more natural/varied responses
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
