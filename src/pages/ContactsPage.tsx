import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, Plus, X, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { api, type Contact } from '@/lib/api';
import { cleanContactPhone, getContactDisplayMeta, getContactDisplayName, getContactInitials, getContactPhoneLabel } from '@/lib/contactDisplay';
import { toast } from 'sonner';

interface ContactsPageProps {
  onOpenChat?: (contact: Contact) => void;
  onNavigateSettings?: () => void;
}

interface MergedContact {
  primary: Contact;
  alternates: Contact[];
  totalMessages: number;
}

function deduplicateContacts(contacts: Contact[]): MergedContact[] {
  const byName = new Map<string, Contact[]>();

  for (const c of contacts) {
    const name = getContactDisplayName(c).toLowerCase().trim();
    // Only group if the contact has a real recognizable name (not phone-only or unknown)
    const isRealName = name && !name.startsWith('+') && !name.startsWith('contact •') && name !== 'unknown contact' && !/^\d+$/.test(name.replace(/\s/g, ''));
    const key = isRealName ? name : `__unique_${c.id}`;
    const arr = byName.get(key) || [];
    arr.push(c);
    byName.set(key, arr);
  }

  const result: MergedContact[] = [];
  for (const group of byName.values()) {
    // Sort by message_count desc — primary is the most active
    group.sort((a, b) => (b.message_count || 0) - (a.message_count || 0));
    const [primary, ...alternates] = group;
    const totalMessages = group.reduce((sum, c) => sum + (c.message_count || 0), 0);
    result.push({ primary, alternates, totalMessages });
  }

  return result;
}

const ContactsPage = ({ onOpenChat }: ContactsPageProps) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchContacts = useCallback((searchQuery = '') => {
    setLoading(true);
    api.getContacts({ search: searchQuery, limit: 5000 })
      .then(res => {
        setContacts(res.contacts);
        setTotalCount(res.total);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchContacts();
    let es: EventSource | null = null;
    const interval = window.setInterval(() => fetchContacts(search), 30000);
    try {
      es = api.createEventSource();
      es.addEventListener('history_sync', () => fetchContacts(search));
      es.addEventListener('contacts_sync', () => fetchContacts(search));
      es.onerror = () => {};
    } catch {}
    return () => { es?.close(); window.clearInterval(interval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchContacts(value), 300);
  };

  const handleSaveContact = async () => {
    if (!newPhone.trim()) { toast.error('Phone number is required'); return; }
    setSaving(true);
    try {
      await api.saveContact(newName.trim(), newPhone.trim());
      toast.success(newName.trim() ? `${newName.trim()} saved` : 'Contact saved');
      setNewName('');
      setNewPhone('');
      setShowAdd(false);
      fetchContacts(search);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const merged = useMemo(() => deduplicateContacts(contacts), [contacts]);

  // Group merged contacts alphabetically
  const grouped = merged.reduce<Record<string, MergedContact[]>>((acc, mc) => {
    const letter = getContactDisplayName(mc.primary)[0]?.toUpperCase() || '#';
    const key = /[A-Z]/.test(letter) ? letter : '#';
    (acc[key] = acc[key] || []).push(mc);
    return acc;
  }, {});
  const sortedKeys = Object.keys(grouped).sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading...' : `${totalCount} contacts synced${merged.length < totalCount ? ` · ${merged.length} unique` : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-secondary/60 rounded-lg p-4 space-y-3 border border-border">
          <p className="text-sm font-medium text-foreground">Save New Contact</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (optional)"
            className="w-full px-3 py-2.5 rounded-lg bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none border border-border"
          />
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Phone number (e.g. 2348012345678)"
            className="w-full px-3 py-2.5 rounded-lg bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none border border-border"
          />
          <button
            onClick={handleSaveContact}
            disabled={saving || !newPhone.trim()}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Contact'}
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search contacts..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {merged.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {search ? 'No contacts match your search.' : 'No contacts yet. Connect WhatsApp to sync.'}
        </p>
      ) : (
        <div>
          {sortedKeys.map(letter => (
            <div key={letter}>
              <div className="px-3 py-1.5 sticky top-0 bg-background z-10">
                <span className="text-xs font-semibold text-primary">{letter}</span>
              </div>
              {grouped[letter].map((mc) => {
                const { primary, alternates, totalMessages } = mc;
                const hasDupes = alternates.length > 0;
                const isExpanded = expandedContact === primary.id;

                return (
                  <div key={primary.id}>
                    <div className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/60 transition-colors">
                      {primary.avatar_url ? (
                        <img src={primary.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center border border-border bg-muted text-sm font-medium text-foreground flex-shrink-0">
                          {getContactInitials(primary)}
                        </div>
                      )}
                      <button
                        onClick={() => onOpenChat?.(primary)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <p className="text-[15px] font-medium text-foreground truncate">{getContactDisplayName(primary)}</p>
                          {hasDupes && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground font-medium flex-shrink-0">
                              {alternates.length + 1}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{getContactPhoneLabel(primary) || getContactDisplayMeta(primary)}</p>
                      </button>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground opacity-60">{totalMessages}</span>
                        <button
                          onClick={() => onOpenChat?.(primary)}
                          className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors"
                          title="Message"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        {hasDupes && (
                          <button
                            onClick={() => setExpandedContact(isExpanded ? null : primary.id)}
                            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                            title={isExpanded ? 'Collapse' : 'Show alternate numbers'}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded alternates */}
                    {hasDupes && isExpanded && (
                      <div className="ml-12 border-l-2 border-border">
                        {alternates.map(alt => (
                          <div
                            key={alt.id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-secondary/40 transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-muted-foreground">{getContactPhoneLabel(alt) || alt.jid}</p>
                              <p className="text-[10px] text-muted-foreground/60">{alt.message_count || 0} messages</p>
                            </div>
                            <button
                              onClick={() => onOpenChat?.(alt)}
                              className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors"
                              title="Message this number"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContactsPage;
