import { useState, useEffect } from 'react';
import { Search, MessageSquare } from 'lucide-react';
import { api, type Contact } from '@/lib/api';
import { cleanContactPhone, getContactDisplayMeta, getContactDisplayName, getContactInitials } from '@/lib/contactDisplay';

interface ContactsPageProps {
  onOpenChat?: (contact: Contact) => void;
  onNavigateSettings?: () => void;
}

const ContactsPage = ({ onOpenChat }: ContactsPageProps) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchContacts = () => {
    api.getContacts().then(data => { setContacts(data); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchContacts();
    let es: EventSource | null = null;
    const interval = window.setInterval(fetchContacts, 30000);
    try {
      es = api.createEventSource();
      es.addEventListener('history_sync', fetchContacts);
      es.addEventListener('contacts_sync', fetchContacts);
      es.onerror = () => {};
    } catch {}
    return () => { es?.close(); window.clearInterval(interval); };
  }, []);

  const filtered = contacts.filter(c =>
    getContactDisplayName(c).toLowerCase().includes(search.toLowerCase()) ||
    cleanContactPhone(c.phone || '').includes(search)
  );

  // Group contacts alphabetically
  const grouped = filtered.reduce<Record<string, Contact[]>>((acc, c) => {
    const letter = getContactDisplayName(c)[0]?.toUpperCase() || '#';
    const key = /[A-Z]/.test(letter) ? letter : '#';
    (acc[key] = acc[key] || []).push(c);
    return acc;
  }, {});
  const sortedKeys = Object.keys(grouped).sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading...' : `${contacts.length} contacts synced`}
        </p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {filtered.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {contacts.length === 0 ? 'No contacts yet. Connect WhatsApp to sync.' : 'No contacts match your search.'}
        </p>
      ) : (
        <div>
          {sortedKeys.map(letter => (
            <div key={letter}>
              <div className="px-3 py-1.5 sticky top-0 bg-background z-10">
                <span className="text-xs font-semibold text-primary">{letter}</span>
              </div>
              {grouped[letter].map((contact) => {
                return (
                  <button
                    key={contact.id}
                    onClick={() => onOpenChat?.(contact)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/60 transition-colors"
                  >
                    {contact.avatar_url ? (
                      <img src={contact.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center border border-border bg-muted text-sm font-medium text-foreground flex-shrink-0"
                      >
                        {getContactInitials(contact)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium text-foreground truncate">{getContactDisplayName(contact)}</p>
                      <p className="text-xs text-muted-foreground">{getContactDisplayMeta(contact)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 opacity-60">
                      <span className="text-xs text-muted-foreground">{contact.message_count || 0}</span>
                      <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </button>
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
