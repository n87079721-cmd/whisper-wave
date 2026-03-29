import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Mic, Check, CheckCheck, Send, Loader2, Volume2, Play, Square, ArrowLeft, Plus, X, MessageSquare, ChevronDown, ChevronUp, Trash2, Pause } from 'lucide-react';
import { api, type Contact, type Message, type Voice } from '@/lib/api';
import { toast } from 'sonner';
import { cleanContactPhone, getContactDisplayMeta, getContactDisplayName, getContactInitials } from '@/lib/contactDisplay';

interface ConversationsPageProps {
  initialContact?: Contact | null;
  onContactOpened?: () => void;
  onNavigateSettings?: () => void;
}

const ConversationsPage = ({ initialContact, onContactOpened }: ConversationsPageProps) => {
  const [conversations, setConversations] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
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
  const conversationsRefreshTimerRef = useRef<number | null>(null);
  const contactsRefreshTimerRef = useRef<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [recoveringChat, setRecoveringChat] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const chatSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [deletingMessage, setDeletingMessage] = useState<string | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
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
      const result = await api.getMessages(contactId, { limit: 100 });
      setMessages(result.messages);
      setHasMoreMessages(result.hasMore);
      const shouldScroll = options?.forceScroll ?? shouldAutoScrollRef.current;
      if (shouldScroll) {
        const behavior = options?.behavior ?? 'auto';
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => scrollMessagesToBottom(behavior));
        });
      }
    } catch {}
  }, [scrollMessagesToBottom]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedContact || loadingOlder || !hasMoreMessages || messages.length === 0) return;
    setLoadingOlder(true);
    const viewport = messagesViewportRef.current;
    const prevScrollHeight = viewport?.scrollHeight || 0;
    try {
      const oldest = messages[0]?.timestamp;
      const result = await api.getMessages(selectedContact.id, { limit: 50, before: oldest });
      if (result.messages.length > 0) {
        setMessages(prev => [...result.messages, ...prev]);
        setHasMoreMessages(result.hasMore);
        // Maintain scroll position
        window.requestAnimationFrame(() => {
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight - prevScrollHeight;
          }
        });
      } else {
        setHasMoreMessages(false);
      }
    } catch {}
    setLoadingOlder(false);
  }, [selectedContact, loadingOlder, hasMoreMessages, messages]);

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

  const scheduleConversationRefresh = useCallback(() => {
    if (conversationsRefreshTimerRef.current !== null) return;
    conversationsRefreshTimerRef.current = window.setTimeout(() => {
      conversationsRefreshTimerRef.current = null;
      refreshConversations();
    }, 120);
  }, [refreshConversations]);

  const scheduleContactsRefresh = useCallback(() => {
    if (contactsRefreshTimerRef.current !== null) return;
    contactsRefreshTimerRef.current = window.setTimeout(() => {
      contactsRefreshTimerRef.current = null;
      refreshAllContacts();
    }, 180);
  }, [refreshAllContacts]);

  useEffect(() => {
    refreshConversations().then(() => setLoading(false));
    api.getVoices().then(setVoices).catch(() => {});
  }, [refreshConversations]);

  useEffect(() => {
    if (!showNewChat || allContacts.length > 0) return;
    refreshAllContacts();
  }, [allContacts.length, refreshAllContacts, showNewChat]);

  useEffect(() => {
    if (!initialContact) return;
    setSelectedContact(initialContact);
    onContactOpened?.();
  }, [initialContact, onContactOpened]);

  useEffect(() => {
    const refreshSelectedConversation = () => {
      const current = selectedContactRef.current;
      if (current) refreshMessages(current.id);
    };

    const handleMessageEvent = (event: Event) => {
      scheduleConversationRefresh();
      const current = selectedContactRef.current;
      if (!current) return;
      try {
        const data = event instanceof MessageEvent ? JSON.parse(event.data) : null;
        if (!data?.contactId || data.contactId === current.id) {
          refreshMessages(current.id);
        }
      } catch {
        refreshMessages(current.id);
      }
    };

    const handleHistoryEvent = () => {
      scheduleConversationRefresh();
      refreshSelectedConversation();
      if (showNewChat) scheduleContactsRefresh();
    };

    const handleContactsEvent = () => {
      scheduleConversationRefresh();
      if (showNewChat) scheduleContactsRefresh();
    };

    let es: EventSource | null = null;
    try {
      es = api.createEventSource();
      es.addEventListener('message', handleMessageEvent);
      es.addEventListener('history_sync', handleHistoryEvent);
      es.addEventListener('contacts_sync', handleContactsEvent);
      es.onerror = () => {};
    } catch {}

    const interval = window.setInterval(() => {
      refreshConversations();
      refreshSelectedConversation();
      if (showNewChat) refreshAllContacts();
    }, 30000);

    return () => {
      es?.close();
      window.clearInterval(interval);
      if (conversationsRefreshTimerRef.current !== null) {
        window.clearTimeout(conversationsRefreshTimerRef.current);
        conversationsRefreshTimerRef.current = null;
      }
      if (contactsRefreshTimerRef.current !== null) {
        window.clearTimeout(contactsRefreshTimerRef.current);
        contactsRefreshTimerRef.current = null;
      }
    };
  }, [showNewChat, refreshAllContacts, refreshConversations, refreshMessages, scheduleContactsRefresh, scheduleConversationRefresh]);

  useEffect(() => {
    if (!selectedContact?.id) return;
    shouldAutoScrollRef.current = true;
    setShowScrollDown(false);
    refreshMessages(selectedContact.id, { forceScroll: true });
  }, [selectedContact?.id, refreshMessages]);

  const normalizePhoneDigits = (value: string) => value.replace(/\D/g, '');
  const formatPhoneDraft = (value: string) => {
    const trimmed = value.trim();
    const digits = normalizePhoneDigits(trimmed);
    return trimmed.startsWith('+') ? `+${digits}` : digits;
  };

  const filtered = conversations.filter(c =>
    getContactDisplayName(c).toLowerCase().includes(search.toLowerCase()) ||
    cleanContactPhone(c.phone || '').includes(search)
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

  const StatusLabel = ({ status }: { status: string }) => {
    if (status === 'read') return <span className="text-[10px] text-primary font-medium">Read</span>;
    if (status === 'delivered') return <span className="text-[10px] text-muted-foreground">Delivered</span>;
    return <span className="text-[10px] text-muted-foreground">Sent</span>;
  };

  const Avatar = ({ contact, size = 'md' }: { contact: Contact; size?: 'sm' | 'md' | 'lg' }) => {
    const sizeClasses = size === 'lg' ? 'w-10 h-10 text-sm' : size === 'md' ? 'w-[46px] h-[46px] text-sm' : 'w-9 h-9 text-xs';
    const altText = getContactDisplayName(contact);
    
    if (contact.avatar_url) {
      return <img src={contact.avatar_url} alt={altText} className={`${sizeClasses} rounded-full object-cover flex-shrink-0`} />;
    }
    return (
      <div
        className={`${sizeClasses} rounded-full flex items-center justify-center border border-border bg-muted font-medium text-foreground flex-shrink-0`}
      >
        {getContactInitials(contact)}
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
        const result = await api.getMessages(selectedContact.id, { limit: 100 });
        setMessages(result.messages);
        setHasMoreMessages(result.hasMore);
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
      getContactDisplayName(c).toLowerCase().includes(q) || cleanContactPhone(c.phone || '').includes(q)
    ).slice(0, 30);
  }, [allContacts, contactSearch]);

  const showChatOnMobile = !!selectedContact;

  // In-chat search matches
  const chatSearchMatches = useMemo(() => {
    if (!chatSearch.trim()) return [] as number[];
    const q = chatSearch.toLowerCase();
    return messages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.type !== 'voice' && msg.content?.toLowerCase().includes(q))
      .map(({ idx }) => idx);
  }, [messages, chatSearch]);

  useEffect(() => {
    if (chatSearchMatches.length > 0) setChatSearchIndex(0);
  }, [chatSearchMatches.length, chatSearch]);

  const scrollToChatSearchMatch = useCallback((matchIdx: number) => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const msgIdx = chatSearchMatches[matchIdx];
    const el = viewport.querySelector(`[data-msg-idx="${msgIdx}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [chatSearchMatches]);

  useEffect(() => {
    if (chatSearchMatches.length > 0) scrollToChatSearchMatch(chatSearchIndex);
  }, [chatSearchIndex, chatSearchMatches, scrollToChatSearchMatch]);

  const chatSearchMatchSet = useMemo(() => new Set(chatSearchMatches), [chatSearchMatches]);
  const activeChatSearchIdx = chatSearchMatches[chatSearchIndex] ?? -1;

  // Voice note playback
  const handlePlayVoice = useCallback((msg: Message) => {
    if (!msg.media_path) { toast.error('Voice note not available for playback'); return; }
    if (playingVoiceId === msg.id) {
      voiceAudioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }
    if (voiceAudioRef.current) { voiceAudioRef.current.pause(); }
    const url = api.getVoiceMediaUrl(msg.media_path);
    const audio = new Audio(url);
    voiceAudioRef.current = audio;
    setPlayingVoiceId(msg.id);
    audio.play().catch(() => toast.error('Could not play voice note'));
    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => { setPlayingVoiceId(null); toast.error('Voice note playback failed'); };
  }, [playingVoiceId]);

  // Delete a single message
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!confirm('Delete this message? It will also be deleted from WhatsApp.')) return;
    setDeletingMessage(messageId);
    try {
      await api.deleteMessage(messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
      toast.success('Message deleted');
      refreshConversations();
    } catch (err: any) { toast.error(err.message || 'Failed to delete'); }
    finally { setDeletingMessage(null); }
  }, [refreshConversations]);

  // Delete entire conversation
  const handleDeleteConversation = useCallback(async () => {
    if (!selectedContact) return;
    if (!confirm(`Delete entire conversation with ${getContactDisplayName(selectedContact)}? This will also clear it from WhatsApp.`)) return;
    setDeletingConversation(true);
    try {
      await api.deleteConversation(selectedContact.id);
      setSelectedContact(null);
      setMessages([]);
      toast.success('Conversation deleted');
      refreshConversations();
    } catch (err: any) { toast.error(err.message || 'Failed to delete'); }
    finally { setDeletingConversation(false); }
  }, [selectedContact, refreshConversations]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: (Message & { _idx: number })[] }[] = [];
    let currentDate = '';
    let idx = 0;
    for (const msg of messages) {
      const date = formatDate(msg.timestamp);
      const tagged = { ...msg, _idx: idx };
      if (date !== currentDate) {
        currentDate = date;
        groups.push({ date, messages: [tagged] });
      } else {
        groups[groups.length - 1].messages.push(tagged);
      }
      idx++;
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
                          {getContactDisplayName(contact)}
                        </p>
                        <span className={`text-[11px] flex-shrink-0 ml-2 ${
                          isActive ? 'text-foreground/70' : 'text-muted-foreground'
                        }`}>
                          {contact.last_timestamp ? formatDate(contact.last_timestamp) : ''}
                        </span>
                      </div>
                      <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                        {contact.last_type === 'voice' ? '🎤 Voice note' : contact.last_message || getContactDisplayMeta(contact)}
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
                  <p className="text-[15px] font-semibold text-foreground truncate">{getContactDisplayName(selectedContact)}</p>
                  <p className="text-xs text-muted-foreground truncate">{getContactDisplayMeta(selectedContact)}</p>
                </div>
                <button
                  onClick={() => { setChatSearchOpen(o => !o); setChatSearch(''); setTimeout(() => chatSearchInputRef.current?.focus(), 100); }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
                  title="Search in chat"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>

              {/* In-chat search bar */}
              {chatSearchOpen && (
                <div className="px-3 py-2 border-b border-border bg-background flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      ref={chatSearchInputRef}
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder="Search messages..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-md bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                  </div>
                  {chatSearchMatches.length > 0 && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {chatSearchIndex + 1}/{chatSearchMatches.length}
                    </span>
                  )}
                  <button
                    onClick={() => setChatSearchIndex(i => (i > 0 ? i - 1 : chatSearchMatches.length - 1))}
                    disabled={chatSearchMatches.length === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setChatSearchIndex(i => (i < chatSearchMatches.length - 1 ? i + 1 : 0))}
                    disabled={chatSearchMatches.length === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setChatSearchOpen(false); setChatSearch(''); }}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Messages area */}
              <div className="relative flex-1 min-h-0">
                <div
                  ref={messagesViewportRef}
                  onScroll={syncAutoScrollState}
                  className="absolute inset-0 overflow-y-auto overscroll-contain p-3 md:p-4 bg-chat-bg"
                >
                  {/* Load older messages button */}
                  {hasMoreMessages && (
                    <div className="flex justify-center mb-3">
                      <button
                        onClick={loadOlderMessages}
                        disabled={loadingOlder}
                        className="px-3 py-1.5 rounded-lg bg-card/90 text-[11px] text-primary font-medium shadow-sm hover:bg-card transition-colors disabled:opacity-50"
                      >
                        {loadingOlder ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                        {loadingOlder ? 'Loading...' : 'Load older messages'}
                      </button>
                    </div>
                  )}

                  {/* Fetch history button for empty chats */}
                  {messages.length === 0 && selectedContact && !selectedContact.id.startsWith('temp-') && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <MessageSquare className="w-10 h-10 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">No messages yet</p>
                      <button
                        onClick={async () => {
                          setRecoveringChat(true);
                          try {
                            const res = await api.recoverChat(selectedContact.id);
                            toast.success(res.message || 'History request sent');
                            // Wait a bit then refresh
                            setTimeout(() => {
                              refreshMessages(selectedContact.id, { forceScroll: true });
                            }, 3000);
                          } catch (err: any) {
                            toast.error(err.message || 'Failed to recover chat');
                          } finally {
                            setRecoveringChat(false);
                          }
                        }}
                        disabled={recoveringChat}
                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {recoveringChat && <Loader2 className="w-4 h-4 animate-spin" />}
                        {recoveringChat ? 'Fetching...' : 'Fetch chat history'}
                      </button>
                    </div>
                  )}

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
                        {group.messages.map((msg) => {
                          const isMatch = chatSearchMatchSet.has(msg._idx);
                          const isActive = msg._idx === activeChatSearchIdx;
                          return (
                          <div
                            key={msg.id}
                            data-msg-idx={msg._idx}
                            className={`flex ${msg.direction === 'sent' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[85%] md:max-w-[65%] px-3 py-2 rounded-2xl text-[14px] ${
                                msg.direction === 'sent'
                                  ? 'bg-bubble-out text-bubble-out-foreground rounded-br-md'
                                  : 'bg-bubble-in text-bubble-in-foreground rounded-bl-md'
                              } ${isActive ? 'ring-2 ring-primary' : isMatch ? 'ring-1 ring-primary/40' : ''}`}
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
                                <span className={`text-[10px] ${msg.direction === 'sent' ? 'text-bubble-out-foreground/70' : 'text-muted-foreground'}`}>{formatTime(msg.timestamp)}</span>
                                {msg.direction === 'sent' && <StatusLabel status={msg.status} />}
                              </div>
                            </div>
                          </div>
                          );
                        })}
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
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 bg-chat-bg">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">Messages</h2>
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
                      <p className="text-sm font-medium text-foreground truncate">{getContactDisplayName(contact)}</p>
                      <p className="text-xs text-muted-foreground">{getContactDisplayMeta(contact)}</p>
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
