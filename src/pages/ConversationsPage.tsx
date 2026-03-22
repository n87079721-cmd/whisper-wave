import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Mic, Check, CheckCheck, Send, Loader2, Volume2, Play, Square, ArrowLeft, Plus, X, MessageSquare, ChevronDown } from 'lucide-react';
import { api, type Contact, type Message, type Voice } from '@/lib/api';
import { toast } from 'sonner';
import { getAvatarColor } from '@/lib/avatarColors';

interface ConversationsPageProps {
  initialContact?: Contact | null;
  onContactOpened?: () => void;
  onNavigateSettings?: () => void;
}

const ConversationsPage = ({ initialContact, onContactOpened }: ConversationsPageProps) => {
  const [conversations, setConversations] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [replyText, setReplyText] = useState('');
  const [replyMode, setReplyMode] = useState<'text' | 'voice'>('text');
  const [sending, setSending] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('JBFqnCBsd6RMkjVDRZzb');

  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);

  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  const selectedContactRef = useRef<Contact | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  selectedContactRef.current = selectedContact;

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const syncAutoScrollState = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 150;
    setShowScrollDown(distanceFromBottom > 300);
  }, []);

  const refreshMessages = useCallback(async (
    contactId: string,
    options?: { forceScroll?: boolean; behavior?: ScrollBehavior },
  ) => {
    try {
      const msgs = await api.getMessages(contactId);
      setMessages(msgs);
      const shouldScroll = options?.forceScroll ?? shouldAutoScrollRef.current;
      if (shouldScroll) {
        const behavior = options?.behavior ?? 'auto';
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => scrollMessagesToBottom(behavior));
        });
      }
    } catch {}
  }, [scrollMessagesToBottom]);

  const refreshAllContacts = useCallback(async () => {
    try { setAllContacts(await api.getContacts()); } catch {}
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

  useEffect(() => {
    if (!initialContact) return;
    setSelectedContact(initialContact);
    onContactOpened?.();
  }, [initialContact, onContactOpened]);

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

    const interval = setInterval(refreshActiveConversation, 5000);
    return () => { es?.close(); clearInterval(interval); };
  }, [refreshAllContacts, refreshConversations, refreshMessages]);

  useEffect(() => {
    if (!selectedContact) return;
    shouldAutoScrollRef.current = true;
    refreshMessages(selectedContact.id, { forceScroll: true });
  }, [selectedContact, refreshMessages]);

  const cleanPhone = (p: string) => p?.replace(/@.*$/, '') || '';
  const normalizePhoneDigits = (value: string) => value.replace(/\D/g, '');
  const formatPhoneDraft = (value: string) => {
    const trimmed = value.trim();
    const digits = normalizePhoneDigits(trimmed);
    return trimmed.startsWith('+') ? `+${digits}` : digits;
  };

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
    getDisplayName(contact).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const filtered = conversations.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    cleanPhone(c.phone || '').includes(search)
  );

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return ts; }
  };

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      if (diff < 86400000 && d.getDate() === now.getDate()) return 'Today';
      if (diff < 172800000) return 'Yesterday';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'read') return <CheckCheck className="w-3.5 h-3.5 text-info" />;
    if (status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />;
    return <Check className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const Avatar = ({ contact, size = 'md' }: { contact: Contact; size?: 'sm' | 'md' | 'lg' }) => {
    const sizeClasses = size === 'lg' ? 'w-10 h-10 text-sm' : size === 'md' ? 'w-[46px] h-[46px] text-sm' : 'w-9 h-9 text-xs';
    const color = getAvatarColor(contact.jid || contact.id);
    
    if (contact.avatar_url) {
      return <img src={contact.avatar_url} alt="" className={`${sizeClasses} rounded-full object-cover flex-shrink-0`} />;
    }
    return (
      <div
        className={`${sizeClasses} rounded-full flex items-center justify-center font-medium text-white flex-shrink-0`}
        style={{ backgroundColor: `hsl(${color})` }}
      >
        {getInitials(contact)}
      </div>
    );
  };

  const handleSendReply = async () => {
    if (!selectedContact || !replyText.trim()) return;
    setSending(true);
    try {
      const activeContactId = selectedContact.id;
      const isTemp = selectedContact.id.startsWith('temp-');
      if (replyMode === 'text') {
        const res = isTemp
          ? await api.sendTextToPhone(selectedContact.phone || '', replyText)
          : await api.sendText(selectedContact.id, replyText);
        if (res.error) throw new Error(res.error);
        toast.success('Message sent');

        const refreshedConversations = await api.getConversations();
        setConversations(refreshedConversations);

        const nextContact = (res.contactId && refreshedConversations.find(c => c.id === res.contactId))
          || refreshedConversations.find(c => c.id === activeContactId)
          || null;

        if (nextContact) {
          setSelectedContact(nextContact);
          await refreshMessages(nextContact.id, { forceScroll: true });
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
      if (replyMode === 'voice' && !selectedContact.id.startsWith('temp-')) {
        const msgs = await api.getMessages(selectedContact.id);
        setMessages(msgs);
        await refreshConversations();
      }
      scrollMessagesToBottom('smooth');
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
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      toast.error(err.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { audioRef.current.play(); setIsPlaying(true); }
  };

  const handleStartNewChat = async (contact?: Contact) => {
    if (contact) {
      setSelectedContact(contact);
      setShowNewChat(false);
      setNewChatPhone('');
      setContactSearch('');
      return;
    }
    
    const phoneDigits = normalizePhoneDigits(newChatPhone);
    if (phoneDigits.length < 7) { toast.error('Enter a valid phone number'); return; }
    
    setNewChatLoading(true);
    try {
      const canonicalPhone = `+${phoneDigits}`;
      const jid = `${phoneDigits}@s.whatsapp.net`;
      
      const existing = [...conversations, ...allContacts].find(
        c => normalizePhoneDigits(c.phone || '') === phoneDigits || c.jid === jid
      );
      
      if (existing) {
        setSelectedContact(existing);
      } else {
        const tempContact: Contact = {
          id: 'temp-' + Date.now(), jid, name: null, phone: canonicalPhone,
          avatar_url: null, is_group: 0, last_seen: null, updated_at: new Date().toISOString(),
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
    if (!contactSearch.trim()) return allContacts.slice(0, 30);
    const q = contactSearch.toLowerCase();
    return allContacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) || cleanPhone(c.phone || '').includes(q)
    ).slice(0, 30);
  }, [allContacts, contactSearch]);

  const showChatOnMobile = !!selectedContact;

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    for (const msg of messages) {
      const date = formatDate(msg.timestamp);
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  }, [messages]);

  return (
    <div className="h-[calc(100dvh-5rem)] md:h-[calc(100vh-2.5rem)] flex flex-col">
      <div className="flex-1 flex min-h-0 rounded-xl overflow-hidden border border-border bg-card">
        {/* ===== LEFT: Conversation list ===== */}
        <div className={`${showChatOnMobile ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] lg:w-[380px] flex-shrink-0 flex-col border-r border-border bg-background`}>
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between">
            <h1 className="text-lg font-bold text-foreground">Chats</h1>
            <button
              type="button"
              onClick={() => { setNewChatPhone(''); setContactSearch(''); setShowNewChat(true); }}
              className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
              title="New chat"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search or start new chat"
                className="w-full pl-10 pr-3 py-2 rounded-lg bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No conversations yet</p>
            ) : (
              filtered.map(contact => {
                const isActive = selectedContact?.id === contact.id;
                return (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedContact(contact)}
                    className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors ${
                      isActive ? 'bg-accent' : 'hover:bg-secondary/60'
                    }`}
                  >
                    <Avatar contact={contact} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-baseline">
                        <p className={`text-[15px] truncate ${isActive ? 'text-foreground font-semibold' : 'text-foreground font-medium'}`}>
                          {getDisplayName(contact)}
                        </p>
                        <span className={`text-[11px] flex-shrink-0 ml-2 ${
                          isActive ? 'text-foreground/70' : 'text-muted-foreground'
                        }`}>
                          {contact.last_timestamp ? formatDate(contact.last_timestamp) : ''}
                        </span>
                      </div>
                      <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                        {contact.last_type === 'voice' ? '🎤 Voice note' : contact.last_message || getDisplayMeta(contact)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ===== RIGHT: Chat view ===== */}
        <div className={`${!showChatOnMobile && !showNewChat ? 'hidden md:flex' : showNewChat && !showChatOnMobile ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0`}>
          {selectedContact ? (
            <>
              {/* Chat header */}
              <div className="px-3 md:px-4 py-2.5 border-b border-border flex items-center gap-3 bg-background">
                <button
                  onClick={() => setSelectedContact(null)}
                  className="md:hidden p-1 -ml-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <Avatar contact={selectedContact} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-foreground truncate">{getDisplayName(selectedContact)}</p>
                  <p className="text-xs text-muted-foreground truncate">{getDisplayMeta(selectedContact)}</p>
                </div>
              </div>

              {/* Messages area */}
              <div className="relative flex-1 min-h-0">
                <div
                  ref={messagesViewportRef}
                  onScroll={syncAutoScrollState}
                  className="absolute inset-0 overflow-y-auto overscroll-contain p-3 md:p-4 wa-pattern"
                >
                  {groupedMessages.map((group) => (
                    <div key={group.date}>
                      {/* Date separator */}
                      <div className="flex justify-center my-3">
                        <span className="px-3 py-1 rounded-lg bg-card/90 text-[11px] text-muted-foreground shadow-sm">
                          {group.date}
                        </span>
                      </div>
                      {/* Messages */}
                      <div className="space-y-1">
                        {group.messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.direction === 'sent' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[85%] md:max-w-[65%] px-3 py-1.5 rounded-lg text-[14px] shadow-sm ${
                                msg.direction === 'sent'
                                  ? 'bg-wa-bubble-out text-foreground rounded-tr-none'
                                  : 'bg-wa-bubble-in text-foreground rounded-tl-none'
                              }`}
                            >
                              {msg.type === 'voice' ? (
                                <div className="flex items-center gap-2">
                                  <Mic className="w-4 h-4 text-primary" />
                                  <div className="flex gap-0.5">
                                    {Array.from({ length: 20 }).map((_, j) => (
                                      <div key={j} className="w-0.5 bg-primary/60 rounded-full" style={{ height: `${Math.random() * 16 + 4}px` }} />
                                    ))}
                                  </div>
                                  <span className="text-xs text-muted-foreground ml-1">
                                    {msg.duration ? `0:${String(msg.duration).padStart(2, '0')}` : ''}
                                  </span>
                                </div>
                              ) : (
                                <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                              )}
                              <div className={`flex items-center gap-1 mt-0.5 ${msg.direction === 'sent' ? 'justify-end' : ''}`}>
                                <span className="text-[10px] text-muted-foreground">{formatTime(msg.timestamp)}</span>
                                {msg.direction === 'sent' && <StatusIcon status={msg.status} />}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Scroll to bottom button */}
                {showScrollDown && (
                  <button
                    onClick={() => { scrollMessagesToBottom('smooth'); shouldAutoScrollRef.current = true; }}
                    className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center hover:bg-secondary transition-colors z-10"
                  >
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
              </div>

              {/* Reply box */}
              <div className="border-t border-border bg-background p-2 md:p-3 space-y-2">
                {previewUrl && (
                  <div className="flex items-center gap-2 bg-secondary rounded-lg p-2">
                    <button onClick={togglePlay} className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
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

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setReplyMode('text'); setPreviewUrl(null); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      replyMode === 'text' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                    }`}
                  >Text</button>
                  <button
                    onClick={() => setReplyMode('voice')}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      replyMode === 'voice' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                    }`}
                  >🎤 Voice</button>
                  {replyMode === 'voice' && voices.length > 0 && (
                    <select
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      className="ml-auto px-2 py-1 rounded-full bg-secondary border border-border text-xs text-foreground max-w-[120px]"
                    >
                      {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    value={replyText}
                    onChange={(e) => { setReplyText(e.target.value); setPreviewUrl(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
                    placeholder={replyMode === 'voice' ? 'Text to voice...' : 'Type a message'}
                    className="flex-1 px-4 py-2.5 rounded-full bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-w-0"
                  />
                  {replyMode === 'voice' && (
                    <button
                      onClick={handlePreviewVoice}
                      disabled={!replyText.trim() || previewing}
                      className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-40 flex-shrink-0"
                    >
                      {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || sending}
                    className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40 flex-shrink-0"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 wa-pattern">
              <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">WA Controller</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Send and receive messages, voice notes, and manage conversations. Select a chat to get started.
              </p>
            </div>
          )}
        </div>

        {/* ===== New chat overlay ===== */}
        {showNewChat && (
          <div className="fixed inset-0 z-[70] flex items-end bg-background/80 backdrop-blur-sm md:absolute md:items-center md:justify-center">
            <div className="w-full overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl md:w-[26rem] md:max-h-[80vh] md:rounded-2xl">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">New Conversation</h3>
                <button type="button" onClick={() => { setShowNewChat(false); setNewChatPhone(''); setContactSearch(''); }} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="p-3 border-b border-border space-y-2">
                <div className="flex gap-2">
                  <input
                    value={newChatPhone}
                    onChange={(e) => setNewChatPhone(formatPhoneDraft(e.target.value))}
                    placeholder="Phone number (e.g. +1234567890)"
                    className="flex-1 px-3 py-2 rounded-lg bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleStartNewChat(); }}
                  />
                  <button
                    type="button"
                    onClick={() => handleStartNewChat()}
                    disabled={newChatPhone.replace(/[^0-9]/g, '').length < 7 || newChatLoading}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-40 flex-shrink-0"
                  >
                    {newChatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Chat'}
                  </button>
                </div>
              </div>

              <div className="p-3 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Search contacts..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
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
                    <Avatar contact={contact} size="sm" />
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
