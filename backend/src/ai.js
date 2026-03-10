/**
 * AI Auto-Reply module
 * Calls OpenAI gpt-4o-mini with conversation history to generate contextual replies.
 */

const DEFAULT_SYSTEM_PROMPT = `You are replying to WhatsApp messages as the phone owner. Reply naturally, casually, and contextually based on the conversation history. Keep responses concise and human-like. Do not mention that you are an AI.`;

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
