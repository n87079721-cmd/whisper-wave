import { useState } from 'react';
import { motion } from 'framer-motion';
import { Key, RefreshCw, Shield, Power, Eye, EyeOff } from 'lucide-react';

const SettingsPage = () => {
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage API keys and bot configuration</p>
      </div>

      {/* ElevenLabs API Key */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">ElevenLabs API Key</h3>
            <p className="text-xs text-muted-foreground">Required for voice note generation</p>
          </div>
        </div>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={elevenLabsKey}
            onChange={(e) => setElevenLabsKey(e.target.value)}
            placeholder="sk_xxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full px-4 py-2.5 pr-10 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          Save Key
        </button>
      </motion.div>

      {/* Session Management */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-info/15 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-info" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">WhatsApp Session</h3>
            <p className="text-xs text-muted-foreground">Manage your WhatsApp Web connection</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
            Reconnect Session
          </button>
          <button className="px-4 py-2 rounded-lg bg-destructive/15 text-destructive text-sm hover:bg-destructive/25 transition-colors">
            Clear Session
          </button>
        </div>
      </motion.div>

      {/* Automation Toggle */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass rounded-xl p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-warning/15 flex items-center justify-center">
              <Power className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Automation</h3>
              <p className="text-xs text-muted-foreground">Enable automated message handling</p>
            </div>
          </div>
          <button
            onClick={() => setAutoEnabled(!autoEnabled)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              autoEnabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <motion.div
              animate={{ x: autoEnabled ? 24 : 2 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="absolute top-1 w-4 h-4 rounded-full bg-foreground"
            />
          </button>
        </div>
        {autoEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/20"
          >
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-warning">
                Automation is enabled. The bot will automatically process incoming messages based on your configured rules.
              </p>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

export default SettingsPage;
