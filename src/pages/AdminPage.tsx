import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Trash2, Loader2, Shield, RefreshCw, AlertTriangle, Bug, Clock, Bot, XCircle, CheckCircle2, MessageSquare, Zap, Ban, ChevronDown, ChevronUp, Send } from 'lucide-react';
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
  memory_count?: number;
  directive_count?: number;
  persona_count?: number;
  is_current: boolean;
  is_admin?: boolean;
  isAdmin?: boolean;
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
  sending_reply: { icon: Send, color: 'text-blue-300', label: 'Sending...' },
  auto_reply_sent: { icon: CheckCircle2, color: 'text-green-400', label: 'Reply sent ✓' },
  auto_reply_failed: { icon: AlertTriangle, color: 'text-red-500', label: 'Send failed ✗' },
  reply_queued_for_retry: { icon: RefreshCw, color: 'text-yellow-500', label: 'Queued for retry' },
  skip_cooldown: { icon: XCircle, color: 'text-red-400', label: 'Skipped (cooldown)' },
  skip_reply_chance: { icon: XCircle, color: 'text-orange-400', label: 'Skipped (chance)' },
  skip_no_api_key: { icon: XCircle, color: 'text-red-500', label: 'Skipped (no API key)' },
  skip_automation_disabled: { icon: XCircle, color: 'text-muted-foreground', label: 'Skipped (off)' },
  skip_archived_chat: { icon: XCircle, color: 'text-muted-foreground', label: 'Skipped (archived)' },
  reply_too_similar_regenerating: { icon: RefreshCw, color: 'text-yellow-400', label: 'Regenerating' },
  reply_cancelled: { icon: XCircle, color: 'text-orange-500', label: 'Reply cancelled' },
  skip_still_too_similar: { icon: XCircle, color: 'text-red-400', label: 'Skipped (similar)' },
  reaction_sent_instead: { icon: Zap, color: 'text-pink-400', label: 'Reacted instead' },
  batch_auto_reply_error: { icon: AlertTriangle, color: 'text-red-500', label: 'Error' },
  telegram_cancel: { icon: XCircle, color: 'text-orange-500', label: 'Cancelled (Telegram)' },
  telegram_rewrite: { icon: RefreshCw, color: 'text-blue-400', label: 'Rewriting (Telegram)' },
  telegram_custom: { icon: MessageSquare, color: 'text-purple-400', label: 'Custom instructions' },
  telegram_custom_reply_sent: { icon: Send, color: 'text-green-400', label: 'Custom reply sent ✓' },
};

