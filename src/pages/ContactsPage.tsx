import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, Phone, MessageSquare } from 'lucide-react';
import { api, type Contact } from '@/lib/api';

interface ContactsPageProps {
  onOpenChat?: (contact: Contact) => void;
}

const ContactsPage = ({ onOpenChat }: ContactsPageProps) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchContacts = () => {
    api.getContacts().then(data => {
      setContacts(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchContacts();

    let es: EventSource | null = null;
    const interval = window.setInterval(fetchContacts, 5000);

    try {
      es = api.createEventSource();
      es.addEventListener('history_sync', () => fetchContacts());
      es.addEventListener('message', () => fetchContacts());
      es.addEventListener('contacts_sync', () => fetchContacts());
      es.onerror = () => {};
    } catch {}

    return () => {
      es?.close();
      window.clearInterval(interval);
    };
  }, []);

  const cleanPhone = (p: string) => p?.replace(/@.*$/, '') || '';

  const filtered = contacts.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    cleanPhone(c.phone || '').includes(search)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {loading ? 'Loading...' : `${contacts.length} contacts synced`}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {filtered.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {contacts.length === 0 ? 'No contacts yet. Connect WhatsApp to sync contacts.' : 'No contacts match your search.'}
        </p>
      ) : (
        <div className="space-y-1">
          {filtered.map((contact, i) => (
            <motion.div
              key={contact.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => onOpenChat?.(contact.id)}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary/80 transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                  {(contact.name || contact.phone || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{contact.name || cleanPhone(contact.phone)}</p>
                  <p className="text-xs text-muted-foreground">{cleanPhone(contact.phone)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-muted-foreground">{contact.message_count || 0} msgs</span>
                <MessageSquare className="w-4 h-4 text-primary" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContactsPage;
