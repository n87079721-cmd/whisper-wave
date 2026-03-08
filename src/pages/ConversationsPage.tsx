import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Mic, Check, CheckCheck } from 'lucide-react';
import { mockContacts, mockMessages, type Contact } from '@/lib/mockData';

const ConversationsPage = () => {
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [search, setSearch] = useState('');

  const contactsWithMessages = mockContacts.filter(c =>
    mockMessages.some(m => m.contactId === c.id)
  );

  const filtered = contactsWithMessages.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const messages = selectedContact
    ? mockMessages.filter(m => m.contactId === selectedContact.id)
    : [];

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'read') return <CheckCheck className="w-3.5 h-3.5 text-primary" />;
    if (status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />;
    return <Check className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Conversations</h1>

      <div className="flex gap-4 h-[calc(100vh-180px)]">
        {/* Contact list */}
        <div className="w-72 flex-shrink-0 glass rounded-xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary border-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.map(contact => {
              const lastMsg = mockMessages.filter(m => m.contactId === contact.id).pop();
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
                    {contact.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-baseline">
                      <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-2">{lastMsg?.timestamp}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {lastMsg?.type === 'voice' ? '🎤 Voice note' : lastMsg?.content}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat view */}
        <div className="flex-1 glass rounded-xl overflow-hidden flex flex-col">
          {selectedContact ? (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
                  {selectedContact.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{selectedContact.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedContact.lastSeen}</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((msg, i) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={`flex ${msg.direction === 'sent' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[65%] px-3 py-2 rounded-xl text-sm ${
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
                          <span className="text-xs text-muted-foreground ml-1">0:{String(msg.duration).padStart(2, '0')}</span>
                        </div>
                      ) : (
                        msg.content
                      )}
                      <div className={`flex items-center gap-1 mt-1 ${msg.direction === 'sent' ? 'justify-end' : ''}`}>
                        <span className="text-[10px] text-muted-foreground">{msg.timestamp}</span>
                        {msg.direction === 'sent' && <StatusIcon status={msg.status} />}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation to view messages
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConversationsPage;
