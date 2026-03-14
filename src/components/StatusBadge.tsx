import { forwardRef } from 'react';

interface StatusBadgeProps {
  connected: boolean;
  label?: string;
}

const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(({ connected, label }, ref) => (
  <span
    ref={ref}
    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
      connected
        ? 'bg-primary/15 text-primary'
        : 'bg-destructive/15 text-destructive'
    }`}
  >
    <span className={`w-2 h-2 rounded-full ${connected ? 'bg-primary animate-pulse' : 'bg-destructive'}`} />
    {label ?? (connected ? 'Connected' : 'Disconnected')}
  </span>
));

StatusBadge.displayName = 'StatusBadge';

export default StatusBadge;
