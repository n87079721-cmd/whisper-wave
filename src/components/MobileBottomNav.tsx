import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Mic,
  Settings,
  Sun,
  Moon,
  CircleDot,
  Phone,
} from 'lucide-react';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings' | 'status' | 'calls';

interface MobileBottomNavProps {
  activePage: Page;
  onPageChange: (page: Page) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'conversations', label: 'Chats', icon: MessageSquare },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'status', label: 'Status', icon: CircleDot },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const MobileBottomNav = ({ activePage, onPageChange, theme, onToggleTheme }: MobileBottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur md:hidden safe-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-xl items-center justify-around px-1 py-1.5">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors ${
                isActive ? 'text-primary' : 'text-sidebar-foreground'
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-sidebar-foreground"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          <span className="text-[10px] font-medium">Theme</span>
        </button>
      </div>
    </nav>
  );
};

export default MobileBottomNav;
