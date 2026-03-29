import { useState, useEffect, useCallback } from 'react';
import { Phone, Video, PhoneIncoming, PhoneMissed, RefreshCw } from 'lucide-react';
import { api, type CallLog } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

function getDisplayName(call: CallLog) {
  if (call.caller_name && !/^\+?\d{7,}$/.test(call.caller_name.replace(/\s/g, '')) && !call.caller_name.includes('@')) {
    return call.caller_name;
  }
  return call.caller_phone || call.caller_jid?.replace(/@.*$/, '') || 'Unknown';
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const CallsPage = () => {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCalls = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getCallLogs();
      setCalls(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = api.createEventSource();
      es.addEventListener('call', fetchCalls);
    } catch {}
    return () => es?.close();
  }, [fetchCalls]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Calls</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading...' : `${calls.length} call${calls.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={fetchCalls}
          disabled={loading}
          className="rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-accent"
          aria-label="Refresh calls"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {calls.length === 0 && !loading && (
        <div className="py-16 text-center text-muted-foreground">
          <PhoneIncoming className="mx-auto mb-3 h-12 w-12 opacity-40" />
          <p className="text-sm">No calls yet</p>
          <p className="mt-1 text-xs">Missed and incoming calls will appear here</p>
        </div>
      )}

      <div className="space-y-0.5">
        {calls.map((call) => {
          const name = getDisplayName(call);
          const isMissed = call.status === 'missed' || call.status === 'timeout';
          const isVideo = !!call.is_video;

          return (
            <div
              key={call.id}
              className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-accent/50 active:bg-accent/70"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted flex-shrink-0">
                <span className="text-sm font-medium text-foreground">{getInitials(name)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${isMissed ? 'text-destructive' : 'text-foreground'}`}>
                  {name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isMissed ? (
                    <PhoneMissed className="h-3 w-3 text-destructive inline-btn" />
                  ) : (
                    <PhoneIncoming className="h-3 w-3 text-muted-foreground inline-btn" />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {isMissed ? 'Missed' : 'Incoming'} {isVideo ? 'video' : 'voice'} call
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(call.timestamp), { addSuffix: true })}
                </span>
                {isVideo ? (
                  <Video className={`h-4 w-4 inline-btn ${isMissed ? 'text-destructive' : 'text-muted-foreground'}`} />
                ) : (
                  <Phone className={`h-4 w-4 inline-btn ${isMissed ? 'text-destructive' : 'text-muted-foreground'}`} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CallsPage;
