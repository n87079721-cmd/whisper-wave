import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Send,
  Mic,
  Settings,
} from 'lucide-react';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'send' | 'voice' | 'settings';

interface MobileBottomNavProps {
  activePage: Page;
  onPageChange: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'conversations', label: 'Chats', icon: MessageSquare },
  { id: 'send', label: 'Send', icon: Send },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const MobileBottomNav = ({ activePage, onPageChange }: MobileBottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-sidebar-border md:hidden safe-bottom">
      <div className="flex items-center justify-around px-1 py-1.5">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors min-w-0 flex-1 ${
                isActive
                  ? 'text-primary'
                  : 'text-sidebar-foreground'
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
