import { useState } from 'react';
import { Activity, MessageSquare, Mic, Users, Wifi, WifiOff, Loader2, AlertTriangle, Settings, QrCode, Phone, ArrowRight } from 'lucide-react';
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus';
import StatusBadge from '@/components/StatusBadge';
import AiReplyTuning from '@/components/AiReplyTuning';
import { api, isBackendConfigured } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface DashboardPageProps {
  onNavigateSettings?: () => void;
  onNavigateConversations?: () => void;
}

const DashboardPage = ({ onNavigateSettings, onNavigateConversations }: DashboardPageProps) => {
  const backendReady = isBackendConfigured();
  const { status, qr, pairingCode: livePairingCode, stats, syncState, refresh } = useWhatsAppStatus();
  const [connecting, setConnecting] = useState(false);
  const [pairingMode, setPairingMode] = useState<'qr' | 'phone'>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);

  const isConnected = status === 'connected';
  const isWaiting = status === 'qr_waiting';
  const isReconnecting = status === 'reconnecting';
  const displayPairingCode = pairingCode || livePairingCode || null;

  const statCards = [
    { label: 'Messages Sent', value: stats.messagesSent.toLocaleString(), icon: MessageSquare },
    { label: 'Voice Notes', value: stats.voiceSent.toString(), icon: Mic },
    { label: 'Active Contacts', value: stats.activeContacts.toString(), icon: Users },
    { label: 'Received', value: stats.messagesReceived.toLocaleString(), icon: Activity },
  ];

  const handleConnect = async () => {
    setConnecting(true);
    try { await api.reconnect(); toast.success(isReconnecting ? 'Reconnect forced' : 'Connecting...'); refresh(); }
    catch (err: any) { toast.error(err?.message || 'Failed'); }
    finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    try {
      await api.disconnect();
      setPairingCode(null);
      setPairingError(null);
      toast.success('Disconnected — session saved');
      refresh();
    } catch {}
  };

  const handleRequestPairingCode = async () => {
    if (!phoneNumber.trim()) { toast.error('Enter phone number with country code'); return; }
    setRequestingCode(true);
    setPairingCode(null);
    setPairingError(null);
    try {
      if (status === 'disconnected') { await api.reconnect(); await new Promise(r => setTimeout(r, 2000)); }
      const result = await api.pairPhone(phoneNumber.trim());
      const nextCode = String(result?.code || '').trim();
      if (nextCode) {
        setPairingCode(nextCode);
        toast.success('Pairing code generated!');
      } else {
        await refresh();
        toast.success('Pairing request sent — waiting for code...');
      }
    } catch (err: any) {
      const message = err?.message || 'Phone pairing failed';
      if (message.includes('temporarily unavailable')) {
        setPairingMode('qr');
      }
      setPairingError(message);
      toast.error(message);
    }
    finally { setRequestingCode(false); }
  };

  return (
    <div className="space-y-5">
      {/* Backend warning */}
      {!backendReady && (
        <div className="rounded-xl bg-warning/10 border border-warning/30 p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Backend not configured</p>
            <p className="text-xs text-muted-foreground mt-0.5">Deploy the backend, then set URL in Settings.</p>
          </div>
          <button onClick={onNavigateSettings} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Settings
          </button>
        </div>
      )}

      {/* Connection + Status */}
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-[1fr,1fr]">
        {/* Connection card */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {isConnected ? (
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-primary" />
                </div>
              ) : (
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isWaiting || isReconnecting ? 'bg-warning/15' : 'bg-destructive/15'}`}>
                  {isWaiting || isReconnecting ? <Loader2 className="w-5 h-5 text-warning animate-spin" /> : <WifiOff className="w-5 h-5 text-destructive" />}
                </div>
              )}
              <div>
                <h3 className="font-semibold text-foreground text-sm">WhatsApp Session</h3>
                <p className="text-xs text-muted-foreground">
                  {isConnected ? 'Connected' : isWaiting ? 'Scan QR or enter code' : isReconnecting ? 'Restoring...' : 'Not connected'}
                </p>
              </div>
            </div>
            <button
              onClick={isConnected ? handleDisconnect : handleConnect}
              disabled={connecting}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1.5"
            >
              {connecting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting...</> : isConnected ? 'Disconnect' : isReconnecting ? 'Reconnect now' : 'Connect'}
            </button>
          </div>

          {!isConnected && !isReconnecting && (
            <div className="mt-5">
              <div className="flex items-center justify-center gap-1 mb-4 bg-secondary rounded-lg p-1 max-w-xs mx-auto">
                <button
                  onClick={() => { setPairingMode('qr'); setPairingCode(null); setPairingError(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    pairingMode === 'qr' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                ><QrCode className="w-3.5 h-3.5" /> QR Code</button>
                <button
                  onClick={() => { setPairingMode('phone'); setPairingError(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    pairingMode === 'phone' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                ><Phone className="w-3.5 h-3.5" /> Phone</button>
              </div>

              {pairingMode === 'qr' && (
                <div className="flex justify-center">
                  {qr ? (
                    <div className="rounded-lg overflow-hidden bg-white p-2"><img src={qr} alt="QR" className="w-48 h-48" /></div>
                  ) : (
                    <div className="w-48 h-48 rounded-lg bg-secondary flex items-center justify-center">
                      <p className="text-xs text-muted-foreground text-center px-4">{isWaiting ? 'Loading QR...' : 'Click Connect'}</p>
                    </div>
                  )}
                </div>
              )}

              {pairingMode === 'phone' && (
                <div className="max-w-xs mx-auto space-y-3">
                  {displayPairingCode ? (
                    <div className="rounded-lg bg-accent border-2 border-primary/30 p-5 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <p className="text-xs text-muted-foreground mb-2">Enter this code on your phone</p>
                      <p className="text-3xl font-mono font-bold tracking-[0.35em] text-foreground">{displayPairingCode}</p>
                      <p className="text-xs text-muted-foreground mt-3">WhatsApp → Linked Devices → Link with phone number</p>
                      <button onClick={() => { setPairingCode(null); setPairingError(null); }} className="mt-3 text-xs text-primary hover:text-primary/80 underline">Try again</button>
                    </div>
                  ) : (
                    <>
                      <Input placeholder="e.g. +1 705 202 4615" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="text-sm" />
                      <button onClick={handleRequestPairingCode} disabled={requestingCode || !phoneNumber.trim()}
                        className="w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2">
                        {requestingCode ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</> : 'Get Code'}
                      </button>
                      {pairingError && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                          <p className="text-xs font-medium text-destructive">Phone pairing failed</p>
                          <p className="mt-1 text-xs text-foreground break-words">{pairingError}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status panel */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-foreground">System status</h2>
            <StatusBadge connected={isConnected} label={isWaiting ? 'QR Waiting' : isReconnecting ? 'Reconnecting' : undefined} syncPhase={isConnected ? syncState.phase : undefined} />
          </div>
          <div className="space-y-2.5">
            <div className="rounded-lg bg-secondary/60 p-3">
              <p className="text-xs text-muted-foreground">Transport</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{isConnected ? 'Connected' : isWaiting ? 'Awaiting pairing' : isReconnecting ? 'Recovering' : 'Disconnected'}</p>
            </div>
            <div className="rounded-lg bg-secondary/60 p-3">
              <p className="text-xs text-muted-foreground">History</p>
              <p className="text-sm font-medium text-foreground mt-0.5">
                {syncState.phase === 'ready'
                  ? 'Synced'
                  : syncState.phase === 'partial'
                    ? 'Partial'
                    : syncState.phase === 'importing'
                      ? `Importing... ${syncState.historyMessages} msgs`
                      : syncState.phase === 'recovering'
                        ? 'Recovering...'
                        : syncState.phase === 'waiting_history'
                          ? 'Waiting for history...'
                          : 'Idle'}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/60 p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Contacts / Messages</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{syncState.totalDbContacts} / {syncState.totalDbMessages}</p>
              </div>
              <button onClick={() => onNavigateConversations?.()} className="text-xs text-primary font-medium flex items-center gap-1 hover:text-primary/80">
                Open chats <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-card border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <stat.icon className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* AI Reply Tuning — promoted from Settings */}
      <AiReplyTuning />

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onNavigateConversations?.()} className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 flex items-center gap-2">
          <MessageSquare className="w-4 h-4" /> Open Chats
        </button>
        <button onClick={onNavigateSettings} className="px-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 flex items-center gap-2">
          <Settings className="w-4 h-4" /> Settings
        </button>
      </div>
    </div>
  );
};

export default DashboardPage;
