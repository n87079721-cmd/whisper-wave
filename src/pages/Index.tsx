import { useState } from 'react';
import DashboardSidebar from '@/components/DashboardSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import DashboardPage from '@/pages/DashboardPage';
import ContactsPage from '@/pages/ContactsPage';
import ConversationsPage from '@/pages/ConversationsPage';
import VoiceStudioPage from '@/pages/VoiceStudioPage';
import SettingsPage from '@/pages/SettingsPage';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings';

const pageComponents: Record<Page, React.FC> = {
  dashboard: DashboardPage,
  contacts: ContactsPage,
  conversations: ConversationsPage,
  voice: VoiceStudioPage,
  settings: SettingsPage,
};

const Index = () => {
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const ActiveComponent = pageComponents[activePage];

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden md:block">
        <DashboardSidebar activePage={activePage} onPageChange={setActivePage} />
      </div>
      <main className="flex-1 p-3 md:p-5 overflow-auto pb-20 md:pb-5">
        <ActiveComponent />
      </main>
      <MobileBottomNav activePage={activePage} onPageChange={setActivePage} />
    </div>
  );
};

export default Index;
