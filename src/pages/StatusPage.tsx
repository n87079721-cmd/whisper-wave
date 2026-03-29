import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type StatusGroup } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, X, ChevronRight, Eye, Download, Send } from 'lucide-react';
import { toast } from 'sonner';

const STORY_DURATION_MS = 5000;
const HOLD_THRESHOLD_MS = 220;

const STATUS_BG_VARIANTS = [
  { container: 'bg-primary', text: 'text-primary-foreground' },
  { container: 'bg-accent', text: 'text-accent-foreground' },
  { container: 'bg-secondary', text: 'text-secondary-foreground' },
];

function getDisplayName(s: { name?: string | null; phone?: string | null; jid?: string }) {
  if (s.name && !/^\+?\d{7,}$/.test(s.name.replace(/\s/g, '')) && !s.name.includes('@')) return s.name;
  if (s.phone) return s.phone;
  return s.jid?.replace(/@.*$/, '') || 'Unknown';
}

function getStatusVariant(jid: string) {
  let hash = 0;
  for (let i = 0; i < jid.length; i++) hash = (hash * 31 + jid.charCodeAt(i)) | 0;
  return STATUS_BG_VARIANTS[Math.abs(hash) % STATUS_BG_VARIANTS.length];
}

const StatusPage = () => {
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerGroup, setViewerGroup] = useState<StatusGroup | null>(null);
  const [viewerIdx, setViewerIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mediaReady, setMediaReady] = useState(true);
  const [mediaError, setMediaError] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const holdStartedAtRef = useRef<number | null>(null);
  const blockTapRef = useRef(false);
  const replyInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = api.createEventSource();
      es.addEventListener('status_update', fetchStatuses);
      es.addEventListener('status_deleted', fetchStatuses);
    } catch {
      // backend not configured
    }
    return () => es?.close();
  }, [fetchStatuses]);

  const currentStatus = viewerGroup?.statuses[viewerIdx] ?? null;

  const closeViewer = useCallback(() => {
    setViewerGroup(null);
    setViewerIdx(0);
    setIsPaused(false);
    setProgress(0);
    setMediaReady(true);
    setMediaError(false);
    setReplyText('');
    blockTapRef.current = false;
    holdStartedAtRef.current = null;
    videoRef.current = null;
  }, []);

  const goNextRaw = useCallback(() => {
    if (!viewerGroup) return;
    if (viewerIdx < viewerGroup.statuses.length - 1) {
      setViewerIdx((prev) => prev + 1);
      return;
    }
    closeViewer();
  }, [closeViewer, viewerGroup, viewerIdx]);

  const goPrevRaw = useCallback(() => {
    if (!viewerGroup) return;
    if (viewerIdx > 0) {
      setViewerIdx((prev) => prev - 1);
    }
  }, [viewerGroup, viewerIdx]);

  const consumeBlockedTap = () => {
    const blocked = blockTapRef.current;
    blockTapRef.current = false;
    return blocked;
  };

  const goNext = () => {
    if (consumeBlockedTap()) return;
    goNextRaw();
  };

  const goPrev = () => {
    if (consumeBlockedTap()) return;
    goPrevRaw();
  };

  useEffect(() => {
    if (!currentStatus) return;
    setProgress(0);
    setIsPaused(false);
    setMediaError(false);
    setMediaReady(currentStatus.mediaType === 'text');
  }, [currentStatus?.id]);

  // Pause timer when reply input is focused or has text
  const isReplyActive = replyText.length > 0;

  useEffect(() => {
    if (!currentStatus || currentStatus.mediaType === 'video' || !mediaReady || mediaError || isPaused || isReplyActive) return;
    const timer = window.setInterval(() => {
      setProgress((prev) => Math.min(prev + 1, 100));
    }, STORY_DURATION_MS / 100);
    return () => window.clearInterval(timer);
  }, [currentStatus?.id, mediaError, mediaReady, isPaused, currentStatus?.mediaType, isReplyActive]);

  useEffect(() => {
    if (progress < 100) return;
    setProgress(0);
    goNextRaw();
  }, [goNextRaw, progress]);

  const handleHoldStart = () => {
    if (!currentStatus) return;
    holdStartedAtRef.current = Date.now();
    blockTapRef.current = false;
    setIsPaused(true);
    if (currentStatus.mediaType === 'video') {
      videoRef.current?.pause();
    }
  };

  const handleHoldEnd = () => {
    if (!currentStatus) return;
    const startedAt = holdStartedAtRef.current;
    const heldLongEnough = startedAt ? Date.now() - startedAt >= HOLD_THRESHOLD_MS : false;
    blockTapRef.current = heldLongEnough;
    holdStartedAtRef.current = null;
    setIsPaused(false);
    if (currentStatus.mediaType === 'video' && mediaReady && !mediaError) {
      videoRef.current?.play().catch(() => undefined);
    }
  };

  const openViewer = (group: StatusGroup) => {
    setViewerGroup(group);
    setViewerIdx(0);
    setReplyText('');
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !viewerGroup || !currentStatus || sendingReply) return;
    setSendingReply(true);
    try {
      await api.replyToStatus(viewerGroup.senderJid, currentStatus.id, replyText.trim());
      toast.success('Reply sent');
      setReplyText('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const handleDownload = async (e: React.MouseEvent, mediaPath: string, mediaType: string) => {
    e.stopPropagation();
    try {
      const url = api.getStatusMediaUrl(mediaPath);
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `status-${Date.now()}.${mediaType === 'image' ? 'jpg' : 'mp4'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success('Saved to device');
    } catch {
      toast.error('Download failed');
    }
  };

  if (viewerGroup && currentStatus) {
    const variant = getStatusVariant(viewerGroup.senderJid);

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-foreground text-background">
        <div className="flex gap-1 px-2 pt-2">
          {viewerGroup.statuses.map((_, i) => {
            const width = i < viewerIdx ? '100%' : i === viewerIdx ? `${progress}%` : '0%';
            return (
              <div key={i} className="flex-1 h-0.5 overflow-hidden rounded-full bg-background/30">
                <div className="h-full bg-background transition-[width] duration-75" style={{ width }} />
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={closeViewer} className="text-background" aria-label="Close status viewer">
            <X className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {getDisplayName({ name: viewerGroup.senderName, phone: viewerGroup.senderPhone, jid: viewerGroup.senderJid })}
            </p>
            <p className="text-xs text-background/70">
              {formatDistanceToNow(new Date(currentStatus.timestamp), { addSuffix: true })}
            </p>
          </div>
          {currentStatus.mediaPath && (currentStatus.mediaType === 'image' || currentStatus.mediaType === 'video') && (
            <button
              onClick={(e) => handleDownload(e, currentStatus.mediaPath!, currentStatus.mediaType)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-background/20 text-background hover:bg-background/30 transition-colors"
              title="Save to device"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          <span className="text-xs text-background/70">{viewerIdx + 1}/{viewerGroup.statuses.length}</span>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <button
            type="button"
            className="absolute left-0 top-0 z-20 h-full w-1/3"
            onPointerDown={handleHoldStart}
            onPointerUp={handleHoldEnd}
            onPointerCancel={handleHoldEnd}
            onPointerLeave={handleHoldEnd}
            onClick={goPrev}
            aria-label="Previous status"
          />
          <div
            className="absolute left-1/3 top-0 z-20 h-full w-1/3"
            onPointerDown={handleHoldStart}
            onPointerUp={handleHoldEnd}
            onPointerCancel={handleHoldEnd}
            onPointerLeave={handleHoldEnd}
          />
          <button
            type="button"
            className="absolute right-0 top-0 z-20 h-full w-1/3"
            onPointerDown={handleHoldStart}
            onPointerUp={handleHoldEnd}
            onPointerCancel={handleHoldEnd}
            onPointerLeave={handleHoldEnd}
            onClick={goNext}
            aria-label="Next status"
          />

          {currentStatus.mediaType === 'text' && (
            <div className={`flex h-full w-full items-center justify-center p-8 ${variant.container}`}>
              <p className={`max-w-lg text-center text-xl font-medium leading-relaxed md:text-2xl ${variant.text}`}>
                {currentStatus.content || 'Status update'}
              </p>
            </div>
          )}

          {currentStatus.mediaType === 'image' && currentStatus.mediaPath && (
            <div className="relative flex h-full w-full items-center justify-center">
              {!mediaReady && !mediaError && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-foreground/70 text-background">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <p className="text-sm text-background/80">Loading status…</p>
                </div>
              )}
              {mediaError ? (
                <div className="flex flex-col items-center gap-2 text-center text-background/80">
                  <p className="text-sm">This status couldn't load.</p>
                  <button className="rounded-md border border-background/30 px-3 py-1 text-sm" onClick={() => { setMediaError(false); setMediaReady(false); }}>
                    Retry
                  </button>
                </div>
              ) : (
                <img
                  key={currentStatus.id}
                  src={api.getStatusMediaUrl(currentStatus.mediaPath)}
                  alt="WhatsApp status"
                  className="max-h-full max-w-full object-contain"
                  onLoad={() => setMediaReady(true)}
                  onError={() => setMediaError(true)}
                />
              )}
              {currentStatus.content && !mediaError && (
                <div className="absolute bottom-16 left-0 right-0 bg-foreground/60 px-6 py-3">
                  <p className="text-center text-sm text-background">{currentStatus.content}</p>
                </div>
              )}
            </div>
          )}

          {currentStatus.mediaType === 'video' && currentStatus.mediaPath && (
            <div className="relative flex h-full w-full items-center justify-center">
              {!mediaReady && !mediaError && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-foreground/70 text-background">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <p className="text-sm text-background/80">Loading status…</p>
                </div>
              )}
              {mediaError ? (
                <div className="flex flex-col items-center gap-2 text-center text-background/80">
                  <p className="text-sm">This status couldn't load.</p>
                  <button className="rounded-md border border-background/30 px-3 py-1 text-sm" onClick={() => { setMediaError(false); setMediaReady(false); }}>
                    Retry
                  </button>
                </div>
              ) : (
                <video
                  key={currentStatus.id}
                  ref={videoRef}
                  src={api.getStatusMediaUrl(currentStatus.mediaPath)}
                  controls
                  autoPlay
                  className="max-h-full max-w-full"
                  onLoadedData={() => setMediaReady(true)}
                  onError={() => setMediaError(true)}
                  onEnded={goNextRaw}
                />
              )}
              {currentStatus.content && !mediaError && (
                <div className="absolute bottom-16 left-0 right-0 bg-foreground/60 px-6 py-3">
                  <p className="text-center text-sm text-background">{currentStatus.content}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reply bar */}
        <div className="flex items-center gap-2 px-4 py-3 bg-foreground/90 border-t border-background/10">
          <input
            ref={replyInputRef}
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
            onFocus={() => setIsPaused(true)}
            onBlur={() => { if (!replyText) setIsPaused(false); }}
            placeholder="Reply to status..."
            className="flex-1 rounded-full bg-background/20 px-4 py-2.5 text-sm text-background placeholder:text-background/50 focus:outline-none focus:bg-background/30"
          />
          <button
            onClick={handleSendReply}
            disabled={!replyText.trim() || sendingReply}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Status</h1>
        <button
          onClick={fetchStatuses}
          disabled={loading}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent"
          aria-label="Refresh statuses"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {groups.length === 0 && !loading && (
        <div className="py-16 text-center text-muted-foreground">
          <Eye className="mx-auto mb-3 h-12 w-12 opacity-40" />
          <p className="text-sm">No status updates yet</p>
          <p className="mt-1 text-xs">Status updates from your contacts will appear here</p>
        </div>
      )}

      <div className="space-y-1">
        {groups.map((group) => {
          const lastStatus = group.statuses[group.statuses.length - 1];
          const count = group.statuses.length;
          const displayName = getDisplayName({ name: group.senderName, phone: group.senderPhone, jid: group.senderJid });

          return (
            <button
              key={group.senderJid}
              onClick={() => openViewer(group)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/50"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary bg-muted">
                <span className="text-sm font-medium text-muted-foreground">{(displayName || '?')[0].toUpperCase()}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {count} update{count > 1 ? 's' : ''} · {formatDistanceToNow(new Date(lastStatus.timestamp), { addSuffix: true })}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StatusPage;
