import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type StatusGroup, type StatusItem } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, X, ChevronLeft, ChevronRight, Eye } from 'lucide-react';

function getDisplayName(s: { name?: string | null; phone?: string | null; jid?: string }) {
  if (s.name && !/^\+?\d{7,}$/.test(s.name.replace(/\s/g, '')) && !s.name.includes('@')) return s.name;
  if (s.phone) return s.phone;
  return s.jid?.replace(/@.*$/, '') || 'Unknown';
}


const TEXT_BG_COLORS = [
  'bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-teal-600', 'bg-indigo-600', 'bg-pink-600',
];

function hashColor(jid: string) {
  let h = 0;
  for (let i = 0; i < jid.length; i++) h = (h * 31 + jid.charCodeAt(i)) | 0;
  return TEXT_BG_COLORS[Math.abs(h) % TEXT_BG_COLORS.length];
}

const StatusPage = () => {
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerGroup, setViewerGroup] = useState<StatusGroup | null>(null);
  const [viewerIdx, setViewerIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatuses = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getStatuses();
      setGroups(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  // Auto-advance in viewer
  useEffect(() => {
    if (!viewerGroup) return;
    const current = viewerGroup.statuses[viewerIdx];
    if (!current) return;

    // Don't auto-advance videos (user controls playback)
    if (current.mediaType === 'video') return;

    timerRef.current = setTimeout(() => {
      if (viewerIdx < viewerGroup.statuses.length - 1) {
        setViewerIdx(viewerIdx + 1);
      } else {
        setViewerGroup(null);
        setViewerIdx(0);
      }
    }, 5000);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [viewerGroup, viewerIdx]);

  const goNext = () => {
    if (!viewerGroup) return;
    if (viewerIdx < viewerGroup.statuses.length - 1) {
      setViewerIdx(viewerIdx + 1);
    } else {
      setViewerGroup(null);
      setViewerIdx(0);
    }
  };

  const goPrev = () => {
    if (!viewerGroup) return;
    if (viewerIdx > 0) {
      setViewerIdx(viewerIdx - 1);
    }
  };

  const openViewer = (group: StatusGroup) => {
    setViewerGroup(group);
    setViewerIdx(0);
  };

  // ── Full-screen viewer ──
  if (viewerGroup) {
    const status = viewerGroup.statuses[viewerIdx];
    const total = viewerGroup.statuses.length;

    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        {/* Progress bars */}
        <div className="flex gap-1 px-2 pt-2">
          {viewerGroup.statuses.map((_, i) => (
            <div key={i} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
              <div
                className={`h-full bg-white transition-all duration-300 ${
                  i < viewerIdx ? 'w-full' : i === viewerIdx ? 'w-full animate-pulse' : 'w-0'
                }`}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => { setViewerGroup(null); setViewerIdx(0); }} className="text-white">
            <X className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">
              {getDisplayName({ name: viewerGroup.senderName, phone: viewerGroup.senderPhone, jid: viewerGroup.senderJid })}
            </p>
            <p className="text-white/60 text-xs">
              {formatDistanceToNow(new Date(status.timestamp), { addSuffix: true })}
            </p>
          </div>
          <span className="text-white/60 text-xs">{viewerIdx + 1}/{total}</span>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center relative">
          {/* Tap zones */}
          <button onClick={goPrev} className="absolute left-0 top-0 w-1/3 h-full z-10" />
          <button onClick={goNext} className="absolute right-0 top-0 w-1/3 h-full z-10" />

          {status.mediaType === 'text' && (
            <div className={`${hashColor(viewerGroup.senderJid)} w-full h-full flex items-center justify-center p-8`}>
              <p className="text-white text-xl md:text-2xl text-center font-medium leading-relaxed max-w-lg">
                {status.content}
              </p>
            </div>
          )}

          {status.mediaType === 'image' && status.mediaPath && (
            <div className="w-full h-full flex items-center justify-center">
              <img
                src={api.getStatusMediaUrl(status.mediaPath)}
                alt=""
                className="max-w-full max-h-full object-contain"
              />
              {status.content && (
                <div className="absolute bottom-16 left-0 right-0 px-6 py-3 bg-black/50">
                  <p className="text-white text-sm text-center">{status.content}</p>
                </div>
              )}
            </div>
          )}

          {status.mediaType === 'video' && status.mediaPath && (
            <div className="w-full h-full flex items-center justify-center">
              <video
                src={api.getStatusMediaUrl(status.mediaPath)}
                controls
                autoPlay
                className="max-w-full max-h-full"
                onEnded={goNext}
              />
              {status.content && (
                <div className="absolute bottom-16 left-0 right-0 px-6 py-3 bg-black/50">
                  <p className="text-white text-sm text-center">{status.content}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Status list ──
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-foreground">Status</h1>
        <button
          onClick={fetchStatuses}
          disabled={loading}
          className="p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {groups.length === 0 && !loading && (
        <div className="text-center py-16 text-muted-foreground">
          <Eye className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No status updates yet</p>
          <p className="text-xs mt-1">Status updates from your contacts will appear here</p>
        </div>
      )}

      <div className="space-y-1">
        {groups.map((group) => {
          const lastStatus = group.statuses[group.statuses.length - 1];
          const count = group.statuses.length;
          return (
            <button
              key={group.senderJid}
              onClick={() => openViewer(group)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-accent/50 transition-colors text-left"
            >
              {/* Ring indicator */}
              <div className="w-12 h-12 rounded-full border-2 border-primary flex items-center justify-center bg-muted">
                <span className="text-sm font-medium text-muted-foreground">
                  {(getDisplayName({ name: group.senderName, phone: group.senderPhone, jid: group.senderJid }) || '?')[0].toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {getDisplayName({ name: group.senderName, phone: group.senderPhone, jid: group.senderJid })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {count} update{count > 1 ? 's' : ''} · {formatDistanceToNow(new Date(lastStatus.timestamp), { addSuffix: true })}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StatusPage;
