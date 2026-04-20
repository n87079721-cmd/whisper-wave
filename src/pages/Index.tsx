import { useState, useEffect } from 'react';
import DashboardSidebar from '@/components/DashboardSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import DashboardPage from '@/pages/DashboardPage';
import ContactsPage from '@/pages/ContactsPage';
import ConversationsPage from '@/pages/ConversationsPage';
import VoiceStudioPage from '@/pages/VoiceStudioPage';
import SettingsPage from '@/pages/SettingsPage';
import StatusPage from '@/pages/StatusPage';
import CallsPage from '@/pages/CallsPage';
import AdminPage from '@/pages/AdminPage';
import { type Contact } from '@/lib/api';
import { useTheme } from '@/hooks/useTheme';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings' | 'status' | 'calls' | 'admin';

const VALID_PAGES: Page[] = ['dashboard', 'contacts', 'conversations', 'voice', 'settings', 'status', 'calls', 'admin'];

function getInitialPage(): Page {
  const hash = window.location.hash.replace('#', '');
  if (VALID_PAGES.includes(hash as Page)) return hash as Page;
  return 'dashboard';
}

const Index = () => {
  const [activePage, setActivePage] = useState<Page>(getInitialPage);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    window.location.hash = activePage;
  }, [activePage]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (VALID_PAGES.includes(hash as Page)) {
        setActivePage(hash as Page);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
      case 'calls': return <CallsPage />;
      case 'admin': return <AdminPage />;
    }
  };

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden safe-top">
      <div className="hidden md:block flex-shrink-0">
        <DashboardSidebar activePage={activePage} onPageChange={setActivePage} theme={theme} onToggleTheme={toggleTheme} />
      </div>
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Mobile bottom padding clears the fixed bottom nav (~64px) + iOS safe-area inset + breathing room
            so action buttons (Voice Studio Send, etc.) are never hidden behind the nav. */}
        <div className="flex-1 overflow-y-auto px-2 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-2 sm:px-3 sm:pt-3 md:px-6 md:pb-6 md:pt-5">
          <div className="mx-auto w-full max-w-7xl h-full">
            {renderPage()}
          </div>
        </div>
      </main>
      <MobileBottomNav activePage={activePage} onPageChange={setActivePage} theme={theme} onToggleTheme={toggleTheme} />
    </div>
  );
};

export default Index;
