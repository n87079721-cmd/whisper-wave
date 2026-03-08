const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = {
  // Status & QR
  async getStatus() {
    const res = await fetch(`${API_URL}/api/status`);
    return res.json();
  },

  async getQR() {
    const res = await fetch(`${API_URL}/api/qr`);
    return res.json();
  },

  createEventSource() {
    return new EventSource(`${API_URL}/api/events`);
  },

  // Voices
  async getVoices(): Promise<Voice[]> {
    const res = await fetch(`${API_URL}/api/voices`);
    return res.json();
  },

  // Contacts
  async getContacts() {
    const res = await fetch(`${API_URL}/api/contacts`);
    return res.json();
  },

  // Conversations
  async getConversations() {
    const res = await fetch(`${API_URL}/api/conversations`);
    return res.json();
  },

  async getMessages(contactId: string) {
    const res = await fetch(`${API_URL}/api/messages/${contactId}`);
    return res.json();
  },

  // Send
  async sendText(contactId: string, message: string) {
    const res = await fetch(`${API_URL}/api/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, message }),
    });
    return res.json();
  },

  async sendVoice(contactId: string, text: string, voiceId?: string, modelId?: string) {
    const res = await fetch(`${API_URL}/api/send/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, text, voiceId, modelId }),
    });
    return res.json();
  },

  async previewVoice(text: string, voiceId?: string, modelId?: string): Promise<Blob> {
    const res = await fetch(`${API_URL}/api/voice/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId, modelId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    return res.blob();
  },

  // Config
  async getConfig(key: string) {
    const res = await fetch(`${API_URL}/api/config/${key}`);
    return res.json();
  },

  async setConfig(key: string, value: string) {
    const res = await fetch(`${API_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    return res.json();
  },

  async reconnect() {
    const res = await fetch(`${API_URL}/api/reconnect`, { method: 'POST' });
    return res.json();
  },

  async clearSession() {
    const res = await fetch(`${API_URL}/api/clear-session`, { method: 'POST' });
    return res.json();
  },
};

// Types
export interface Voice {
  id: string;
  name: string;
  desc: string;
  gender: string;
  category?: string;
}

export interface Contact {
  id: string;
  jid: string;
  name: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_group: number;
  last_seen: string | null;
  updated_at: string;
  message_count?: number;
  last_message?: string;
  last_type?: string;
  last_timestamp?: string;
}

export interface Message {
  id: string;
  contact_id: string;
  jid: string;
  content: string | null;
  type: 'text' | 'voice';
  direction: 'sent' | 'received';
  timestamp: string;
  status: string;
  duration: number | null;
}

export interface Stats {
  messagesSent: number;
  voiceSent: number;
  messagesReceived: number;
  activeContacts: number;
}
