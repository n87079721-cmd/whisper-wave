import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Mic,
  Settings,
  Sun,
  Moon,
  MoreHorizontal,
  X,
  CircleDot,
  Phone,
  Shield,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type Page = 'dashboard' | 'contacts' | 'conversations' | 'voice' | 'settings' | 'status' | 'calls' | 'admin';

interface MobileBottomNavProps {
  activePage: Page;
  onPageChange: (page: Page) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const primaryItems: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'conversations', label: 'Chats', icon: MessageSquare },
  { id: 'status', label: 'Status', icon: CircleDot },
  { id: 'contacts', label: 'Contacts', icon: Users },
];

const allMoreItems: { id: Page; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'voice', label: 'Voice Studio', icon: Mic },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'admin', label: 'Admin', icon: Shield, adminOnly: true },
];

const MobileBottomNav = ({ activePage, onPageChange, theme, onToggleTheme }: MobileBottomNavProps) => {
  const [showMore, setShowMore] = useState(false);
  const { user, logout } = useAuth();
  const moreItems = allMoreItems.filter((item) => !item.adminOnly || user?.isAdmin);
  const isMoreActive = moreItems.some(i => i.id === activePage);

  return (
    <>
      {showMore && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
          <div
            className="absolute bottom-16 left-2 right-2 rounded-xl border border-border bg-card p-2 shadow-xl safe-bottom"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 mb-1">
              <span className="text-xs font-medium text-muted-foreground">More</span>
              <button onClick={() => setShowMore(false)} className="text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            {moreItems.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { onPageChange(item.id); setShowMore(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-accent'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              onClick={() => { onToggleTheme(); setShowMore(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-accent transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
            {user && (
              <>
                <div className="my-1 h-px bg-border" />
                <div className="px-3 pt-1 pb-1.5 text-[11px] text-muted-foreground truncate">
                  Signed in as {user.username}
                </div>
                <button
                  onClick={() => { setShowMore(false); logout(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Sign out</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur md:hidden safe-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="mx-auto flex max-w-xl items-center justify-around px-1 py-1.5">
          {primaryItems.map((item) => {
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
            onClick={() => setShowMore(!showMore)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors ${
              isMoreActive ? 'text-primary' : 'text-sidebar-foreground'
            }`}
          >
            <MoreHorizontal className={`w-5 h-5 ${isMoreActive ? 'text-primary' : ''}`} />
            <span className="text-[10px] font-medium truncate">More</span>
          </button>
        </div>
      </nav>
    </>
  );
};

export default MobileBottomNav;
