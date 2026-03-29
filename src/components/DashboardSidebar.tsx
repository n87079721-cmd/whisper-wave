import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Mic,
  Settings,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  LogOut,
  Sun,
  Moon,
  CircleDot,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings' | 'status';

interface DashboardSidebarProps {
  activePage: Page;
  onPageChange: (page: Page) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const navItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'conversations', label: 'Chats', icon: MessageSquare },
  { id: 'status', label: 'Status', icon: CircleDot },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'voice', label: 'Voice Studio', icon: Mic },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const DashboardSidebar = ({ activePage, onPageChange, theme, onToggleTheme }: DashboardSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();

  return (
    <aside
      style={{ width: collapsed ? 72 : 240 }}
      className="h-screen bg-sidebar border-r border-sidebar-border flex flex-col sticky top-0 transition-[width] duration-200"
    >
      <div className="flex items-center gap-3 px-4 h-14 border-b border-sidebar-border">
        <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-5 h-5 text-primary-foreground" />
        </div>
        {!collapsed && (
          <span className="font-semibold text-foreground text-sm tracking-tight">Messages</span>
        )}
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
              }`}
            >
              <item.icon className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="px-2 pb-2 space-y-1">
        <button
          onClick={onToggleTheme}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-[18px] h-[18px] flex-shrink-0" /> : <Moon className="w-[18px] h-[18px] flex-shrink-0" />}
          {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        {!collapsed && user && (
          <div className="px-3 py-2 text-xs text-muted-foreground truncate">
            {user.displayName || user.username}
          </div>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
        >
          <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="mx-2 mb-4 p-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors flex items-center justify-center"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
};

export default DashboardSidebar;
