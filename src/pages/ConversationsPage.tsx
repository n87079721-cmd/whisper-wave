import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Send, Loader2, Volume2, ArrowLeft, Plus, X, MessageSquare, ChevronDown, ChevronUp, Trash2, Archive, ArchiveRestore, FileText, Download, Image as ImageIcon, Film, Eye, EyeOff, Pencil, Check, PhoneMissed, Star, Reply, User, Copy, Forward } from 'lucide-react';
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
  const [sending, setSending] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const replyDraftsRef = useRef<Record<string, string>>({});

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
  const [deleteMenuMsgId, setDeleteMenuMsgId] = useState<string | null>(null);
  const [deletingMessage, setDeletingMessage] = useState<string | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File;
    previewUrl: string | null;
    kind: 'image' | 'video' | 'audio' | 'document';
    viewOnce: boolean;
  } | null>(null);
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileMedia, setProfileMedia] = useState<Message[]>([]);
  const [profileMediaLoading, setProfileMediaLoading] = useState(false);
  const swipeRef = useRef<{ startX: number; msgId: string } | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<Message | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardSending, setForwardSending] = useState(false);
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

  const refreshAllContacts = useCallback(async (search?: string) => {
    try { setAllContacts(await api.getContacts({ search, limit: 50 })); } catch {}
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
    // Sync archive states from WhatsApp then refresh conversations
    api.syncArchives().catch(() => {});
    refreshConversations().then(() => setLoading(false));
    // voices removed — AI voice mode moved to Voice Studio
  }, [refreshConversations]);

  useEffect(() => {
    if (!showNewChat) return;
    const timer = setTimeout(() => refreshAllContacts(contactSearch || undefined), contactSearch ? 300 : 0);
    return () => clearTimeout(timer);
  }, [showNewChat, contactSearch, refreshAllContacts]);

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
      if (showNewChat) refreshAllContacts(contactSearch || undefined);
    };

    const handleContactsEvent = () => {
      scheduleConversationRefresh();
      if (showNewChat) scheduleContactsRefresh();
    };

    const handleEditedEvent = (event: Event) => {
      try {
        const data = event instanceof MessageEvent ? JSON.parse(event.data) : null;
        if (data?.messageId) {
          setMessages(prev => prev.map(m => m.id === data.messageId ? { ...m, content: data.newContent, is_edited: 1 } : m));
        }
      } catch {}
    };

    let es: EventSource | null = null;
    try {
      es = api.createEventSource();
      es.addEventListener('message', handleMessageEvent);
      es.addEventListener('history_sync', handleHistoryEvent);
      es.addEventListener('contacts_sync', handleContactsEvent);
      es.addEventListener('message_edited', handleEditedEvent);
      es.onerror = () => {};
    } catch {}

    const interval = window.setInterval(() => {
      refreshConversations();
      refreshSelectedConversation();
      if (showNewChat) refreshAllContacts(contactSearch || undefined);
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
    setReplyText(replyDraftsRef.current[selectedContact.id] ?? '');
    // voice preview removed
    setQuotedMessage(null);
    setShowProfile(false);
    setEditingMsgId(null);
    refreshMessages(selectedContact.id, { forceScroll: true });
  }, [selectedContact?.id, refreshMessages]);

  // Mark chat as read when opened
  useEffect(() => {
    if (!selectedContact?.id) return;
    if ((selectedContact.unread_count ?? 0) > 0) {
      api.markChatRead(selectedContact.id).catch(() => {});
      setConversations(prev => prev.map(c => c.id === selectedContact.id ? { ...c, unread_count: 0 } : c));
    }
  }, [selectedContact?.id]);

  const normalizePhoneDigits = (value: string) => value.replace(/\D/g, '');
  const formatPhoneDraft = (value: string) => {
    const trimmed = value.trim();
    const digits = normalizePhoneDigits(trimmed);
    return trimmed.startsWith('+') ? `+${digits}` : digits;
  };

  const activeConversations = conversations.filter(c => !c.is_archived);
  const archivedConversations = conversations.filter(c => !!c.is_archived);

  const filtered = (showArchived ? archivedConversations : activeConversations).filter(c =>
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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const clearPendingAttachment = useCallback(() => {
    setPendingAttachment(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSelectAttachment = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const mimeType = file.type || 'application/octet-stream';
    const kind = mimeType.startsWith('image/')
      ? 'image'
      : mimeType.startsWith('video/')
        ? 'video'
        : mimeType.startsWith('audio/')
          ? 'audio'
          : 'document';

    const previewUrl = (kind === 'document') ? null : URL.createObjectURL(file);
    setPendingAttachment(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl, kind, viewOnce: false };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
    };
  }, [pendingAttachment]);

  useEffect(() => {
    if (!deleteMenuMsgId) return;
    const closeMenu = () => setDeleteMenuMsgId(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [deleteMenuMsgId]);

  const getConversationPreview = (contact: Contact) => {
    switch (contact.last_type) {
      case 'voice':
        return '🎤 Voice note';
      case 'image':
        return '📷 Photo';
      case 'video':
        return '🎬 Video';
      case 'document':
        return '📄 Document';
      default:
        return contact.last_message || getContactDisplayMeta(contact);
    }
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
    const activeContact = selectedContact;
    const activeContactId = activeContact?.id;
    const trimmedReply = replyText.trim();
    if (!activeContact || !activeContactId) return;
    if (!trimmedReply && !pendingAttachment) return;

    setSending(true);
    try {
      const isTemp = activeContactId.startsWith('temp-');

      const res = pendingAttachment
        ? isTemp
          ? await api.sendMediaToPhone(activeContact.phone || '', pendingAttachment.file, trimmedReply, pendingAttachment.viewOnce)
          : await api.sendMedia(activeContactId, pendingAttachment.file, trimmedReply, pendingAttachment.viewOnce)
        : isTemp
          ? await api.sendTextToPhone(activeContact.phone || '', trimmedReply, quotedMessage?.id)
          : await api.sendText(activeContactId, trimmedReply, quotedMessage?.id);

      if (res.error) throw new Error(res.error);
      toast.success(pendingAttachment ? 'Attachment sent' : 'Message sent');
      setQuotedMessage(null);

      replyDraftsRef.current[activeContactId] = '';
      setReplyText('');
      if (pendingAttachment) clearPendingAttachment();

      const refreshedConversations = await api.getConversations();
      setConversations(refreshedConversations);

      const nextContact = (res.contactId && refreshedConversations.find(c => c.id === res.contactId))
        || refreshedConversations.find(c => c.id === activeContactId)
        || null;

      if (selectedContactRef.current?.id === activeContactId && nextContact) {
        setSelectedContact(nextContact);
        await refreshMessages(nextContact.id, { forceScroll: true });
      }

      scrollMessagesToBottom('smooth');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  // Copy message text to clipboard
  const handleCopyMessage = useCallback((msg: Message) => {
    const text = msg.content || '';
    if (!text) { toast.error('Nothing to copy'); return; }
    navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => toast.error('Failed to copy'));
  }, []);

  // Forward message
  const handleForwardMessage = useCallback(async (msg: Message, targetContact: Contact) => {
    setForwardSending(true);
    try {
      const res = await api.forwardMessage(msg.id, targetContact.id);
      if (res.error) throw new Error(res.error);
      toast.success('Message forwarded');
      setForwardingMsg(null);
      setForwardSearch('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to forward');
    } finally {
      setForwardSending(false);
    }
  }, []);

  const forwardFilteredContacts = useMemo(() => {
    const all = [...conversations, ...allContacts];
    const seen = new Set<string>();
    const unique = all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    if (!forwardSearch.trim()) return unique.slice(0, 30);
    const q = forwardSearch.toLowerCase();
    return unique.filter(c =>
      getContactDisplayName(c).toLowerCase().includes(q) || cleanContactPhone(c.phone || '').includes(q)
    ).slice(0, 30);
  }, [conversations, allContacts, forwardSearch]);

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
    return allContacts.slice(0, 50);
  }, [allContacts]);

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

  // Delete a single message
  const handleDeleteMessage = useCallback(async (messageId: string, mode: 'me' | 'everyone') => {
    setDeleteMenuMsgId(null);
    setDeletingMessage(messageId);
    try {
      await api.deleteMessage(messageId, mode);
      if (mode === 'everyone') {
        // Show deleted placeholder instead of removing
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_deleted: 1, content: '🚫 You deleted this message', media_path: null, type: 'text' as const } : m));
      } else {
        setMessages(prev => prev.filter(m => m.id !== messageId));
      }
      toast.success(mode === 'everyone' ? 'Deleted for everyone' : 'Deleted for you');
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

  // Archive / Unarchive handler
  const handleArchiveChat = useCallback(async (contactId: string, archive: boolean) => {
    try {
      await api.archiveChat(contactId, archive);
      toast.success(archive ? 'Chat archived' : 'Chat unarchived');
      if (selectedContact?.id === contactId) setSelectedContact(null);
      refreshConversations();
    } catch (err: any) { toast.error(err.message || 'Failed'); }
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

  const handleEditMessage = useCallback(async (messageId: string) => {
    if (!editingText.trim()) return;
    setSavingEdit(true);
    try {
      const res = await api.editMessage(messageId, editingText.trim());
      if (res.success) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: editingText.trim(), is_edited: 1 } : m));
        toast.success('Message edited');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to edit message');
    } finally {
      setSavingEdit(false);
      setEditingMsgId(null);
      setEditingText('');
    }
  }, [editingText]);

  const handleStarMessage = useCallback(async (messageId: string, currentlyStarred: boolean) => {
    try {
      await api.starMessage(messageId, !currentlyStarred);
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_starred: currentlyStarred ? 0 : 1 } : m));
      toast.success(currentlyStarred ? 'Unstarred' : 'Starred');
    } catch (err: any) {
      toast.error(err.message || 'Failed');
    }
  }, []);

  const handleOpenProfile = useCallback(async () => {
    if (!selectedContact) return;
    setShowProfile(true);
    setProfileMediaLoading(true);
    try {
      const media = await api.getContactMedia(selectedContact.id);
      setProfileMedia(media);
    } catch {}
    setProfileMediaLoading(false);
  }, [selectedContact]);

  const handleSwipeStart = useCallback((e: React.TouchEvent, msg: Message) => {
    if (msg.type === 'call') return;
    swipeRef.current = { startX: e.touches[0].clientX, msgId: msg.id };
  }, []);

  const handleSwipeEnd = useCallback((e: React.TouchEvent, msg: Message) => {
    if (!swipeRef.current || swipeRef.current.msgId !== msg.id) return;
    const deltaX = e.changedTouches[0].clientX - swipeRef.current.startX;
    const threshold = 60;
    if ((msg.direction === 'received' && deltaX > threshold) || (msg.direction === 'sent' && deltaX < -threshold)) {
      setQuotedMessage(msg);
    }
    swipeRef.current = null;
  }, []);

  const renderMessageContent = (msg: Message) => {
    // Deleted message placeholder
    if (msg.is_deleted) {
      return (
        <div className="flex items-center gap-2 italic text-muted-foreground text-[13px]">
          <span>🚫</span>
          <span>{msg.direction === 'sent' ? 'You deleted this message' : 'This message was deleted'}</span>
        </div>
      );
    }

    const viewOnceBadge = msg.is_view_once ? (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded-full px-1.5 py-0.5 mb-1">
        <Eye className="w-3 h-3" /> View once
      </span>
    ) : null;

    const editedLabel = msg.is_edited ? (
      <span className="text-[10px] text-muted-foreground italic ml-1">edited</span>
    ) : null;

    // Inline editing
    if (editingMsgId === msg.id) {
      return (
        <div className="flex items-center gap-2 min-w-[200px]">
          <input
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleEditMessage(msg.id); if (e.key === 'Escape') { setEditingMsgId(null); setEditingText(''); } }}
            className="flex-1 px-2 py-1 rounded-md bg-background text-sm text-foreground focus:outline-none border border-border min-w-0"
            autoFocus
          />
          <button onClick={() => handleEditMessage(msg.id)} disabled={savingEdit} className="text-primary hover:text-primary/80">
            {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
          <button onClick={() => { setEditingMsgId(null); setEditingText(''); }} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      );
    }

    if (msg.type === 'call') {
      const isVideo = msg.content?.toLowerCase().includes('video');
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
          <PhoneMissed className="w-4 h-4 text-destructive" />
          <span className="text-destructive font-medium">Missed {isVideo ? 'video' : 'voice'} call</span>
        </div>
      );
    }

    if (msg.type === 'voice') {
      const voiceUrl = msg.media_path ? api.getVoiceMediaUrl(msg.media_path) : null;
      return (
        <div className="space-y-2 min-w-[220px]">
          {viewOnceBadge}
          {voiceUrl ? (
            <div className="rounded-2xl border border-border/50 bg-background/30 px-2 py-2">
              <audio controls preload="metadata" className="h-10 w-full min-w-[220px]" src={voiceUrl}>
                Your browser does not support voice note playback.
              </audio>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
              <Volume2 className="w-4 h-4" />
              <span>Voice note unavailable</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Voice note</span>
            {msg.duration ? <span>• 0:{String(msg.duration).padStart(2, '0')}</span> : null}
            {editedLabel}
          </div>
        </div>
      );
    }

    if (msg.type === 'sticker') {
      const stickerUrl = msg.media_path ? api.getMessageMediaUrl(msg.media_path) : null;
      return (
        <div className="space-y-1">
          {stickerUrl ? (
            <img
              src={stickerUrl}
              alt="Sticker"
              loading="lazy"
              className="max-w-[180px] max-h-[180px] object-contain"
            />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>🎭 Sticker</span>
            </div>
          )}
          {editedLabel}
        </div>
      );
    }

    if (msg.type === 'image') {
      const imageUrl = msg.media_path ? api.getMessageMediaUrl(msg.media_path) : null;
      return (
        <div className="space-y-2">
          {viewOnceBadge}
          {imageUrl ? (
            <a href={imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-muted/60">
              <img
                src={imageUrl}
                alt={msg.content || msg.media_name || 'Shared image'}
                loading="lazy"
                className="max-h-80 w-full object-cover"
              />
            </a>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
              <ImageIcon className="w-4 h-4" />
              <span>Image unavailable</span>
            </div>
          )}
          {msg.content ? <p className="whitespace-pre-wrap break-words">{msg.content}</p> : null}
          {editedLabel}
        </div>
      );
    }

    if (msg.type === 'video') {
      const videoUrl = msg.media_path ? api.getMessageMediaUrl(msg.media_path) : null;
      return (
        <div className="space-y-2">
          {viewOnceBadge}
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              preload="metadata"
              className="max-h-80 w-full rounded-xl bg-muted/60"
            />
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
              <Film className="w-4 h-4" />
              <span>Video unavailable</span>
            </div>
          )}
          {msg.content ? <p className="whitespace-pre-wrap break-words">{msg.content}</p> : null}
          {editedLabel}
        </div>
      );
    }

    if (msg.type === 'document') {
      const downloadUrl = msg.media_path ? api.getMessageMediaUrl(msg.media_path, { download: true }) : null;
      const documentLabel = msg.media_name || msg.content || 'Document';
      return (
        <div className="space-y-2">
          {viewOnceBadge}
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={msg.media_name || true}
              className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/30 px-3 py-3 hover:bg-background/50 transition-colors"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary flex-shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{documentLabel}</p>
                <p className="text-xs text-muted-foreground truncate">{msg.media_mime || 'Tap to download'}</p>
              </div>
              <Download className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </a>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
              <FileText className="w-4 h-4" />
              <span>Document unavailable</span>
            </div>
          )}
          {msg.content && msg.content !== documentLabel ? <p className="whitespace-pre-wrap break-words">{msg.content}</p> : null}
          {editedLabel}
        </div>
      );
    }

    return (
      <>
        {viewOnceBadge}
        <span className="whitespace-pre-wrap break-words">{msg.content}</span>
        {editedLabel}
      </>
    );
  };

  return (
    <div className="h-[calc(100dvh-5.5rem)] sm:h-[calc(100dvh-6rem)] md:h-[calc(100dvh-2.5rem)] flex flex-col">
      <div className="flex-1 flex min-h-0 rounded-xl overflow-hidden border border-border bg-card">
        {/* ===== LEFT: Conversation list ===== */}
        <div className={`${showChatOnMobile ? 'hidden md:flex' : 'flex'} w-full md:w-[300px] lg:w-[360px] xl:w-[380px] flex-shrink-0 flex-col border-r border-border bg-background`}>
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between">
            <h1 className="text-lg font-bold text-foreground">{showArchived ? 'Archived' : 'Chats'}</h1>
            <div className="flex items-center gap-1">
              {showArchived ? (
                <button
                  type="button"
                  onClick={() => setShowArchived(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
                  title="Back to chats"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              ) : (
                <>
                  {archivedConversations.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowArchived(true)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
                      title="Archived chats"
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setNewChatPhone(''); setContactSearch(''); setShowNewChat(true); }}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
                    title="New chat"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
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
                    onClick={() => { setSelectedContact(contact); if (showArchived) setShowArchived(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors ${
                      isActive ? 'bg-accent' : 'hover:bg-secondary/60'
                    }`}
                  >
                    <Avatar contact={contact} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-baseline">
                        <p className={`text-[15px] truncate ${(contact.unread_count ?? 0) > 0 ? 'text-foreground font-bold' : isActive ? 'text-foreground font-semibold' : 'text-foreground font-medium'}`}>
                          {getContactDisplayName(contact)}
                        </p>
                        <span className={`text-[11px] flex-shrink-0 ml-2 ${
                          (contact.unread_count ?? 0) > 0 ? 'text-primary font-medium' : isActive ? 'text-foreground/70' : 'text-muted-foreground'
                        }`}>
                          {contact.last_timestamp ? formatDate(contact.last_timestamp) : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className={`text-[13px] truncate flex-1 ${(contact.unread_count ?? 0) > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          {getConversationPreview(contact)}
                        </p>
                        {(contact.unread_count ?? 0) > 0 && (
                          <span className="flex-shrink-0 min-w-[20px] h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center px-1.5">
                            {contact.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
              {/* Archived count at bottom of list */}
              {!showArchived && archivedConversations.length > 0 && !search && (
                <button
                  onClick={() => setShowArchived(true)}
                  className="w-full flex items-center gap-3 px-3 py-3 text-left text-muted-foreground hover:bg-secondary/60 transition-colors"
                >
                  <div className="w-[46px] h-[46px] rounded-full flex items-center justify-center bg-muted flex-shrink-0">
                    <Archive className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[15px] font-medium">Archived</p>
                    <p className="text-[13px]">{archivedConversations.length} chat{archivedConversations.length !== 1 ? 's' : ''}</p>
                  </div>
                </button>
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
                <button onClick={handleOpenProfile} className="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar contact={selectedContact} size="lg" />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[15px] font-semibold text-foreground truncate">{getContactDisplayName(selectedContact)}</p>
                    <p className="text-xs text-muted-foreground truncate">tap for info</p>
                  </div>
                </button>
                <button
                  onClick={() => { setChatSearchOpen(o => !o); setChatSearch(''); setTimeout(() => chatSearchInputRef.current?.focus(), 100); }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
                  title="Search in chat"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDeleteConversation}
                  disabled={deletingConversation}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                  title="Delete conversation"
                >
                  {deletingConversation ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleArchiveChat(selectedContact.id, !selectedContact.is_archived)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
                  title={selectedContact.is_archived ? 'Unarchive' : 'Archive'}
                >
                  {selectedContact.is_archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
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
                            data-msg-id={msg.id}
                            className={`flex ${msg.type === 'call' ? 'justify-center' : msg.direction === 'sent' ? 'justify-end' : 'justify-start'}`}
                            onTouchStart={(e) => handleSwipeStart(e, msg)}
                            onTouchEnd={(e) => handleSwipeEnd(e, msg)}
                          >
                            <div
                              className={`group max-w-[88%] sm:max-w-[80%] md:max-w-[65%] ${
                                msg.type === 'call'
                                  ? 'bg-muted/50 px-4 py-2 rounded-xl text-[13px]'
                                  : msg.type === 'sticker'
                                  ? 'bg-transparent'
                                  : `px-3 py-2 rounded-2xl text-[14px] ${
                                      msg.direction === 'sent'
                                        ? 'bg-bubble-out text-bubble-out-foreground rounded-br-md'
                                        : 'bg-bubble-in text-bubble-in-foreground rounded-bl-md'
                                    }`
                              } ${isActive ? 'ring-2 ring-primary' : isMatch ? 'ring-1 ring-primary/40' : ''}`}
                            >
                              {/* Quoted message preview - tap to scroll to original */}
                              {msg.reply_to_content && (
                                <button
                                  type="button"
                                  className="inline-btn w-full text-left mb-1.5 rounded-lg border-l-2 border-primary bg-background/20 px-2.5 py-1.5 text-[12px] hover:bg-background/30 transition-colors cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const targetId = msg.reply_to_id;
                                    if (!targetId) return;
                                    // Find the outer wrapper by data-msg-id
                                    const wrapper = messagesViewportRef.current?.querySelector(`[data-msg-id="${CSS.escape(targetId)}"]`) as HTMLElement | null;
                                    if (wrapper) {
                                      wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                      // Highlight the bubble (first child div)
                                      const bubble = wrapper.querySelector(':scope > div') as HTMLElement | null;
                                      const target = bubble || wrapper;
                                      target.style.transition = 'box-shadow 0.3s ease';
                                      target.style.boxShadow = '0 0 0 2px hsl(211 100% 50%)';
                                      target.style.borderRadius = '1rem';
                                      setTimeout(() => {
                                        target.style.boxShadow = '';
                                        setTimeout(() => { target.style.transition = ''; target.style.borderRadius = ''; }, 300);
                                      }, 2000);
                                    }
                                  }}
                                >
                                  <p className="font-medium text-primary text-[11px]">{msg.reply_to_sender || 'Unknown'}</p>
                                  <p className="text-muted-foreground line-clamp-2">{msg.reply_to_content}</p>
                                </button>
                              )}
                              {renderMessageContent(msg)}
                              <div className={`flex items-center gap-1 mt-0.5 ${msg.direction === 'sent' ? 'justify-end' : ''}`}>
                                <span className={`text-[10px] inline-btn ${msg.direction === 'sent' ? 'text-bubble-out-foreground/70' : 'text-muted-foreground'}`}>{formatTime(msg.timestamp)}</span>
                                {msg.is_starred ? <Star className="w-2.5 h-2.5 text-yellow-500 fill-yellow-500 inline-btn" /> : null}
                                {msg.direction === 'sent' && <StatusLabel status={msg.status} />}
                                {/* Action buttons - visible on hover (desktop) or always tiny on mobile */}
                                {msg.type !== 'call' && !msg.is_deleted && (
                                  <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setQuotedMessage(msg); }}
                                      className="inline-btn p-0.5 hover:text-primary text-muted-foreground/50 md:text-muted-foreground"
                                      title="Reply"
                                    >
                                      <Reply className="w-3 h-3" />
                                    </button>
                                    {msg.content && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleCopyMessage(msg); }}
                                        className="inline-btn p-0.5 hover:text-primary text-muted-foreground/50 md:text-muted-foreground"
                                        title="Copy"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setForwardingMsg(msg); if (allContacts.length === 0) refreshAllContacts(); }}
                                      className="inline-btn p-0.5 hover:text-primary text-muted-foreground/50 md:text-muted-foreground"
                                      title="Forward"
                                    >
                                      <Forward className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleStarMessage(msg.id, !!msg.is_starred); }}
                                      className="inline-btn p-0.5 hover:text-yellow-500 text-muted-foreground/50 md:text-muted-foreground"
                                      title={msg.is_starred ? 'Unstar' : 'Star'}
                                    >
                                      <Star className={`w-3 h-3 ${msg.is_starred ? 'fill-yellow-500 text-yellow-500' : ''}`} />
                                    </button>
                                    {msg.direction === 'sent' && msg.type === 'text' && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingMsgId(msg.id); setEditingText(msg.content || ''); }}
                                        className="inline-btn p-0.5 hover:text-primary text-muted-foreground/50 md:text-muted-foreground"
                                        title="Edit message"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                    )}
                                    <div className="relative">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setDeleteMenuMsgId(prev => prev === msg.id ? null : msg.id); }}
                                        disabled={deletingMessage === msg.id}
                                        className="inline-btn p-0.5 hover:text-destructive text-muted-foreground/50 md:text-muted-foreground"
                                        title="Delete message"
                                      >
                                        {deletingMessage === msg.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                      </button>
                                      {deleteMenuMsgId === msg.id && (
                                        <div className={`absolute z-20 bottom-full mb-1 ${msg.direction === 'sent' ? 'right-0' : 'left-0'} bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[160px]`}>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id, 'me'); }}
                                            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                                          >
                                            Delete for me
                                          </button>
                                          {msg.direction === 'sent' && (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id, 'everyone'); }}
                                              className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                                            >
                                              Delete for everyone
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
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
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleSelectAttachment}
                />

                {/* Quoted message bar */}
                {quotedMessage && (
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/60 p-2">
                    <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
                      <p className="text-[11px] font-medium text-primary">{quotedMessage.direction === 'sent' ? 'You' : (selectedContact ? getContactDisplayName(selectedContact) : 'Them')}</p>
                      <p className="text-xs text-muted-foreground truncate">{quotedMessage.content || (quotedMessage.type === 'image' ? '📷 Photo' : quotedMessage.type === 'video' ? '🎥 Video' : quotedMessage.type === 'voice' ? '🎤 Voice' : quotedMessage.type)}</p>
                    </div>
                    <button onClick={() => setQuotedMessage(null)} className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {pendingAttachment && (
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/60 p-2.5">
                    {pendingAttachment.kind === 'image' && pendingAttachment.previewUrl ? (
                      <img src={pendingAttachment.previewUrl} alt={pendingAttachment.file.name} className="h-12 w-12 rounded-xl object-cover" />
                    ) : pendingAttachment.kind === 'video' && pendingAttachment.previewUrl ? (
                      <video src={pendingAttachment.previewUrl} className="h-12 w-12 rounded-xl object-cover" muted playsInline />
                    ) : pendingAttachment.kind === 'audio' && pendingAttachment.previewUrl ? (
                      <div className="flex items-center gap-2">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Volume2 className="w-5 h-5" />
                        </div>
                        <audio src={pendingAttachment.previewUrl} controls className="h-8 max-w-[180px]" />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-background text-muted-foreground">
                        <FileText className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{pendingAttachment.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(pendingAttachment.file.size)} • {pendingAttachment.kind === 'audio' ? '🔊 Audio (deletes after send)' : pendingAttachment.kind === 'document' ? 'File' : pendingAttachment.kind}
                      </p>
                    </div>
                    {/* View-once toggle for images/videos */}
                    {(pendingAttachment.kind === 'image' || pendingAttachment.kind === 'video') && (
                      <button
                        type="button"
                        onClick={() => setPendingAttachment(prev => prev ? { ...prev, viewOnce: !prev.viewOnce } : null)}
                        className={`flex h-8 items-center gap-1 rounded-full px-2 text-xs font-medium transition-colors ${
                          pendingAttachment.viewOnce
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        title={pendingAttachment.viewOnce ? 'View once ON' : 'View once OFF'}
                      >
                        {pendingAttachment.viewOnce ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">{pendingAttachment.viewOnce ? '1' : '∞'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearPendingAttachment}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-background"
                      title="Remove attachment"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Composer */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground hover:bg-secondary/80 transition-colors flex-shrink-0"
                    title="Attach photo or file"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <input
                    value={replyText}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setReplyText(nextValue);
                      if (selectedContact?.id) replyDraftsRef.current[selectedContact.id] = nextValue;
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
                    placeholder={pendingAttachment ? 'Add a caption (optional)' : 'Type a message'}
                    className="flex-1 px-4 py-2.5 rounded-full bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-w-0"
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={(!replyText.trim() && !pendingAttachment) || sending}
                    className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40 flex-shrink-0"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {/* Profile Panel */}
          {showProfile && selectedContact && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setShowProfile(false)}>
              <div className="w-full max-w-md max-h-[85vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                  <button onClick={() => setShowProfile(false)} className="p-1 text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                  <h3 className="text-sm font-semibold text-foreground">Contact Info</h3>
                </div>
                <div className="flex flex-col items-center py-6 gap-2 border-b border-border">
                  <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center border-2 border-border">
                    {selectedContact.avatar_url
                      ? <img src={selectedContact.avatar_url} alt="" className="w-20 h-20 rounded-full object-cover" />
                      : <User className="w-8 h-8 text-muted-foreground" />
                    }
                  </div>
                  <p className="text-lg font-semibold text-foreground">{getContactDisplayName(selectedContact)}</p>
                  <p className="text-sm text-muted-foreground">{getContactDisplayMeta(selectedContact)}</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="px-4 py-3 border-b border-border">
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">
                      Media ({profileMedia.filter(m => m.type === 'image' || m.type === 'video').length})
                    </h4>
                    {profileMediaLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : (
                      <div className="grid grid-cols-3 gap-1 max-h-[200px] overflow-y-auto rounded-lg">
                        {profileMedia.filter(m => m.type === 'image' || m.type === 'video').map((m) => (
                          <div key={m.id} className="aspect-square rounded-md overflow-hidden bg-muted">
                            {m.type === 'image' && m.media_path && (
                              <img src={api.getMessageMediaUrl(m.media_path)} alt="" className="w-full h-full object-cover" />
                            )}
                            {m.type === 'video' && m.media_path && (
                              <video src={api.getMessageMediaUrl(m.media_path)} className="w-full h-full object-cover" muted playsInline />
                            )}
                          </div>
                        ))}
                        {profileMedia.filter(m => m.type === 'image' || m.type === 'video').length === 0 && (
                          <p className="col-span-3 text-xs text-muted-foreground text-center py-4">No media shared yet</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">
                      Documents ({profileMedia.filter(m => m.type === 'document').length})
                    </h4>
                    <div className="space-y-1 max-h-[120px] overflow-y-auto">
                      {profileMedia.filter(m => m.type === 'document').map((m) => (
                        <div key={m.id} className="flex items-center gap-2 rounded-lg bg-secondary/50 p-2 text-sm">
                          <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate text-foreground text-xs">{m.media_name || 'Document'}</span>
                        </div>
                      ))}
                      {profileMedia.filter(m => m.type === 'document').length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">No documents shared yet</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!selectedContact && (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 bg-chat-bg">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">Messages</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Send texts and handle voice notes, photos, videos, and documents from one chat view. Select a chat to get started.
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

        {/* ===== Forward message overlay ===== */}
        {forwardingMsg && (
          <div className="fixed inset-0 z-[75] flex items-end bg-background/80 backdrop-blur-sm md:items-center md:justify-center" onClick={() => { setForwardingMsg(null); setForwardSearch(''); }}>
            <div className="w-full overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl md:w-[24rem] md:max-h-[70vh] md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Forward to...</h3>
                <button onClick={() => { setForwardingMsg(null); setForwardSearch(''); }} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={forwardSearch}
                    onChange={(e) => setForwardSearch(e.target.value)}
                    placeholder="Search contacts..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
              <div className="overflow-y-auto max-h-[50vh]">
                {forwardFilteredContacts.map(contact => (
                  <button
                    key={contact.id}
                    onClick={() => handleForwardMessage(forwardingMsg, contact)}
                    disabled={forwardSending}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/50 transition-colors disabled:opacity-50"
                  >
                    <Avatar contact={contact} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{getContactDisplayName(contact)}</p>
                      <p className="text-xs text-muted-foreground">{getContactDisplayMeta(contact)}</p>
                    </div>
                    {forwardSending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />}
                  </button>
                ))}
                {forwardFilteredContacts.length === 0 && (
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
