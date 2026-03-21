import { useState } from 'react';
import DashboardSidebar from '@/components/DashboardSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import DashboardPage from '@/pages/DashboardPage';
import ContactsPage from '@/pages/ContactsPage';
import ConversationsPage from '@/pages/ConversationsPage';
import VoiceStudioPage from '@/pages/VoiceStudioPage';
import SettingsPage from '@/pages/SettingsPage';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings';

const Index = () => {
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  const handleOpenChat = (contactId: string) => {
    setSelectedContactId(contactId);
    setActivePage('conversations');
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <DashboardPage />;
      case 'contacts': return <ContactsPage onOpenChat={handleOpenChat} />;
      case 'conversations': return <ConversationsPage initialContactId={selectedContactId} onContactOpened={() => setSelectedContactId(null)} />;
      case 'voice': return <VoiceStudioPage />;
      case 'settings': return <SettingsPage />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden md:block">
        <DashboardSidebar activePage={activePage} onPageChange={setActivePage} />
      </div>
      <main className="flex-1 p-3 md:p-5 overflow-auto pb-20 md:pb-5">
        {renderPage()}
      </main>
      <MobileBottomNav activePage={activePage} onPageChange={setActivePage} />
    </div>
  );
};

export default Index;
