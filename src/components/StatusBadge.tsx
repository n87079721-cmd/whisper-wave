interface StatusBadgeProps {
  connected: boolean;
  label?: string;
}

const StatusBadge = ({ connected, label }: StatusBadgeProps) => (
  <span
    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
      connected
        ? 'bg-primary/15 text-primary'
        : 'bg-destructive/15 text-destructive'
    }`}
  >
    <span className={`w-2 h-2 rounded-full ${connected ? 'bg-primary animate-pulse' : 'bg-destructive'}`} />
    {label ?? (connected ? 'Connected' : 'Disconnected')}
  </span>
);

export default StatusBadge;
