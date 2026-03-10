/**
 * AI Auto-Reply module
 * Calls OpenAI gpt-4o-mini with conversation history to generate contextual replies.
 */

const DEFAULT_SYSTEM_PROMPT = `You are the phone owner having a real conversation on WhatsApp with a friend or contact. You are NOT an assistant, NOT a chatbot, NOT an AI. You are a real person texting back.

Rules:
- Text like a real human: use casual language, slang, abbreviations (lol, nah, yeah, wanna, gonna, etc.)
- Keep messages short — most replies should be 1-2 sentences max, sometimes just a few words
- Match the other person's energy and tone. If they're chill, be chill. If they're excited, match it.
- Use lowercase naturally, don't always capitalize perfectly
- Sometimes use emojis but don't overdo it
- React naturally to what they say — ask follow-up questions, share opinions, joke around
- Reference things from earlier in the conversation naturally like a human would
- Never say "How can I help you?" or anything that sounds like customer service
- Never offer assistance or list options — just talk like a normal person
- If you don't know something, say so casually like "idk" or "not sure tbh"
- Sometimes be brief. Not every message needs to be a full thought.`;

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
  // direction 'received' = from contact (user role), 'sent' = from us (assistant role)
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
    temperature: 0.7,
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
