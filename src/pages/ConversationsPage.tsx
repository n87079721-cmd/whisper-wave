import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Mic, Check, CheckCheck, Send, Loader2, Volume2, Play, Square, ArrowLeft, Plus, X } from 'lucide-react';
import { api, type Contact, type Message, type Voice } from '@/lib/api';
import { toast } from 'sonner';

interface ConversationsPageProps {
  initialContact?: Contact | null;
  onContactOpened?: () => void;
}

const ConversationsPage = ({ initialContact, onContactOpened }: ConversationsPageProps) => {
  const [conversations, setConversations] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [replyMode, setReplyMode] = useState<'text' | 'voice'>('text');
  const [sending, setSending] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('JBFqnCBsd6RMkjVDRZzb');

  // Voice preview
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // New conversation state
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  const selectedContactRef = useRef<Contact | null>(null);
  selectedContactRef.current = selectedContact;

  const refreshMessages = useCallback(async (contactId: string) => {
    try {
      const msgs = await api.getMessages(contactId);
      setMessages(msgs);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {}
  }, []);

  const refreshAllContacts = useCallback(async () => {
    try {
      const data = await api.getContacts();
      setAllContacts(data);
    } catch {}
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await api.getConversations();
      setConversations(data);
      const current = selectedContactRef.current;
      if (current) {
        const updatedCurrent = data.find(contact => contact.id === current.id);
        if (updatedCurrent) setSelectedContact(updatedCurrent);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refreshConversations().then(() => setLoading(false));
    api.getVoices().then(setVoices).catch(() => {});
    refreshAllContacts();
  }, [refreshConversations, refreshAllContacts]);

  // Auto-select contact when navigating from ContactsPage
  useEffect(() => {
    if (!initialContact) return;
    // Directly set the contact — no need to re-fetch and search
    setSelectedContact(initialContact);
    onContactOpened?.();
  }, [initialContact, onContactOpened]);

  // Real-time: SSE for new messages + fast polling fallback
  useEffect(() => {
    const refreshActiveConversation = () => {
      refreshConversations();
      refreshAllContacts();
      const current = selectedContactRef.current;
      if (current) refreshMessages(current.id);
    };

    let es: EventSource | null = null;
    try {
      es = api.createEventSource();
      es.addEventListener('message', refreshActiveConversation);
      es.addEventListener('history_sync', refreshActiveConversation);
      es.addEventListener('contacts_sync', refreshActiveConversation);
      es.onerror = () => {};
    } catch {}

    const interval = setInterval(refreshActiveConversation, 3000);

    return () => {
      es?.close();
      clearInterval(interval);
    };
  }, [refreshAllContacts, refreshConversations, refreshMessages]);

  useEffect(() => {
    if (!selectedContact) return;
    refreshMessages(selectedContact.id);
  }, [selectedContact, refreshMessages]);

  const cleanPhone = (p: string) => p?.replace(/@.*$/, '') || '';

  const hasRealName = (contact: Contact) => {
    const value = contact.name?.trim();
    return !!value && !value.includes('@') && !/^\+?\d{7,}$/.test(value.replace(/\s+/g, ''));
  };

  const getDisplayName = (contact: Contact) => {
    const cleaned = cleanPhone(contact.phone || '');
    if (hasRealName(contact)) return contact.name as string;
    if (cleaned) return cleaned;
    return contact.jid.endsWith('@lid') ? 'WhatsApp contact' : 'Unknown contact';
  };

  const getDisplayMeta = (contact: Contact) => {
    const cleaned = cleanPhone(contact.phone || '');
    if (cleaned) return cleaned;
    return contact.jid.endsWith('@lid') ? 'Waiting for sync' : '';
  };

  const getInitials = (contact: Contact) =>
    getDisplayName(contact)
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const filtered = conversations.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    cleanPhone(c.phone || '').includes(search)
  );

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'read') return <CheckCheck className="w-3.5 h-3.5 text-primary" />;
    if (status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />;
    return <Check className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const handleSendReply = async () => {
    if (!selectedContact || !replyText.trim()) return;
    setSending(true);
    try {
      const isTemp = selectedContact.id.startsWith('temp-');
      if (replyMode === 'text') {
        const res = isTemp
          ? await api.sendTextToPhone(selectedContact.phone || '', replyText)
          : await api.sendText(selectedContact.id, replyText);
        if (res.error) throw new Error(res.error);
        toast.success('Message sent');
        // If was temp, refresh and find the real contact using returned contactId
        if (isTemp && res.contactId) {
          const data = await api.getConversations();
          setConversations(data);
          const real = data.find(c => c.id === res.contactId);
          if (real) setSelectedContact(real);
        }
      } else {
        if (isTemp) {
          toast.error('Send a text message first to start this conversation');
          setSending(false);
          return;
        }
        const res = await api.sendVoice(selectedContact.id, replyText, selectedVoice);
        if (res.error) throw new Error(res.error);
        toast.success('Voice note sent');
      }
      setReplyText('');
      setPreviewUrl(null);
      if (!selectedContact.id.startsWith('temp-')) {
        const msgs = await api.getMessages(selectedContact.id);
        setMessages(msgs);
      }
      await refreshConversations();
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handlePreviewVoice = async () => {
    if (!replyText.trim()) return;
    setPreviewing(true);
    try {
      const blob = await api.previewVoice(replyText, selectedVoice);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (err: any) {
      toast.error(err.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleStartNewChat = async (contact?: Contact) => {
    if (contact) {
      setSelectedContact(contact);
      setShowNewChat(false);
      setNewChatPhone('');
      setContactSearch('');
      return;
    }
    
    const phone = newChatPhone.replace(/[^0-9+]/g, '');
    if (phone.length < 7) {
      toast.error('Enter a valid phone number');
      return;
    }
    
    setNewChatLoading(true);
    try {
      const jid = phone.replace(/^\+/, '') + '@s.whatsapp.net';
      
      // Check if contact already exists
      const existing = [...conversations, ...allContacts].find(
        c => c.phone?.replace(/[^0-9]/g, '') === phone.replace(/[^0-9]/g, '') || c.jid === jid
      );
      
      if (existing) {
        setSelectedContact(existing);
      } else {
        // Create a temporary contact entry for display — message will create the real one
        const tempContact: Contact = {
          id: 'temp-' + Date.now(),
          jid,
          name: null,
          phone: phone.startsWith('+') ? phone : '+' + phone,
          avatar_url: null,
          is_group: 0,
          last_seen: null,
          updated_at: new Date().toISOString(),
        };
        setSelectedContact(tempContact);
      }
      
      setShowNewChat(false);
      setNewChatPhone('');
      setContactSearch('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to start conversation');
    } finally {
      setNewChatLoading(false);
    }
  };

  const filteredNewChatContacts = useMemo(() => {
    if (!contactSearch.trim()) return allContacts.slice(0, 20);
    const q = contactSearch.toLowerCase();
    return allContacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      cleanPhone(c.phone || '').includes(q)
    ).slice(0, 20);
  }, [allContacts, contactSearch]);

  // On mobile: show either list or chat
  const showChatOnMobile = !!selectedContact;

  return (
    <div className="space-y-4">
      <h1 className="text-xl md:text-2xl font-bold text-foreground">Conversations</h1>

      <div className="relative flex gap-4 h-[calc(100vh-180px)] md:h-[calc(100vh-180px)] h-[calc(100dvh-160px)]">
        {/* Contact list - hidden on mobile when chat is open */}
        <div className={`${showChatOnMobile ? 'hidden md:flex' : 'flex'} w-full md:w-72 flex-shrink-0 glass rounded-xl overflow-hidden flex-col`}>
          <div className="p-3 border-b border-border">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <button
                onClick={() => setShowNewChat(true)}
                className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
                title="New conversation"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No conversations yet</p>
            ) : (
              filtered.map(contact => {
                const isActive = selectedContact?.id === contact.id;
                return (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedContact(contact)}
                    className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                      isActive ? 'bg-secondary' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground flex-shrink-0">
                       {getInitials(contact)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-baseline">
                         <p className="text-sm font-medium text-foreground truncate">{getDisplayName(contact)}</p>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-2">
                          {contact.last_timestamp ? formatTime(contact.last_timestamp) : ''}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {contact.last_type === 'voice' ? '🎤 Voice note' : contact.last_message}
                      </p>
                       <p className="text-[10px] text-muted-foreground/60">{getDisplayMeta(contact)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat view - full width on mobile */}
        <div className={`${!showChatOnMobile && !showNewChat ? 'hidden md:flex' : showNewChat && !showChatOnMobile ? 'hidden md:flex' : 'flex'} flex-1 glass rounded-xl overflow-hidden flex-col`}>
          {selectedContact ? (
            <>
              <div className="px-3 md:px-4 py-3 border-b border-border flex items-center gap-3">
                {/* Back button on mobile */}
                <button
                  onClick={() => setSelectedContact(null)}
                  className="md:hidden p-1 -ml-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                  {getInitials(selectedContact)}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{getDisplayName(selectedContact)}</p>
                  <p className="text-xs text-muted-foreground">{getDisplayMeta(selectedContact)}</p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2">
                {messages.map((msg, i) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className={`flex ${msg.direction === 'sent' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] md:max-w-[65%] px-3 py-2 rounded-xl text-sm ${
                        msg.direction === 'sent'
                          ? 'bg-primary/20 text-foreground rounded-br-sm'
                          : 'bg-secondary text-foreground rounded-bl-sm'
                      }`}
                    >
                      {msg.type === 'voice' ? (
                        <div className="flex items-center gap-2">
                          <Mic className="w-4 h-4 text-primary" />
                          <div className="flex gap-0.5">
                            {Array.from({ length: 20 }).map((_, j) => (
                              <div
                                key={j}
                                className="w-0.5 bg-primary/60 rounded-full"
                                style={{ height: `${Math.random() * 16 + 4}px` }}
                              />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground ml-1">
                            {msg.duration ? `0:${String(msg.duration).padStart(2, '0')}` : ''}
                          </span>
                        </div>
                      ) : (
                        msg.content
                      )}
                      <div className={`flex items-center gap-1 mt-1 ${msg.direction === 'sent' ? 'justify-end' : ''}`}>
                        <span className="text-[10px] text-muted-foreground">{formatTime(msg.timestamp)}</span>
                        {msg.direction === 'sent' && <StatusIcon status={msg.status} />}
                      </div>
                    </div>
                  </motion.div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply box */}
              <div className="border-t border-border p-2 md:p-3 space-y-2">
                {previewUrl && (
                  <div className="flex items-center gap-2 bg-secondary rounded-lg p-2">
                    <button
                      onClick={togglePlay}
                      className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
                    >
                      {isPlaying ? <Square className="w-3 h-3 text-primary-foreground" /> : <Play className="w-3 h-3 text-primary-foreground ml-0.5" />}
                    </button>
                    <div className="flex-1 flex gap-0.5 items-center">
                      {Array.from({ length: 30 }).map((_, i) => (
                        <div key={i} className="w-0.5 bg-primary/50 rounded-full" style={{ height: `${Math.random() * 14 + 4}px` }} />
                      ))}
                    </div>
                    <audio ref={audioRef} src={previewUrl} onEnded={() => setIsPlaying(false)} />
                    <button onClick={() => setPreviewUrl(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setReplyMode('text'); setPreviewUrl(null); }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      replyMode === 'text' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setReplyMode('voice')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      replyMode === 'voice' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    🎤 Voice
                  </button>
                  {replyMode === 'voice' && voices.length > 0 && (
                    <select
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      className="ml-auto px-2 py-1 rounded bg-secondary border border-border text-xs text-foreground max-w-[120px]"
                    >
                      {voices.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    value={replyText}
                    onChange={(e) => { setReplyText(e.target.value); setPreviewUrl(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
                    placeholder={replyMode === 'voice' ? 'Text to voice...' : 'Type a message...'}
                    className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-0"
                  />
                  {replyMode === 'voice' && (
                    <button
                      onClick={handlePreviewVoice}
                      disabled={!replyText.trim() || previewing}
                      className="px-2.5 py-2 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-40 flex-shrink-0"
                      title="Preview voice"
                    >
                      {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || sending}
                    className="px-2.5 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 flex-shrink-0"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation to view messages
            </div>
          )}
        </div>

        {/* New conversation panel — replaces chat on mobile, overlay on desktop */}
        {showNewChat && (
          <div className={`${showChatOnMobile ? 'hidden' : 'flex'} md:absolute md:inset-0 md:z-50 md:bg-background/80 md:backdrop-blur-sm md:items-center md:justify-center flex-col w-full md:w-auto`}>
            <div className="w-full md:w-96 md:max-h-[80vh] glass md:rounded-xl overflow-hidden flex flex-col md:border md:border-border">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">New Conversation</h3>
                <button
                  onClick={() => { setShowNewChat(false); setNewChatPhone(''); setContactSearch(''); }}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              {/* Phone number input */}
              <div className="p-3 border-b border-border space-y-2">
                <div className="flex gap-2">
                  <input
                    value={newChatPhone}
                    onChange={(e) => setNewChatPhone(e.target.value)}
                    placeholder="Enter phone number (e.g. +1234567890)"
                    className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleStartNewChat(); }}
                  />
                  <button
                    onClick={() => handleStartNewChat()}
                    disabled={newChatPhone.replace(/[^0-9]/g, '').length < 7 || newChatLoading}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-40 flex-shrink-0"
                  >
                    {newChatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Chat'}
                  </button>
                </div>
              </div>

              {/* Or pick from contacts */}
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Or search contacts..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[50vh]">
                {filteredNewChatContacts.map(contact => (
                  <button
                    key={contact.id}
                    onClick={() => handleStartNewChat(contact)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/50 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0">
                      {getInitials(contact)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{getDisplayName(contact)}</p>
                      <p className="text-xs text-muted-foreground">{getDisplayMeta(contact)}</p>
                    </div>
                  </button>
                ))}
                {filteredNewChatContacts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">No contacts found</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationsPage;
