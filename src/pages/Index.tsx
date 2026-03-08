import { useState } from 'react';
import DashboardSidebar from '@/components/DashboardSidebar';
import DashboardPage from '@/pages/DashboardPage';
import ContactsPage from '@/pages/ContactsPage';
import ConversationsPage from '@/pages/ConversationsPage';
import SendMessagePage from '@/pages/SendMessagePage';
import VoiceStudioPage from '@/pages/VoiceStudioPage';
import SettingsPage from '@/pages/SettingsPage';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'send' | 'voice' | 'settings';

const pageComponents: Record<Page, React.FC> = {
  dashboard: DashboardPage,
  contacts: ContactsPage,
  conversations: ConversationsPage,
  send: SendMessagePage,
  voice: VoiceStudioPage,
  settings: SettingsPage,
};

const Index = () => {
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const ActiveComponent = pageComponents[activePage];

  return (
    <div className="flex min-h-screen bg-background">
      <DashboardSidebar activePage={activePage} onPageChange={setActivePage} />
      <main className="flex-1 p-6 overflow-auto">
        <ActiveComponent />
      </main>
    </div>
  );
};

export default Index;
