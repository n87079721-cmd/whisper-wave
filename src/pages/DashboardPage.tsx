import { motion } from 'framer-motion';
import { Activity, MessageSquare, Mic, Users, Wifi, WifiOff, Loader2, AlertTriangle, Settings } from 'lucide-react';
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus';
import StatusBadge from '@/components/StatusBadge';
import { api, isBackendConfigured } from '@/lib/api';
import { Link } from 'react-router-dom';

const DashboardPage = () => {
  const backendReady = isBackendConfigured();
  const { status, qr, stats } = useWhatsAppStatus();

  const isConnected = status === 'connected';
  const isWaiting = status === 'qr_waiting';
  const isReconnecting = status === 'reconnecting';

  const statCards = [
    { label: 'Messages Sent', value: stats.messagesSent.toLocaleString(), icon: MessageSquare },
    { label: 'Voice Notes', value: stats.voiceSent.toString(), icon: Mic },
    { label: 'Active Contacts', value: stats.activeContacts.toString(), icon: Users },
    { label: 'Received', value: stats.messagesReceived.toLocaleString(), icon: Activity },
  ];

  const handleConnect = async () => {
    try { await api.reconnect(); } catch (err) { console.error('Reconnect error:', err); }
  };

  const handleDisconnect = async () => {
    try { await api.clearSession(); } catch (err) { console.error('Disconnect error:', err); }
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
          <Link
            to="/settings"
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </Link>
        </motion.div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">WhatsApp Bot Control Panel</p>
        </div>
        <StatusBadge
          connected={isConnected}
          label={isWaiting ? 'QR Waiting' : isReconnecting ? 'Reconnecting' : undefined}
        />
      </div>

      {/* Connection Card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg bg-card border border-border p-5"
      >
        <div className="flex items-center justify-between">
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
                  ? 'Scan QR code with WhatsApp → Linked Devices'
                  : isReconnecting
                  ? 'Restoring session...'
                  : 'Click Connect to generate QR code'}
              </p>
            </div>
          </div>
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={isReconnecting}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {isConnected ? 'Disconnect' : isReconnecting ? 'Reconnecting...' : 'Connect'}
          </button>
        </div>

        {!isConnected && !isReconnecting && (
          <div className="mt-5 flex justify-center">
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
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-lg bg-card border border-border p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
