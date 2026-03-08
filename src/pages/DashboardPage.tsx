import { motion } from 'framer-motion';
import StatusBadge from '@/components/StatusBadge';
import { Activity, MessageSquare, Mic, Users, Wifi, WifiOff } from 'lucide-react';

const stats = [
  { label: 'Messages Sent', value: '1,247', icon: MessageSquare, change: '+12%' },
  { label: 'Voice Notes', value: '89', icon: Mic, change: '+5%' },
  { label: 'Active Contacts', value: '34', icon: Users, change: '+2' },
  { label: 'Uptime', value: '99.8%', icon: Activity, change: '' },
];

const DashboardPage = () => {
  const isConnected = false; // Mock state

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">WhatsApp Bot Control Panel</p>
        </div>
        <StatusBadge connected={isConnected} />
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
              <div className="w-12 h-12 rounded-xl bg-destructive/15 flex items-center justify-center">
                <WifiOff className="w-6 h-6 text-destructive" />
              </div>
            )}
            <div>
              <h3 className="font-semibold text-foreground">WhatsApp Session</h3>
              <p className="text-sm text-muted-foreground">
                {isConnected ? 'Session active and running' : 'Scan QR code to connect'}
              </p>
            </div>
          </div>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>
        </div>

        {!isConnected && (
          <div className="mt-6 flex justify-center">
            <div className="w-48 h-48 rounded-xl bg-secondary border border-border flex items-center justify-center">
              <p className="text-xs text-muted-foreground text-center px-4">
                QR Code will appear here when backend is connected
              </p>
            </div>
          </div>
        )}
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <stat.icon className="w-5 h-5 text-muted-foreground" />
              {stat.change && (
                <span className="text-xs text-primary font-medium">{stat.change}</span>
              )}
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
