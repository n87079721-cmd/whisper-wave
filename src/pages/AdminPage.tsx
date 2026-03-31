import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, Trash2, Loader2, Shield, RefreshCw, AlertTriangle } from 'lucide-react';
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

const AdminPage = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

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
            <p className="text-xs text-muted-foreground">Manage user accounts</p>
          </div>
          <button
            onClick={() => { setLoading(true); fetchUsers(); }}
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </motion.div>

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

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
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
