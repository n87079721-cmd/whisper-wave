import { motion } from 'framer-motion';
import { Activity, MessageSquare, Mic, Users, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus';
import StatusBadge from '@/components/StatusBadge';
import { api } from '@/lib/api';

const DashboardPage = () => {
  const { status, qr, stats } = useWhatsAppStatus();

  const isConnected = status === 'connected';
  const isWaiting = status === 'qr_waiting';
  const isReconnecting = status === 'reconnecting';

  const statCards = [
    { label: 'Messages Sent', value: stats.messagesSent.toLocaleString(), icon: MessageSquare, change: '' },
    { label: 'Voice Notes Sent', value: stats.voiceSent.toString(), icon: Mic, change: '' },
    { label: 'Active Contacts', value: stats.activeContacts.toString(), icon: Users, change: '' },
    { label: 'Messages Received', value: stats.messagesReceived.toLocaleString(), icon: Activity, change: '' },
  ];

  const handleConnect = async () => {
    try {
      await api.reconnect();
    } catch (err) {
      console.error('Reconnect error:', err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.clearSession();
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">WhatsApp Bot Control Panel</p>
        </div>
        <StatusBadge
          connected={isConnected}
          label={isWaiting ? 'QR Waiting' : isReconnecting ? 'Reconnecting' : undefined}
        />
      </div>

      {/* Connection Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-xl p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {isConnected ? (
              <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
                <Wifi className="w-6 h-6 text-primary" />
              </div>
            ) : (
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isWaiting ? 'bg-warning/15' : 'bg-destructive/15'}`}>
                {isWaiting ? (
                  <Loader2 className="w-6 h-6 text-warning animate-spin" />
                ) : (
                  <WifiOff className="w-6 h-6 text-destructive" />
                )}
              </div>
            )}
            <div>
              <h3 className="font-semibold text-foreground">WhatsApp Session</h3>
              <p className="text-sm text-muted-foreground">
                {isConnected
                  ? 'Session active and running'
                  : isWaiting
                  ? 'Scan QR code with WhatsApp → Linked Devices'
                  : 'Click Connect to generate QR code'}
              </p>
            </div>
          </div>
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>

        {!isConnected && (
          <div className="mt-6 flex justify-center">
            {qr ? (
              <div className="rounded-xl overflow-hidden bg-white p-2">
                <img src={qr} alt="WhatsApp QR Code" className="w-48 h-48" />
              </div>
            ) : (
              <div className="w-48 h-48 rounded-xl bg-secondary border border-border flex items-center justify-center">
                <p className="text-xs text-muted-foreground text-center px-4">
                  {isWaiting ? 'Loading QR code...' : 'Click Connect to generate QR code'}
                </p>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <stat.icon className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