// Live countdown component for scheduled replies
const Countdown = ({ scheduledAt, delayMs, delaySec, contact, onCancelled }: { scheduledAt: string; delayMs?: number; delaySec?: number; contact?: string; onCancelled?: () => void }) => {
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  
  // Derive actual delay in ms: prefer delaySec (from backend), fall back to delayMs
  const actualDelayMs = delaySec ? delaySec * 1000 : (delayMs || 0);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Ensure UTC parsing – backend may omit the 'Z' suffix
  const ts = scheduledAt.endsWith('Z') || scheduledAt.includes('+') ? scheduledAt : scheduledAt + 'Z';
  const sendAt = new Date(ts).getTime() + actualDelayMs;
  const remaining = Math.max(0, Math.floor((sendAt - now) / 1000));

  const handleCancel = async () => {
    if (!contact || cancelling || cancelled) return;
    setCancelling(true);
    try {
      await api.cancelPendingReply(contact);
      setCancelled(true);
      toast.success('Reply cancelled');
      onCancelled?.();
    } catch {
      toast.error('Failed to cancel');
    } finally {
      setCancelling(false);
    }
  };

  if (cancelled) {
    return <span className="text-[10px] font-medium text-destructive">✕ Cancelled</span>;
  }

  if (remaining <= 0) {
    return <span className="text-[10px] font-medium text-green-400">✓ sending now</span>;
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return (
    <div className="flex items-center gap-2 mt-0.5">
      <span className="text-[10px] font-mono font-medium text-amber-400 tabular-nums">
        ⏱ {mins}:{secs.toString().padStart(2, '0')}
      </span>
      <button
        onClick={handleCancel}
        disabled={cancelling}
        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
      >
        {cancelling ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Ban className="w-2.5 h-2.5" />}
        Cancel
      </button>
    </div>
  );
};

const AdminPage = () => {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [adminTogglingId, setAdminTogglingId] = useState<string | null>(null);

  const [debugLogs, setDebugLogs] = useState<DebugEntry[]>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugAutoRefresh, setDebugAutoRefresh] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    try {
      const data = await api.adminListUsers();
      setUsers(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  const fetchDebugLogs = useCallback(async () => {
    setDebugLoading(true);
    try {
      const data = (isAdmin
        ? await api.adminGetDebugLogs(200)
        : await api.getMyDebugLogs(200)) as DebugEntry[];
      setDebugLogs(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load debug logs');
    } finally {
      setDebugLoading(false);
    }
  }, [isAdmin]);

  const clearDebugLogs = async () => {
    try {
      if (isAdmin) {
        await api.adminClearDebugLogs();
      } else {
        await api.clearMyDebugLogs();
      }
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

  const handleToggleAdmin = async (target: UserAccount) => {
    if (target.is_current) {
      toast.error("You can't change admin on your own account");
      return;
    }
    const next = !(target.is_admin || target.isAdmin);
    setAdminTogglingId(target.id);
    try {
      await api.adminSetUserAdmin(target.id, next);
      toast.success(next ? `${target.display_name || target.username} is now an admin` : `Admin removed from ${target.display_name || target.username}`);
      setUsers((prev) => prev.map((u) => (u.id === target.id ? { ...u, is_admin: next, isAdmin: next } : u)));
    } catch (err: any) {
      toast.error(err.message || 'Failed to update admin');
    } finally {
      setAdminTogglingId(null);
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
      // Backend stores UTC timestamps - ensure proper UTC parsing even without 'Z' suffix
      const normalized = ts.endsWith('Z') || ts.includes('+') || ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
      return new Date(normalized).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  };

  const renderLogDetails = (entry: DebugEntry) => {
    const skip = ['id', 'userId', 'action', 'contact', 'created_at', 'ts', 'replyPreview'];
    const details = Object.entries(entry).filter(([k]) => !skip.includes(k));
    const isExpanded = expandedLogId === entry.id;
    const hasReplyPreview = !!entry.replyPreview;

    return (
      <div className="mt-0.5 space-y-1">
        {/* Reply preview - clickable to expand */}
        {hasReplyPreview && (
          <button
            onClick={() => setExpandedLogId(isExpanded ? null : entry.id)}
            className="flex items-start gap-1 text-left w-full group"
          >
            <span className="text-[10px] text-muted-foreground opacity-60 flex-shrink-0">replyPreview:</span>
            <span className={`text-[10px] text-foreground/70 ${isExpanded ? '' : 'line-clamp-1'}`}>
              {entry.replyPreview}
            </span>
            {String(entry.replyPreview).length > 80 && (
              isExpanded
                ? <ChevronUp className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                : <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        )}
        {/* Other details */}
        {details.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {details.map(([key, val]) => (
              <span key={key} className="text-[10px] text-muted-foreground">
                <span className="opacity-60">{key}:</span>{' '}
                <span className="text-foreground/70">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
              </span>
            ))}
          </div>
        )}
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
            {isAdmin ? <Shield className="w-5 h-5 text-primary" /> : <Bug className="w-5 h-5 text-primary" />}
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{isAdmin ? 'Admin Panel' : 'AI Activity'}</h1>
            <p className="text-xs text-muted-foreground">{isAdmin ? 'Manage accounts & monitor AI' : 'Live AI activity for your account'}</p>
          </div>
          <button
            onClick={() => { setLoading(true); fetchUsers(); }}
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </motion.div>

      {/* Users Card — admin only */}
      {isAdmin && (<motion.div
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
                    {(u.is_admin || u.isAdmin) && (
                      <span className="text-[10px] bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5">
                        <Shield className="w-2.5 h-2.5" /> Admin
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    @{u.username} • Joined {formatDate(u.created_at)} • {u.contact_count} contacts • {u.message_count} msgs
                  </p>
                  {(u.memory_count || u.directive_count || u.persona_count) ? (
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                      🧠 {u.memory_count || 0} memories • 🎯 {u.directive_count || 0} directives • 🎭 {u.persona_count || 0} personas
                    </p>
                  ) : null}
                </div>
                <div className="flex-shrink-0 flex items-center gap-1">
                  {!u.is_current && (
                    <button
                      onClick={() => handleToggleAdmin(u)}
                      disabled={adminTogglingId === u.id}
                      className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${
                        (u.is_admin || u.isAdmin)
                          ? 'text-amber-500 hover:bg-amber-500/10'
                          : 'text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10'
                      }`}
                      title={(u.is_admin || u.isAdmin) ? 'Revoke admin' : 'Grant admin'}
                    >
                      {adminTogglingId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    </button>
                  )}
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
      </motion.div>)}

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
                      {entry.action === 'reply_scheduled' && (entry.delayMs || entry.delaySec) && !debugLogs.some(
                        (other) => other.contact === entry.contact &&
                          (other.action === 'auto_reply_sent' || other.action === 'typing_started' || other.action === 'reply_cancelled') &&
                          other.id > entry.id
                      ) && (
                        <Countdown scheduledAt={entry.created_at} delayMs={entry.delayMs} delaySec={entry.delaySec} contact={entry.contact} onCancelled={fetchDebugLogs} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Danger Zone — admin only */}
      {isAdmin && (<motion.div
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
      </motion.div>)}
    </div>
  );
};

export default AdminPage;
