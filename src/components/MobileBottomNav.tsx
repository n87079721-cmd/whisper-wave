import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Mic,
  Settings,
} from 'lucide-react';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings';

interface MobileBottomNavProps {
  activePage: Page;
  onPageChange: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'conversations', label: 'Chats', icon: MessageSquare },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const MobileBottomNav = ({ activePage, onPageChange }: MobileBottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur md:hidden safe-bottom shadow-[0_-12px_30px_hsl(var(--background)/0.45)]">
      <div className="mx-auto flex max-w-xl items-center justify-around px-2 py-2">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 transition-colors ${
                isActive ? 'text-primary' : 'text-sidebar-foreground'
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
