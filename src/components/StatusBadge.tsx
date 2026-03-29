import { forwardRef } from 'react';

interface StatusBadgeProps {
  connected: boolean;
  label?: string;
  syncPhase?: string;
}

function getSyncLabel(syncPhase?: string): string | null {
  switch (syncPhase) {
    case 'waiting_history': return 'Syncing…';
    case 'importing': return 'Importing history…';
    case 'recovering': return 'Recovering chats…';
    case 'partial': return 'Partial sync';
    case 'ready': return 'Synced';
    default: return null;
  }
}

const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(({ connected, label, syncPhase }, ref) => {
  const syncLabel = getSyncLabel(syncPhase);
  const isPartial = syncPhase === 'partial';
  const isSyncing = syncPhase === 'waiting_history' || syncPhase === 'importing' || syncPhase === 'recovering';

  const displayLabel = label ?? (
    connected
      ? (syncLabel || 'Connected')
      : 'Disconnected'
  );

  const colorClass = connected
    ? isPartial
      ? 'bg-warning/15 text-warning'
      : 'bg-primary/15 text-primary'
    : 'bg-destructive/15 text-destructive';

  const dotClass = connected
    ? isPartial
      ? 'bg-warning'
      : isSyncing
        ? 'bg-primary animate-pulse'
        : 'bg-primary'
    : 'bg-destructive';

  return (
    <span
      ref={ref}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      {displayLabel}
    </span>
  );
});

StatusBadge.displayName = 'StatusBadge';

export default StatusBadge;
