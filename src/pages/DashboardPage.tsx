import { useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, MessageSquare, Mic, Users, Wifi, WifiOff, Loader2, AlertTriangle, Settings, QrCode, Phone, ArrowRight, RefreshCw } from 'lucide-react';
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus';
import StatusBadge from '@/components/StatusBadge';
import SyncBanner from '@/components/SyncBanner';
import { api, isBackendConfigured } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface DashboardPageProps {
  onNavigateSettings?: () => void;
  onNavigateConversations?: () => void;
}

const DashboardPage = ({ onNavigateSettings, onNavigateConversations }: DashboardPageProps) => {
  const backendReady = isBackendConfigured();
  const { status, qr, stats, syncState, refresh } = useWhatsAppStatus();
  const [connecting, setConnecting] = useState(false);
  const [pairingMode, setPairingMode] = useState<'qr' | 'phone'>('qr');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);

  const isConnected = status === 'connected';
  const isWaiting = status === 'qr_waiting';
  const isReconnecting = status === 'reconnecting';
  const needsAttention = syncState.phase === 'partial' || syncState.unresolvedLids > 0;
  const syncSummary = isConnected
    ? syncState.phase === 'ready' && syncState.unresolvedLids === 0
      ? 'Linked and fully usable.'
      : syncState.phase === 'partial'
        ? 'Linked, but WhatsApp did not finish bringing older history over.'
        : syncState.phase === 'importing' || syncState.phase === 'waiting_history'
          ? 'Connection is live while chats and names continue importing.'
          : 'Linked device is still resolving contact identities.'
    : isWaiting
      ? 'Waiting for QR scan or pairing-code confirmation.'
      : isReconnecting
        ? 'Trying to restore the device session safely.'
        : 'Not connected to a WhatsApp device yet.';

  const statCards = [
    { label: 'Messages Sent', value: stats.messagesSent.toLocaleString(), icon: MessageSquare, caption: 'Outgoing text activity' },
    { label: 'Voice Notes', value: stats.voiceSent.toString(), icon: Mic, caption: 'Generated and delivered' },
    { label: 'Active Contacts', value: stats.activeContacts.toString(), icon: Users, caption: 'Contacts with history' },
    { label: 'Received', value: stats.messagesReceived.toLocaleString(), icon: Activity, caption: 'Inbound message volume' },
  ];

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await api.reconnect();
      toast.success('Connecting to WhatsApp...');
      refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try { await api.clearSession(); } catch (err) { console.error('Disconnect error:', err); }
  };

  const handleRequestPairingCode = async () => {
    if (!phoneNumber.trim()) {
      toast.error('Enter your phone number with country code');
      return;
    }
    setRequestingCode(true);
    setPairingCode(null);
    try {
      // First ensure we have an active socket waiting for QR
      if (status === 'disconnected') {
        await api.reconnect();
        // Give it a moment to initialize
        await new Promise(r => setTimeout(r, 2000));
      }
      const result = await api.pairPhone(phoneNumber.trim());
      setPairingCode(result.code);
      toast.success('Pairing code generated! Enter it on your phone.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate pairing code');
    } finally {
      setRequestingCode(false);
    }
  };

  return (
    <div className="space-y-5 wa-pattern min-h-full">
      {/* Backend not configured banner */}
      {!backendReady && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg bg-warning/10 border border-warning/30 p-4 flex items-center gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Backend not configured</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Deploy the backend on your VPS, then set the URL in Settings to connect.
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateSettings}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </motion.div>
      )}

      <section className="rounded-2xl border border-border bg-card/95 p-5 md:p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Operations dashboard</p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Professional control over connection, sync, and message flow.</h1>
              </div>
              <p className="max-w-xl text-sm text-muted-foreground">
                {syncSummary}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                connected={isConnected}
                label={isWaiting ? 'QR Waiting' : isReconnecting ? 'Reconnecting' : undefined}
                syncPhase={isConnected ? syncState.phase : undefined}
              />
              <button
                type="button"
                onClick={() => onNavigateConversations?.()}
                className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
              >
                Open chats
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigateSettings?.()}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/50"
              >
                {needsAttention ? <RefreshCw className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
                {needsAttention ? 'Recovery tools' : 'Settings'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:w-[25rem]">
            <div className="rounded-xl border border-border bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sync health</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{syncState.totalDbMessages.toLocaleString()}</p>
              <p className="mt-1 text-sm text-muted-foreground">Messages currently available in the local dashboard.</p>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Contacts ready</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{syncState.totalDbContacts.toLocaleString()}</p>
              <p className="mt-1 text-sm text-muted-foreground">Contacts visible for search, new chats, and replies.</p>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-4 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">What this app can and cannot do</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Live messaging works once linked. Old chats only appear if the linked WhatsApp device actually finishes history sync.
                  </p>
                </div>
                <div className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                  {syncState.phase === 'partial' ? 'Needs re-sync' : syncState.phase === 'ready' ? 'Stable' : 'Live'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Connection Card */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-card border border-border p-5"
        >
          <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {isConnected ? (
              <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                <Wifi className="w-5 h-5 text-primary" />
              </div>
            ) : (
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isWaiting || isReconnecting ? 'bg-warning/15' : 'bg-destructive/15'}`}>
                {isWaiting || isReconnecting ? (
                  <Loader2 className="w-5 h-5 text-warning animate-spin" />
                ) : (
                  <WifiOff className="w-5 h-5 text-destructive" />
                )}
              </div>
            )}
            <div>
              <h3 className="font-medium text-foreground text-sm">WhatsApp Session</h3>
              <p className="text-xs text-muted-foreground">
                {isConnected
                  ? 'Session active and running'
                  : isWaiting
                  ? pairingMode === 'qr' ? 'Scan QR code with WhatsApp → Linked Devices' : 'Enter the code on your phone'
                  : isReconnecting
                  ? 'Restoring session...'
                  : 'Choose a method to connect'}
              </p>
            </div>
          </div>
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={isReconnecting || connecting}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            {connecting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Connecting...
              </>
            ) : isConnected ? 'Disconnect' : isReconnecting ? 'Reconnecting...' : 'Connect'}
          </button>
        </div>

        {!isConnected && !isReconnecting && (
          <div className="mt-5">
            {/* Mode toggle */}
            <div className="flex items-center justify-center gap-1 mb-4 bg-secondary rounded-lg p-1 max-w-xs mx-auto">
              <button
                onClick={() => { setPairingMode('qr'); setPairingCode(null); }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  pairingMode === 'qr' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                QR Code
              </button>
              <button
                onClick={() => setPairingMode('phone')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  pairingMode === 'phone' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Phone className="w-3.5 h-3.5" />
                Phone Number
              </button>
            </div>

            {/* QR Mode */}
            {pairingMode === 'qr' && (
              <div className="flex justify-center">
                {qr ? (
                  <div className="rounded-lg overflow-hidden bg-white p-2">
                    <img src={qr} alt="WhatsApp QR Code" className="w-48 h-48" />
                  </div>
                ) : (
                  <div className="w-48 h-48 rounded-lg bg-secondary border border-border flex items-center justify-center">
                    <p className="text-xs text-muted-foreground text-center px-4">
                      {isWaiting ? 'Loading QR code...' : 'Click Connect to generate QR code'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Phone Number Mode */}
            {pairingMode === 'phone' && (
              <div className="max-w-xs mx-auto space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Phone number with country code</label>
                  <Input
                    placeholder="e.g. +1 705 202 4615"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <button
                  onClick={handleRequestPairingCode}
                  disabled={requestingCode || !phoneNumber.trim()}
                  className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {requestingCode ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Get Pairing Code'
                  )}
                </button>

                {pairingCode && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-lg bg-primary/10 border border-primary/30 p-4 text-center"
                  >
                    <p className="text-xs text-muted-foreground mb-2">Enter this code on your phone</p>
                    <p className="text-2xl font-mono font-bold tracking-[0.3em] text-foreground">{pairingCode}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      WhatsApp → Settings → Linked Devices → Link with phone number
                    </p>
                  </motion.div>
                )}
              </div>
            )}
          </div>
        )}
        </motion.div>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">System status</h2>
              <p className="mt-1 text-xs text-muted-foreground">A cleaner read on what is healthy versus what still needs work.</p>
            </div>
            <Activity className="h-5 w-5 text-primary" />
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-border bg-background/70 p-4">
              <p className="text-xs text-muted-foreground">Transport</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {isConnected ? 'Connected to linked device' : isWaiting ? 'Awaiting pairing' : isReconnecting ? 'Trying to recover session' : 'Disconnected'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-4">
              <p className="text-xs text-muted-foreground">History import</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {syncState.phase === 'ready' ? 'Imported and resolved' : syncState.phase === 'partial' ? 'Partial — older chats may be missing' : syncState.phase === 'importing' ? 'Importing now' : syncState.phase === 'waiting_history' ? 'Waiting for WhatsApp history' : 'Idle'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-4">
              <p className="text-xs text-muted-foreground">Unresolved identities</p>
              <p className="mt-1 text-sm font-medium text-foreground">{syncState.unresolvedLids} still waiting for real phone-number mapping.</p>
            </div>
          </div>
        </section>
      </div>

      {/* Sync Status */}
      <SyncBanner syncState={syncState} isConnected={isConnected} onResync={onNavigateSettings} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-2xl bg-card border border-border p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
                <stat.icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                <p className="text-[11px] text-muted-foreground/80">{stat.caption}</p>
              </div>
            </div>
            <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
