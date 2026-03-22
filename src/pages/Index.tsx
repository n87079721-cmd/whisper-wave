import { useState } from 'react';
import DashboardSidebar from '@/components/DashboardSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import DashboardPage from '@/pages/DashboardPage';
import ContactsPage from '@/pages/ContactsPage';
import ConversationsPage from '@/pages/ConversationsPage';
import VoiceStudioPage from '@/pages/VoiceStudioPage';
import SettingsPage from '@/pages/SettingsPage';
import StatusPage from '@/pages/StatusPage';
import { type Contact } from '@/lib/api';
import { useTheme } from '@/hooks/useTheme';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings' | 'status';

const Index = () => {
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const { theme, toggleTheme } = useTheme();

  const handleOpenChat = (contact: Contact) => {
    setSelectedContact(contact);
    setActivePage('conversations');
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <DashboardPage onNavigateSettings={() => setActivePage('settings')} onNavigateConversations={() => setActivePage('conversations')} />;
      case 'contacts': return <ContactsPage onOpenChat={handleOpenChat} onNavigateSettings={() => setActivePage('settings')} />;
      case 'conversations': return <ConversationsPage initialContact={selectedContact} onContactOpened={() => setSelectedContact(null)} onNavigateSettings={() => setActivePage('settings')} />;
      case 'voice': return <VoiceStudioPage />;
      case 'settings': return <SettingsPage />;
      case 'status': return <StatusPage />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden md:block">
        <DashboardSidebar activePage={activePage} onPageChange={setActivePage} theme={theme} onToggleTheme={toggleTheme} />
      </div>
      <main className="flex-1 overflow-y-auto px-3 pb-24 pt-3 md:px-6 md:pb-6 md:pt-5">
        <div className="mx-auto w-full max-w-7xl">
          {renderPage()}
        </div>
      </main>
      <MobileBottomNav activePage={activePage} onPageChange={setActivePage} theme={theme} onToggleTheme={toggleTheme} />
    </div>
  );
};

export default Index;
