const STORAGE_KEY = 'wa_api_url';
const TOKEN_KEY = 'wa_auth_token';

function getAuthToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  if (token) return { 'Authorization': `Bearer ${token}` };
  return {};
}

function getApiUrl(): string {
  // 1. localStorage (runtime config from Settings)
  const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored) return stored.replace(/\/$/, '');

  // 2. env var
  const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '';
  if (envUrl) return envUrl.replace(/\/$/, '');

  // 3. Same-origin (merged deployment — frontend served by backend)
  if (typeof window !== 'undefined') {
    const loc = window.location;
    if (!loc.hostname.includes('lovable.app') && !loc.hostname.includes('lovableproject.com')) {
      return loc.origin;
    }
    if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
      return 'http://localhost:3002';
    }
  }

  return '';
}

export function getStoredApiUrl(): string {
  return (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null) || '';
}

export function setStoredApiUrl(url: string) {
  if (url) {
    localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function isBackendConfigured(): boolean {
  return !!getApiUrl();
}

const toUrl = (path: string) => {
  const base = getApiUrl();
  return base ? `${base}${path}` : path;
};

const withTokenQuery = (path: string, params?: Record<string, string>) => {
  const search = new URLSearchParams(params);
  const token = getAuthToken();
  if (token) search.set('token', token);
  const qs = search.toString();
  return toUrl(path) + (qs ? `?${qs}` : '');
};

function normalizePhoneDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function toPhoneJid(value: string): string {
  return `${normalizePhoneDigits(value)}@s.whatsapp.net`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() || '' : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (!getApiUrl()) {
    throw new Error('Backend URL not configured. Go to Settings → Backend URL to set it.');
  }
  
  const headers = {
    ...authHeaders(),
    ...(init?.headers || {}),
  };
  
  const res = await fetch(toUrl(path), { ...init, headers });
  const ct = res.headers.get('content-type') || '';

  if (ct.includes('text/html')) {
    throw new Error('Backend unreachable — got HTML instead of JSON. Check your Backend URL in Settings.');
  }

  // Handle auth errors
  if (res.status === 401) {
    // Token expired or invalid — clear auth
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('wa_auth_user');
    window.location.reload();
    throw new Error('Session expired. Please log in again.');
  }

  const isJson = ct.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error?: string }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return payload as T;
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  if (!getApiUrl()) {
    throw new Error('Backend URL not configured. Go to Settings → Backend URL to set it.');
  }
  
  const headers = {
    ...authHeaders(),
    ...(init?.headers || {}),
  };
  
  const res = await fetch(toUrl(path), { ...init, headers });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('Backend unreachable — got HTML instead of JSON. Check your Backend URL in Settings.');
  }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('wa_auth_user');
    window.location.reload();
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error) message = err.error;
    } catch {}
    throw new Error(message);
  }
  return res.blob();
}

