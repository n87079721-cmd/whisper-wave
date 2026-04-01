import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, MessageSquare, Plus, X, Send } from 'lucide-react';
import { api, type Contact } from '@/lib/api';
import { cleanContactPhone, getContactDisplayMeta, getContactDisplayName, getContactInitials } from '@/lib/contactDisplay';
import { toast } from 'sonner';

interface ContactsPageProps {
  onOpenChat?: (contact: Contact) => void;
  onNavigateSettings?: () => void;
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

  // Group contacts alphabetically
  const grouped = contacts.reduce<Record<string, Contact[]>>((acc, c) => {
    const letter = getContactDisplayName(c)[0]?.toUpperCase() || '#';
    const key = /[A-Z]/.test(letter) ? letter : '#';
    (acc[key] = acc[key] || []).push(c);
    return acc;
  }, {});
  const sortedKeys = Object.keys(grouped).sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading...' : `${totalCount} contacts synced${contacts.length < totalCount ? ` · showing ${contacts.length}` : ''}`}
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

      {contacts.length === 0 && !loading ? (
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
              {grouped[letter].map((contact) => (
                <div
                  key={contact.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/60 transition-colors"
                >
                  {contact.avatar_url ? (
                    <img src={contact.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center border border-border bg-muted text-sm font-medium text-foreground flex-shrink-0">
                      {getContactInitials(contact)}
                    </div>
                  )}
                  <button
                    onClick={() => onOpenChat?.(contact)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-[15px] font-medium text-foreground truncate">{getContactDisplayName(contact)}</p>
                    <p className="text-xs text-muted-foreground">{getContactDisplayMeta(contact)}</p>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground opacity-60">{contact.message_count || 0}</span>
                    <button
                      onClick={() => onOpenChat?.(contact)}
                      className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors"
                      title="Message"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContactsPage;
