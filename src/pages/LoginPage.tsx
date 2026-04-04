import { forwardRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Loader2, User, Lock, UserPlus, LogIn } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const LoginPage = forwardRef<HTMLDivElement>((_, ref) => {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBackendUrl, setShowBackendUrl] = useState(false);
  const [backendUrl, setBackendUrl] = useState(() => localStorage.getItem('wa_api_url') || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    // Save backend URL if provided
    if (backendUrl.trim()) {
      localStorage.setItem('wa_api_url', backendUrl.trim().replace(/\/$/, ''));
    } else {
      localStorage.removeItem('wa_api_url');
    }
    setLoading(true);
    try {
      if (isRegister) {
        await register(username, password, displayName || undefined);
        toast.success('Account created!');
      } else {
        await login(username, password);
        toast.success('Welcome back!');
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={ref} className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">WA Controller</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isRegister ? 'Create your account' : 'Sign in to your dashboard'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass rounded-xl p-6 space-y-4">
          {isRegister && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Display Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? 'Min 6 characters' : 'Enter password'}
                required
                minLength={isRegister ? 6 : undefined}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isRegister ? (
              <UserPlus className="w-4 h-4" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>

          <div className="text-center space-y-2">
            <button
              type="button"
              onClick={() => setIsRegister(!isRegister)}
              className="text-xs text-primary hover:underline"
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
            </button>
            <button
              type="button"
              onClick={() => setShowBackendUrl(!showBackendUrl)}
              className="block mx-auto text-xs text-muted-foreground hover:text-foreground"
            >
              {showBackendUrl ? 'Hide server settings' : '⚙️ Configure server URL'}
            </button>
            {showBackendUrl && (
              <div className="pt-2">
                <input
                  type="url"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="https://your-server.com"
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Leave empty if frontend is served by the backend</p>
              </div>
            )}
          </div>
  );
});

LoginPage.displayName = 'LoginPage';

export default LoginPage;
