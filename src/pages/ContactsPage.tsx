import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, MessageSquare } from 'lucide-react';
import { api, type Contact } from '@/lib/api';
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus';
import SyncBanner from '@/components/SyncBanner';

interface ContactsPageProps {
  onOpenChat?: (contact: Contact) => void;
  onNavigateSettings?: () => void;
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
              onClick={() => onOpenChat?.(contact)}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary/80 transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                  {getInitials(contact)}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{getDisplayName(contact)}</p>
                  <p className="text-xs text-muted-foreground">{getDisplayMeta(contact)}</p>
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