export const api = {
  // Status & QR
  getStatus() {
    return requestJson<{ status: 'disconnected' | 'qr_waiting' | 'connected' | 'reconnecting'; qr: string | null; pairingCode?: string | null; stats?: Stats; syncState?: any }>('/api/status');
  },

  getQR() {
    return requestJson<{ qr: string | null; status: string }>('/api/qr');
  },

  pairPhone(phoneNumber: string) {
    return requestJson<{ success: boolean; code: string }>('/api/pair-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    });
  },

  createEventSource() {
    if (!getApiUrl()) {
      throw new Error('Backend URL not configured. Go to Settings → Backend URL to set it.');
    }
    const token = getAuthToken();
    // EventSource doesn't support headers, pass token as query param
    const url = toUrl('/api/events') + (token ? `?token=${encodeURIComponent(token)}` : '');
    return new EventSource(url);
  },

  // Voices
  getVoices(): Promise<Voice[]> {
    return requestJson<Voice[]>('/api/voices');
  },

  testElevenLabs(): Promise<{ success: boolean; totalVoices: number; generatedVoices: number; supportsV3Prompts: boolean }> {
    return requestJson('/api/elevenlabs/test');
  },

  // Contacts
  getContacts() {
    return requestJson<Contact[]>('/api/contacts');
  },

  // Conversations
  getConversations() {
    return requestJson<Contact[]>('/api/conversations');
  },

  getMessages(contactId: string, options?: { limit?: number; before?: string }) {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.before) params.set('before', options.before);
    const qs = params.toString();
    return requestJson<{ messages: Message[]; hasMore: boolean }>(`/api/messages/${contactId}${qs ? '?' + qs : ''}`);
  },

  // Send
  sendText(contactId: string, message: string) {
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, message }),
    });
  },

  sendTextToPhone(phone: string, message: string) {
    const jid = toPhoneJid(phone);
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, message }),
    });
  },

  async sendMedia(contactId: string, file: File, caption?: string, isViewOnce?: boolean) {
    const mimeType = file.type || 'application/octet-stream';
    const data = await fileToBase64(file);
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactId,
        fileName: file.name,
        mimeType,
        data,
        caption,
        sendAsDocument: !(mimeType.startsWith('image/') || mimeType.startsWith('video/')),
        isViewOnce: !!isViewOnce,
      }),
    });
  },

  async sendMediaToPhone(phone: string, file: File, caption?: string, isViewOnce?: boolean) {
    const mimeType = file.type || 'application/octet-stream';
    const data = await fileToBase64(file);
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jid: toPhoneJid(phone),
        fileName: file.name,
        mimeType,
        data,
        caption,
        sendAsDocument: !(mimeType.startsWith('image/') || mimeType.startsWith('video/')),
        isViewOnce: !!isViewOnce,
      }),
    });
  },

  sendVoice(contactId: string, text: string, voiceId?: string, modelId?: string, backgroundSound?: string) {
    return requestJson<{ success?: boolean; messageId?: string; error?: string }>('/api/send/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, text, voiceId, modelId, backgroundSound }),
    });
  },

  previewVoice(text: string, voiceId?: string, modelId?: string, backgroundSound?: string): Promise<Blob> {
    return requestBlob('/api/voice/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId, modelId, backgroundSound }),
    });
  },

  enhanceText(text: string) {
    return requestJson<{ enhanced: string }>('/api/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  },

  // Config
  getConfig(key: string) {
    return requestJson<{ value: string; exists: boolean }>(`/api/config/${key}`);
  },

  setConfig(key: string, value: string) {
    return requestJson<{ success: boolean }>('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  },

  reconnect() {
    return requestJson<{ success: boolean }>('/api/reconnect', { method: 'POST' });
  },

  clearSession() {
    return requestJson<{ success: boolean }>('/api/clear-session', { method: 'POST' });
  },

  // Voice media playback URL
  getVoiceMediaUrl(filename: string) {
    return withTokenQuery(`/api/message-media/${encodeURIComponent(filename)}`, { format: 'mp3' });
  },

  getMessageMediaUrl(filename: string, options?: { download?: boolean }) {
    return withTokenQuery(`/api/message-media/${encodeURIComponent(filename)}`, options?.download ? { download: '1' } : undefined);
  },

  // Delete
  deleteMessage(messageId: string, mode: 'me' | 'everyone' = 'me') {
    return requestJson<{ success: boolean }>(`/api/messages/${messageId}?mode=${mode}`, { method: 'DELETE' });
  },

  deleteConversation(contactId: string) {
    return requestJson<{ success: boolean; deletedMessages?: number }>(`/api/conversations/${contactId}`, { method: 'DELETE' });
  },

  archiveChat(contactId: string, archive: boolean) {
    return requestJson<{ success: boolean; archived: boolean }>(`/api/archive/${contactId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive }),
    });
  },

  markChatRead(contactId: string) {
    return requestJson<{ success: boolean }>(`/api/mark-read/${contactId}`, { method: 'POST' });
  },

  triggerSync() {
    return requestJson<{ success: boolean; syncState?: any }>('/api/trigger-sync', { method: 'POST' });
  },

  recoverChat(contactId: string) {
    return requestJson<{ success: boolean; message: string }>(`/api/recover-chat/${contactId}`, { method: 'POST' });
  },

  getSyncDiagnostics() {
    return requestJson<SyncDiagnostics>('/api/sync-diagnostics');
  },

  fullReset() {
    return requestJson<{ success: boolean; message: string }>('/api/full-reset', { method: 'POST' });
  },

  // Statuses (Stories)
  getStatuses() {
    return requestJson<StatusGroup[]>('/api/statuses');
  },

  getStatusMediaUrl(filename: string) {
    const token = getAuthToken();
    const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
    return toUrl(`/api/status-media/${encodeURIComponent(filename)}`) + suffix;
  },

  replyToStatus(senderJid: string, statusId: string, message: string) {
    return requestJson<{ success?: boolean; error?: string }>('/api/statuses/reply', {
      method: 'POST',
      body: JSON.stringify({ senderJid, statusId, message }),
    });
  },

  // Call Logs
  getCallLogs() {
    return requestJson<CallLog[]>('/api/call-logs');
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
  is_archived?: number;
  unread_count?: number;
}

export interface Message {
  id: string;
  contact_id: string;
  jid: string;
  content: string | null;
  type: 'text' | 'voice' | 'image' | 'video' | 'document';
  direction: 'sent' | 'received';
  timestamp: string;
  status: string;
  duration: number | null;
  media_path: string | null;
  media_name?: string | null;
  media_mime?: string | null;
  is_view_once?: number;
  is_deleted?: number;
}

export interface Stats {
  messagesSent: number;
  voiceSent: number;
  messagesReceived: number;
  activeContacts: number;
}

export interface StatusItem {
  id: string;
  content: string;
  mediaType: 'text' | 'image' | 'video';
  mediaPath: string | null;
  timestamp: string;
}

export interface StatusGroup {
  senderJid: string;
  senderPhone: string;
  senderName: string | null;
  statuses: StatusItem[];
}

export interface CallLog {
  id: string;
  caller_jid: string;
  caller_phone: string;
  caller_name: string | null;
  is_video: number;
  is_group: number;
  status: string;
  timestamp: string;
}

export interface SyncDiagnostics {
  totalContacts: number;
  unnamedContacts: number;
  emptyChats: number;
  totalMessages: number;
  unresolvedLids: number;
  storeContactCount: number;
  lidMapSize: number;
  syncState: any;
  topUnnamed: Array<{ id: string; jid: string; name: string | null; phone: string | null }>;
}
