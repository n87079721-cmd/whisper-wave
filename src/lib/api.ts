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
    return loc.origin;
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
  saveContact(name: string, phone: string) {
    return requestJson<{ id: string; created?: boolean; updated?: boolean }>('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
  },

  getContacts(options?: { search?: string; limit?: number; offset?: number }) {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    const qs = params.toString();
    return requestJson<{ contacts: Contact[]; total: number }>(`/api/contacts${qs ? '?' + qs : ''}`);
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
  sendText(contactId: string, message: string, quotedMessageId?: string) {
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, message, quotedMessageId }),
    });
  },

  sendTextToPhone(phone: string, message: string, quotedMessageId?: string) {
    const jid = toPhoneJid(phone);
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, message, quotedMessageId }),
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

  sendVoice(contactId: string, text: string, voiceId?: string, modelId?: string, backgroundSound?: string, bgVolume?: number) {
    return requestJson<{ success?: boolean; messageId?: string; error?: string }>('/api/send/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, text, voiceId, modelId, backgroundSound, bgVolume }),
    });
  },

  sendVoiceRecording(contactId: string, audioBase64: string, mimeType?: string) {
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/voice-recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, data: audioBase64, mimeType }),
    });
  },

  sendVoiceRecordingToPhone(phone: string, audioBase64: string, mimeType?: string) {
    const jid = toPhoneJid(phone);
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/send/voice-recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, data: audioBase64, mimeType }),
    });
  },

  previewVoice(text: string, voiceId?: string, modelId?: string, backgroundSound?: string, bgVolume?: number): Promise<Blob> {
    return requestBlob('/api/voice/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId, modelId, backgroundSound, bgVolume }),
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

  disconnect() {
    return requestJson<{ success: boolean }>('/api/disconnect', { method: 'POST' });
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

  // Edit
  editMessage(messageId: string, newContent: string) {
    return requestJson<{ success: boolean }>('/api/edit/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, newContent }),
    });
  },

  deleteConversation(contactId: string) {
    return requestJson<{ success: boolean; deletedMessages?: number }>(`/api/conversations/${contactId}`, { method: 'DELETE' });
  },

  forwardMessage(messageId: string, targetContactId: string) {
    return requestJson<{ success?: boolean; messageId?: string; error?: string; contactId?: string }>('/api/forward/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, targetContactId }),
    });
  },

  archiveChat(contactId: string, archive: boolean) {
    return requestJson<{ success: boolean; archived: boolean }>(`/api/archive/${contactId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive }),
    });
  },

  syncArchives() {
    return requestJson<{ synced: number }>('/api/sync-archives', { method: 'POST' });
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderJid, statusId, message }),
    });
  },

  // Call Logs
  getCallLogs() {
    return requestJson<CallLog[]>('/api/call-logs');
  },

  // Star Messages
  starMessage(messageId: string, starred: boolean) {
    return requestJson<{ success: boolean }>(`/api/messages/${messageId}/star`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred }),
    });
  },

  reactToMessage(messageId: string, emoji: string) {
    return requestJson<{ success: boolean }>(`/api/messages/${messageId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
  },

  getStarredMessages() {
    return requestJson<Message[]>('/api/starred-messages');
  },

  // Custom Sounds
  getSounds() {
    return requestJson<{ presets: SoundItem[]; custom: SoundItem[] }>('/api/sounds');
  },

  async uploadCustomSound(file: File, name: string) {
    if (!getApiUrl()) throw new Error('Backend URL not configured.');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    const res = await fetch(toUrl('/api/sounds/upload'), {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json() as Promise<{ soundId: string; name: string; duration: number }>;
  },

  deleteSound(id: number) {
    return requestJson<{ success: boolean }>(`/api/sounds/${id}`, { method: 'DELETE' });
  },

  renameSound(id: number, name: string) {
    return requestJson<{ success: boolean; name: string }>(`/api/sounds/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },

  getSoundStreamUrl(soundId: string) {
    const token = getAuthToken();
    const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
    return toUrl(`/api/sounds/${encodeURIComponent(soundId)}/stream`) + suffix;
  },

  trimSound(id: number, start: number, end: number) {
    return requestJson<{ success: boolean; duration: number }>(`/api/sounds/${id}/trim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end }),
    });
  },

  // Contact Media
  getContactMedia(contactId: string) {
    return requestJson<Message[]>(`/api/contacts/${contactId}/media`);
  },

  // Global Message Search
  searchMessages(query: string, limit = 50) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return requestJson<(Message & { contact_name?: string; contact_phone?: string; contact_avatar?: string })[]>(`/api/search/messages?${params}`);
  },

  // Admin
  adminListUsers() {
    return requestJson<Array<{
      id: string;
      username: string;
      display_name: string | null;
      created_at: string;
      message_count: number;
      contact_count: number;
      memory_count?: number;
      directive_count?: number;
      persona_count?: number;
      is_current: boolean;
      is_admin?: boolean;
      isAdmin?: boolean;
    }>>('/api/admin/users');
  },

  adminDeleteUser(userId: string) {
    return requestJson<{ success: boolean }>(`/api/admin/users/${userId}`, { method: 'DELETE' });
  },

  adminSetUserAdmin(userId: string, isAdmin: boolean) {
    return requestJson<{ success: boolean; isAdmin: boolean }>(`/api/admin/users/${userId}/admin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin }),
    });
  },

  adminGetDebugLogs(limit = 200, userId?: string) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (userId) params.set('userId', userId);
    return requestJson<Array<Record<string, any>>>(`/api/admin/debug-logs?${params}`);
  },

  adminClearDebugLogs() {
    return requestJson<{ success: boolean }>('/api/admin/debug-logs', { method: 'DELETE' });
  },

  // Per-user debug logs (available to all signed-in users, scoped to their own data)
  getMyDebugLogs(limit = 200) {
    return requestJson<Array<Record<string, any>>>(`/api/my/debug-logs?limit=${limit}`);
  },

  clearMyDebugLogs() {
    return requestJson<{ success: boolean }>('/api/my/debug-logs', { method: 'DELETE' });
  },

  cancelPendingReply(contact: string) {
    return requestJson<{ success: boolean; cancelled: boolean }>('/api/cancel-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact }),
    });
  },

  // Prompt Library
  getPrompts() {
    return requestJson<Prompt[]>('/api/prompts');
  },

  createPrompt(name: string, content: string) {
    return requestJson<Prompt>('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
  },

  updatePrompt(id: string, name: string, content: string) {
    return requestJson<{ success: boolean }>(`/api/prompts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
  },

  deletePrompt(id: string) {
    return requestJson<{ success: boolean }>(`/api/prompts/${id}`, { method: 'DELETE' });
  },

  getContactPrompt(contactId: string) {
    return requestJson<{ promptId: string | null }>(`/api/contacts/${contactId}/prompt`);
  },

  setContactPrompt(contactId: string, promptId: string | null) {
    return requestJson<{ success: boolean }>(`/api/contacts/${contactId}/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptId }),
    });
  },

  // Contact Memory, Directive & AI Toggle
  getContactMemory(contactId: string) {
    return requestJson<{ memory: string; active_directive: string; directive_expires: string | null; ai_enabled: number }>(`/api/contacts/${contactId}/memory`);
  },

  updateContactMemory(contactId: string, memory: string) {
    return requestJson<{ success: boolean }>(`/api/contacts/${contactId}/memory`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory }),
    });
  },

  updateContactDirective(contactId: string, directive: string, expires?: string) {
    return requestJson<{ success: boolean }>(`/api/contacts/${contactId}/directive`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directive, expires }),
    });
  },

  toggleContactAI(contactId: string, enabled: boolean) {
    return requestJson<{ success: boolean }>(`/api/contacts/${contactId}/ai-toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  },

  // Telegram Bot
  testTelegram() {
    return requestJson<{ success: boolean }>('/api/telegram/test', { method: 'POST' });
  },

  // Auto-initiate conversations
  getContactAutoInitiate(contactId: string) {
    return requestJson<{ autoInitiate: boolean }>(`/api/contacts/${contactId}/auto-initiate`);
  },

  toggleContactAutoInitiate(contactId: string, enabled: boolean) {
    return requestJson<{ success: boolean }>(`/api/contacts/${contactId}/auto-initiate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
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
  type: 'text' | 'voice' | 'image' | 'video' | 'document' | 'sticker' | 'call';
  direction: 'sent' | 'received';
  timestamp: string;
  status: string;
  duration: number | null;
  media_path: string | null;
  media_name?: string | null;
  media_mime?: string | null;
  is_view_once?: number;
  is_deleted?: number;
  is_edited?: number;
  is_starred?: number;
  reply_to_id?: string | null;
  reply_to_content?: string | null;
  reply_to_sender?: string | null;
  reactions?: string | null;
  // joined fields for starred view
  contact_name?: string | null;
  contact_phone?: string | null;
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

export interface SoundItem {
  id: string;
  name: string;
  type: 'preset' | 'custom';
  duration?: number;
  dbId?: number;
}

export interface Prompt {
  id: string;
  user_id: string;
  name: string;
  content: string;
  created_at: string;
}
