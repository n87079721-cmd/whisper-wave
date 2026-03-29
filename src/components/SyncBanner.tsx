import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import type { SyncState } from '@/hooks/useWhatsAppStatus';

interface SyncBannerProps {
  syncState: SyncState;
  isConnected: boolean;
  onResync?: () => void;
  compact?: boolean;
}

const SyncBanner = ({ syncState, isConnected, onResync, compact }: SyncBannerProps) => {
  if (!isConnected) return null;

  const { phase, historyMessages, historyContacts, unresolvedLids, totalDbContacts } = syncState;

  if (phase === 'ready' && unresolvedLids === 0) return null;

  const isSyncing = phase === 'waiting_history' || phase === 'importing' || phase === 'recovering';
  const isPartial = phase === 'partial';
  const hasUnresolved = unresolvedLids > 0;

  if (!isSyncing && !isPartial && !hasUnresolved) return null;

  return (
    <div className={`rounded-lg border p-3 ${
      isPartial ? 'bg-warning/10 border-warning/30' : 'bg-muted/50 border-border'
    }`}>
      <div className="flex items-start gap-2.5">
        {isSyncing ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${isPartial ? 'text-warning' : 'text-muted-foreground'}`} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">
            {phase === 'recovering'
              ? 'Recovering missing chats…'
              : isSyncing
                ? 'Syncing WhatsApp history…'
                : isPartial
                  ? 'Partial sync — some chats may be missing'
                  : 'Some contacts are still resolving'}
          </p>
          {!compact && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {isSyncing
                ? `${historyMessages} messages, ${historyContacts} contacts imported so far`
                : isPartial
                  ? `Only ${totalDbContacts} contacts and ${historyMessages} messages were imported. A Fresh Re-sync from Settings may recover older chats.`
                  : `${unresolvedLids} contact${unresolvedLids > 1 ? 's' : ''} pending name resolution`}
            </p>
          )}
          {isPartial && onResync && (
            <button
              onClick={onResync}
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Fresh Re-sync
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SyncBanner;
