export interface Contact {
  id: string;
  name: string;
  phone: string;
  avatar?: string;
  lastSeen: string;
  isOnline: boolean;
}

export interface Message {
  id: string;
  contactId: string;
  content: string;
  type: 'text' | 'voice';
  direction: 'sent' | 'received';
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  duration?: number; // seconds for voice
}

export const mockContacts: Contact[] = [
  { id: '1', name: 'Alex Rivera', phone: '+1 555-0101', lastSeen: '2 min ago', isOnline: true },
  { id: '2', name: 'Sarah Chen', phone: '+1 555-0102', lastSeen: '15 min ago', isOnline: true },
  { id: '3', name: 'Marcus Johnson', phone: '+1 555-0103', lastSeen: '1 hour ago', isOnline: false },
  { id: '4', name: 'Elena Kowalski', phone: '+1 555-0104', lastSeen: '3 hours ago', isOnline: false },
  { id: '5', name: 'David Park', phone: '+1 555-0105', lastSeen: 'Yesterday', isOnline: false },
  { id: '6', name: 'Priya Sharma', phone: '+1 555-0106', lastSeen: '2 days ago', isOnline: false },
];

export const mockMessages: Message[] = [
  { id: '1', contactId: '1', content: 'Hey, how are you?', type: 'text', direction: 'received', timestamp: '10:30 AM', status: 'read' },
  { id: '2', contactId: '1', content: 'Doing great! Want to catch up later?', type: 'text', direction: 'sent', timestamp: '10:32 AM', status: 'read' },
  { id: '3', contactId: '1', content: 'Sure, let me know when you are free.', type: 'text', direction: 'received', timestamp: '10:35 AM', status: 'read' },
  { id: '4', contactId: '1', content: '', type: 'voice', direction: 'sent', timestamp: '10:40 AM', status: 'delivered', duration: 12 },
  { id: '5', contactId: '2', content: 'The project files are ready for review.', type: 'text', direction: 'received', timestamp: '9:15 AM', status: 'read' },
  { id: '6', contactId: '2', content: 'Thanks, I will take a look.', type: 'text', direction: 'sent', timestamp: '9:20 AM', status: 'delivered' },
];
