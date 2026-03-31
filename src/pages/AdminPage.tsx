import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, Trash2, Loader2, Shield, RefreshCw, AlertTriangle, Bug, Clock, Bot, XCircle, CheckCircle2, MessageSquare, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface UserAccount {
  id: string;
  username: string;
  display_name: string | null;
  created_at: string;
  message_count: number;
  contact_count: number;
  is_current: boolean;
}

interface DebugEntry {
  id: number;
  userId: string;
  action: string;
  contact?: string;
  created_at: string;
  [key: string]: any;
}

const ACTION_CONFIG: Record<string, { icon: typeof Bot; color: string; label: string }> = {
  message_received_for_ai: { icon: MessageSquare, color: 'text-blue-400', label: 'Message received' },
  batch_extended: { icon: Clock, color: 'text-amber-400', label: 'Batch extended' },
  batch_timer_fired: { icon: Zap, color: 'text-amber-500', label: 'Batch ready' },
  generating_ai_reply: { icon: Bot, color: 'text-purple-400', label: 'Generating reply' },
  reply_scheduled: { icon: Clock, color: 'text-emerald-400', label: 'Reply scheduled' },
  typing_started: { icon: MessageSquare, color: 'text-cyan-400', label: 'Typing...' },
  auto_reply_sent: { icon: CheckCircle2, color: 'text-green-400', label: 'Reply sent' },
  skip_cooldown: { icon: XCircle, color: 'text-red-400', label: 'Skipped (cooldown)' },
  skip_reply_chance: { icon: XCircle, color: 'text-orange-400', label: 'Skipped (chance)' },
  skip_no_api_key: { icon: XCircle, color: 'text-red-500', label: 'Skipped (no API key)' },
  skip_automation_disabled: { icon: XCircle, color: 'text-muted-foreground', label: 'Skipped (off)' },
  skip_archived_chat: { icon: XCircle, color: 'text-muted-foreground', label: 'Skipped (archived)' },
  reply_too_similar_regenerating: { icon: RefreshCw, color: 'text-yellow-400', label: 'Regenerating' },
  skip_still_too_similar: { icon: XCircle, color: 'text-red-400', label: 'Skipped (similar)' },
  reaction_sent_instead: { icon: Zap, color: 'text-pink-400', label: 'Reacted instead' },
  batch_auto_reply_error: { icon: AlertTriangle, color: 'text-red-500', label: 'Error' },
};

const AdminPage = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [debugLogs, setDebugLogs] = useState<DebugEntry[]>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugAutoRefresh, setDebugAutoRefresh] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.adminListUsers();
      setUsers(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDebugLogs = useCallback(async () => {
    setDebugLoading(true);
    try {
      const data = await api.adminGetDebugLogs(200) as DebugEntry[];
      setDebugLogs(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load debug logs');
    } finally {
      setDebugLoading(false);
    }
  }, []);

  const clearDebugLogs = async () => {
    try {
      await api.adminClearDebugLogs();
      setDebugLogs([]);
      toast.success('Debug logs cleared');
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear');
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchDebugLogs();
  }, [fetchUsers, fetchDebugLogs]);

  useEffect(() => {
    if (!debugAutoRefresh) return;
    const interval = setInterval(fetchDebugLogs, 5000);
    return () => clearInterval(interval);
  }, [debugAutoRefresh, fetchDebugLogs]);

  const handleDelete = async (userId: string) => {
    if (userId === user?.id) {
      toast.error("You can't delete your own account while logged in");
      return;
    }
    setDeletingId(userId);
    try {
      await api.adminDeleteUser(userId);
      toast.success('Account deleted successfully');
      setUsers(prev => prev.filter(u => u.id !== userId));
      setConfirmDeleteId(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete account');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (ts: string) => {
    try {
      return new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return ts;
    }
  };

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  };

  const renderLogDetails = (entry: DebugEntry) => {
    const skip = ['id', 'userId', 'action', 'contact', 'created_at', 'ts'];
    const details = Object.entries(entry).filter(([k]) => !skip.includes(k));
    if (details.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
        {details.map(([key, val]) => (
          <span key={key} className="text-[10px] text-muted-foreground">
            <span className="opacity-60">{key}:</span>{' '}
            <span className="text-foreground/70">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-1"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-xs text-muted-foreground">Manage accounts & monitor AI</p>
          </div>
          <button
            onClick={() => { setLoading(true); fetchUsers(); }}
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </motion.div>

      {/* Users Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-xl border border-border bg-card overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            All Accounts ({users.length})
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">No accounts found</div>
        ) : (
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0">
                  {(u.display_name || u.username).slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {u.display_name || u.username}
                    </p>
                    {u.is_current && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">You</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    @{u.username} • Joined {formatDate(u.created_at)} • {u.contact_count} contacts • {u.message_count} msgs
                  </p>
                </div>
                <div className="flex-shrink-0">
                  {confirmDeleteId === u.id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleDelete(u.id)}
                        disabled={deletingId === u.id || u.is_current}
                        className="px-2.5 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:bg-destructive/90 transition-colors disabled:opacity-40"
                      >
                        {deletingId === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(u.id)}
                      disabled={u.is_current}
                      className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={u.is_current ? "Can't delete your own account" : 'Delete account'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* AI Debug Logs Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-border bg-card overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Bug className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground flex-1">
            AI Debug Log ({debugLogs.length})
          </span>
          <button
            onClick={() => setDebugAutoRefresh(prev => !prev)}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              debugAutoRefresh ? 'bg-green-500/15 text-green-400' : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {debugAutoRefresh ? '● Live' : 'Auto'}
          </button>
          <button
            onClick={fetchDebugLogs}
            disabled={debugLoading}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${debugLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={clearDebugLogs}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Clear all debug logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {debugLogs.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            <Bug className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No debug logs yet. AI activity will appear here in real-time.
          </div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
            {debugLogs.map((entry) => {
              const config = ACTION_CONFIG[entry.action] || { icon: Bug, color: 'text-muted-foreground', label: entry.action };
              const Icon = config.icon;
              return (
                <div key={entry.id} className="px-4 py-2.5 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-start gap-2.5">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                        {entry.contact && (
                          <span className="text-[10px] text-muted-foreground truncate">
                            → {entry.contact}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                          {formatTime(entry.created_at)}
                        </span>
                      </div>
                      {renderLogDetails(entry)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Danger Zone */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-xl border border-border bg-card p-4 space-y-2"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-foreground">Danger Zone</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Deleting an account permanently removes all their messages, contacts, WhatsApp session, and configuration.
          This cannot be undone.
        </p>
      </motion.div>
    </div>
  );
};

export default AdminPage;
