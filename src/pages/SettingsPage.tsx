import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Shield, Power, Loader2, Brain, LogOut, Save, Clock, Dice5, Gauge, RefreshCw, Globe, MessageSquare, AlertTriangle, Database, RotateCcw } from 'lucide-react';
import { api, type SyncDiagnostics } from '@/lib/api';
import { toast } from 'sonner';
import { Slider } from '@/components/ui/slider';
import { useWhatsAppStatus, type SyncState } from '@/hooks/useWhatsAppStatus';

const SettingsPage = () => {
  const { status: waStatus, syncState } = useWhatsAppStatus();
  const isConnected = waStatus === 'connected';
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [keyExists, setKeyExists] = useState(false);
  const [openaiKeyExists, setOpenaiKeyExists] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Availability settings
  const [activeHoursStart, setActiveHoursStart] = useState('10:00');
  const [activeHoursEnd, setActiveHoursEnd] = useState('23:00');
  const [replyChance, setReplyChance] = useState(70);
  const [responseSpeed, setResponseSpeed] = useState('normal');
  const [timezone, setTimezone] = useState('America/New_York');

  useEffect(() => {
    api.getConfig('elevenlabs_api_key').then(data => {
      if (data.exists) { setKeyExists(true); setElevenLabsKey(''); }
    }).catch(() => {});
    api.getConfig('openai_api_key').then(data => {
      if (data.exists) { setOpenaiKeyExists(true); setOpenaiKey(''); }
    }).catch(() => {});
    api.getConfig('automation_enabled').then(data => {
      setAutoEnabled(data.value === 'true');
    }).catch(() => {});
    api.getConfig('ai_system_prompt').then(data => {
      if (data.exists) setSystemPrompt(data.value || '');
    }).catch(() => {});
    api.getConfig('ai_active_hours_start').then(data => {
      if (data.exists) setActiveHoursStart(data.value || '10:00');
    }).catch(() => {});
    api.getConfig('ai_active_hours_end').then(data => {
      if (data.exists) setActiveHoursEnd(data.value || '23:00');
    }).catch(() => {});
    api.getConfig('ai_reply_chance').then(data => {
      if (data.exists) setReplyChance(parseInt(data.value || '70', 10));
    }).catch(() => {});
    api.getConfig('ai_response_speed').then(data => {
      if (data.exists) setResponseSpeed(data.value || 'normal');
    }).catch(() => {});
    api.getConfig('ai_timezone').then(data => {
      if (data.exists) setTimezone(data.value || 'America/New_York');
    }).catch(() => {});
  }, []);

  const handleSaveKey = async () => {
    if (!elevenLabsKey) return;
    setSaving(true);
    try {
      await api.setConfig('elevenlabs_api_key', elevenLabsKey);
      setKeyExists(true);
      setElevenLabsKey('');
      toast.success('API key saved');
    } catch { toast.error('Failed to save key'); }
    finally { setSaving(false); }
  };

  const handleSaveOpenaiKey = async () => {
    if (!openaiKey) return;
    setSavingOpenai(true);
    try {
      await api.setConfig('openai_api_key', openaiKey);
      setOpenaiKeyExists(true);
      setOpenaiKey('');
      toast.success('OpenAI API key saved');
    } catch { toast.error('Failed to save key'); }
    finally { setSavingOpenai(false); }
  };

  const handleLogout = async () => {
    if (!confirm('This will disconnect your WhatsApp account. You will need to scan the QR code again to reconnect. Continue?')) return;
    setLoggingOut(true);
    try {
      await api.clearSession();
      toast.success('WhatsApp logged out successfully');
    } catch { toast.error('Failed to logout'); }
    finally { setLoggingOut(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.triggerSync();
      toast.success('Recovery sync started — fetching missing chats & contacts');
    } catch { toast.error('Failed to start sync'); }
    finally { setSyncing(false); }
  };

  const handleLoadDiagnostics = async () => {
    setLoadingDiagnostics(true);
    try {
      const data = await api.getSyncDiagnostics();
      setDiagnostics(data);
    } catch { toast.error('Failed to load diagnostics'); }
    finally { setLoadingDiagnostics(false); }
  };

  const handleFullReset = async () => {
    if (!confirm('⚠️ This will WIPE all messages, contacts, and your WhatsApp session. You will need to scan QR again to get a fresh full history sync. This cannot be undone. Continue?')) return;
    setResetting(true);
    try {
      await api.fullReset();
      toast.success('Full reset complete — scan QR to re-pair');
    } catch { toast.error('Failed to reset'); }
    finally { setResetting(false); }
  };

  const handleToggleAuto = async () => {
    const newVal = !autoEnabled;
    setAutoEnabled(newVal);
    await api.setConfig('automation_enabled', String(newVal));
  };

  const saveAvailabilitySetting = async (key: string, value: string) => {
    try { await api.setConfig(key, value); }
    catch { toast.error('Failed to save setting'); }
  };

  return (
    <div className="space-y-4 md:space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage API keys and bot configuration</p>
      </div>

      {/* Sync */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center"><RefreshCw className="w-5 h-5 text-primary" /></div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Recovery Sync</h3>
              <p className="text-xs text-muted-foreground">Fetch missing chats & contacts from WhatsApp</p>
            </div>
          </div>
          <button onClick={handleSync} disabled={syncing || !isConnected}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? 'Recovering...' : 'Recover Chats'}
          </button>
        </div>

        {/* Live sync stats */}
        {isConnected && (
          <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Sync Status</span>
              <span className={`text-xs font-medium ${
                syncState.phase === 'ready' ? 'text-primary' :
                syncState.phase === 'partial' ? 'text-warning' :
                syncState.phase === 'importing' ? 'text-primary' : 'text-muted-foreground'
              }`}>
                {syncState.phase === 'ready' ? '✓ Complete' :
                 syncState.phase === 'partial' ? '⚠ Partial' :
                 syncState.phase === 'importing' ? '⏳ Importing…' :
                 syncState.phase === 'recovering' ? '🔄 Recovering…' :
                 syncState.phase === 'waiting_history' ? '⏳ Waiting…' : '—'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Contacts: <span className="text-foreground font-medium">{syncState.totalDbContacts}</span></span>
              <span>Messages: <span className="text-foreground font-medium">{syncState.totalDbMessages}</span></span>
              <span>History chats: <span className="text-foreground font-medium">{syncState.historyChats}</span></span>
              <span>Unresolved: <span className={`font-medium ${syncState.unresolvedLids > 0 ? 'text-warning' : 'text-foreground'}`}>{syncState.unresolvedLids}</span></span>
            </div>
          </div>
        )}
      </motion.div>

      {/* ElevenLabs API Key — input only, no reveal */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center"><Key className="w-5 h-5 text-primary" /></div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">ElevenLabs API Key</h3>
            <p className="text-xs text-muted-foreground">Required for voice note generation. {keyExists && <span className="text-primary">✓ Key saved</span>}</p>
          </div>
        </div>
        <input type="password" value={elevenLabsKey} onChange={(e) => setElevenLabsKey(e.target.value)}
          placeholder={keyExists ? '••••••••••••••••' : 'sk_xxxxxxxxxxxxxxxxxxxxxxxx'}
          className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
        <button onClick={handleSaveKey} disabled={!elevenLabsKey || saving}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40">
          {saving ? 'Saving...' : 'Save Key'}
        </button>
      </motion.div>

      {/* OpenAI API Key — input only, no reveal */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center"><Brain className="w-5 h-5 text-primary" /></div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">OpenAI API Key</h3>
            <p className="text-xs text-muted-foreground">Required for AI auto-reply & enhance. {openaiKeyExists && <span className="text-primary">✓ Key saved</span>}</p>
          </div>
        </div>
        <input type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)}
          placeholder={openaiKeyExists ? '••••••••••••••••' : 'sk-xxxxxxxxxxxxxxxxxxxxxxxx'}
          className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
        <button onClick={handleSaveOpenaiKey} disabled={!openaiKey || savingOpenai}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40">
          {savingOpenai ? 'Saving...' : 'Save Key'}
        </button>
      </motion.div>

      {/* Sync Diagnostics */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center"><Database className="w-5 h-5 text-accent-foreground" /></div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Sync Diagnostics</h3>
              <p className="text-xs text-muted-foreground">See what's missing and why contacts aren't loading</p>
            </div>
          </div>
          <button onClick={handleLoadDiagnostics} disabled={loadingDiagnostics}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-40">
            {loadingDiagnostics ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {loadingDiagnostics ? 'Loading...' : 'Run Diagnostics'}
          </button>
        </div>

        {diagnostics && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Contacts', value: diagnostics.totalContacts, warn: false },
                { label: 'Total Messages', value: diagnostics.totalMessages, warn: false },
                { label: 'Unnamed Contacts', value: diagnostics.unnamedContacts, warn: diagnostics.unnamedContacts > 0 },
                { label: 'Empty Chats (0 msgs)', value: diagnostics.emptyChats, warn: diagnostics.emptyChats > 5 },
                { label: 'Unresolved LIDs', value: diagnostics.unresolvedLids, warn: diagnostics.unresolvedLids > 0 },
                { label: 'Store Contacts', value: diagnostics.storeContactCount, warn: false },
                { label: 'LID Map Size', value: diagnostics.lidMapSize, warn: false },
              ].map(item => (
                <div key={item.label} className={`p-2 rounded-lg border ${item.warn ? 'border-warning/30 bg-warning/5' : 'border-border bg-muted/30'}`}>
                  <div className="text-[10px] text-muted-foreground">{item.label}</div>
                  <div className={`text-sm font-bold ${item.warn ? 'text-warning' : 'text-foreground'}`}>{item.value}</div>
                </div>
              ))}
            </div>

            {diagnostics.topUnnamed.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Top unnamed contacts
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {diagnostics.topUnnamed.map(c => (
                    <div key={c.id} className="text-xs text-muted-foreground p-1.5 rounded bg-muted/30 flex justify-between">
                      <span className="truncate">{c.phone || c.jid}</span>
                      <span className="text-[10px] opacity-60">{c.name || '(no name)'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* WhatsApp Logout */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-destructive/15 flex items-center justify-center"><LogOut className="w-5 h-5 text-destructive" /></div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">WhatsApp Logout</h3>
              <p className="text-xs text-muted-foreground">Disconnect and remove your WhatsApp session</p>
            </div>
          </div>
          <button onClick={handleLogout} disabled={loggingOut}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/15 text-destructive text-sm font-medium hover:bg-destructive/25 transition-colors disabled:opacity-40">
            {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            {loggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </motion.div>

      {/* Full Reset & Re-pair */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-destructive/15 flex items-center justify-center"><RotateCcw className="w-5 h-5 text-destructive" /></div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Reset & Re-pair</h3>
              <p className="text-xs text-muted-foreground">Wipe everything and re-scan QR for a full fresh history sync</p>
            </div>
          </div>
          <button onClick={handleFullReset} disabled={resetting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-40">
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {resetting ? 'Resetting...' : 'Full Reset'}
          </button>
        </div>
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-xs text-destructive">
              This wipes all messages, contacts, and session data. Use this if your history sync was permanently partial. After reset, scan QR to get a complete fresh sync from WhatsApp.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Automation Toggle + Settings */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-warning/15 flex items-center justify-center"><Power className="w-5 h-5 text-warning" /></div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">Automation</h3>
              <p className="text-xs text-muted-foreground">Enable automated message handling</p>
            </div>
          </div>
          <button onClick={handleToggleAuto} className={`relative w-12 h-6 rounded-full transition-colors ${autoEnabled ? 'bg-primary' : 'bg-muted'}`}>
            <motion.div animate={{ x: autoEnabled ? 24 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} className="absolute top-1 w-4 h-4 rounded-full bg-foreground" />
          </button>
        </div>
        {autoEnabled && (
          <AnimatePresence>
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4 space-y-5">
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-warning">
                    Automation is ON. The bot will auto-reply with human-like timing — random delays, emoji reactions, and selective responses.
                  </p>
                </div>
              </div>

              {/* Active Hours */}
              <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <label className="text-sm font-medium text-foreground">Active Hours</label>
                </div>
                <p className="text-xs text-muted-foreground">Only reply during these hours. Outside = silent.</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">From</label>
                    <input type="time" value={activeHoursStart}
                      onChange={(e) => { setActiveHoursStart(e.target.value); saveAvailabilitySetting('ai_active_hours_start', e.target.value); }}
                      className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  </div>
                  <span className="text-muted-foreground mt-5">→</span>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">To</label>
                    <input type="time" value={activeHoursEnd}
                      onChange={(e) => { setActiveHoursEnd(e.target.value); saveAvailabilitySetting('ai_active_hours_end', e.target.value); }}
                      className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  </div>
                </div>
              </div>

              {/* Timezone */}
              <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" />
                  <label className="text-sm font-medium text-foreground">Timezone</label>
                </div>
                <p className="text-xs text-muted-foreground">Set your timezone so active hours work correctly (especially if your VPS is in a different region).</p>
                <select value={timezone}
                  onChange={(e) => { setTimezone(e.target.value); saveAvailabilitySetting('ai_timezone', e.target.value); }}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50">
                  <option value="Africa/Lagos">Africa/Lagos (WAT)</option>
                  <option value="Africa/Johannesburg">Africa/Johannesburg (SAST)</option>
                  <option value="Africa/Nairobi">Africa/Nairobi (EAT)</option>
                  <option value="Africa/Cairo">Africa/Cairo (EET)</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="America/Chicago">America/Chicago (CST)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                  <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                </select>
              </div>

              {/* Reply Chance */}
              <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Dice5 className="w-4 h-4 text-primary" />
                    <label className="text-sm font-medium text-foreground">Reply Chance</label>
                  </div>
                  <span className="text-sm font-bold text-primary">{replyChance}%</span>
                </div>
                <p className="text-xs text-muted-foreground">How often should you reply? Celebrities don't answer everything 😎</p>
                <Slider value={[replyChance]} onValueChange={(val) => setReplyChance(val[0])}
                  onValueCommit={(val) => saveAvailabilitySetting('ai_reply_chance', String(val[0]))}
                  min={10} max={100} step={5} className="w-full" />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Ghost mode 👻</span>
                  <span>Always available 📱</span>
                </div>
              </div>

              {/* Response Speed */}
              <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-primary" />
                  <label className="text-sm font-medium text-foreground">Response Speed</label>
                </div>
                <p className="text-xs text-muted-foreground">How fast should replies come? Slower = more realistic.</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'fast', label: 'Quick', desc: '3–25s', emoji: '⚡' },
                    { id: 'normal', label: 'Normal', desc: '15–60s', emoji: '🕐' },
                    { id: 'slow', label: 'Celebrity', desc: '30–180s', emoji: '👑' },
                  ].map((option) => (
                    <button key={option.id}
                      onClick={() => { setResponseSpeed(option.id); saveAvailabilitySetting('ai_response_speed', option.id); }}
                      className={`p-3 rounded-lg border text-center transition-all ${
                        responseSpeed === option.id
                          ? 'bg-primary/15 border-primary text-primary'
                          : 'bg-secondary border-border text-muted-foreground hover:border-primary/30'
                      }`}>
                      <div className="text-lg mb-1">{option.emoji}</div>
                      <div className="text-xs font-medium">{option.label}</div>
                      <div className="text-[10px] opacity-70">{option.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* System Prompt */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <label className="text-sm font-medium text-foreground">AI System Prompt</label>
                </div>
                <p className="text-xs text-muted-foreground">Leave empty for the default celebrity persona.</p>
                <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Leave empty for default celebrity persona, or customize..."
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
                <button onClick={async () => {
                  setSavingPrompt(true);
                  try { await api.setConfig('ai_system_prompt', systemPrompt); toast.success('System prompt saved'); }
                  catch { toast.error('Failed to save prompt'); }
                  finally { setSavingPrompt(false); }
                }} disabled={savingPrompt}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40">
                  {savingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {savingPrompt ? 'Saving...' : 'Save Prompt'}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
};

export default SettingsPage;
