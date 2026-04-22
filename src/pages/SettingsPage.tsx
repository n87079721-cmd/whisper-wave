import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Shield, Power, Loader2, Brain, LogOut, Save, Dice5, Gauge, RefreshCw, AlertTriangle, Database, Plus, Trash2, Pencil, X, BookOpen, Send, Bot, Sparkles, MessageCircle, Play, Pause } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type SyncDiagnostics, type Prompt } from '@/lib/api';
import { toast } from 'sonner';
import { Slider } from '@/components/ui/slider';
import { useWhatsAppStatus, type SyncState } from '@/hooks/useWhatsAppStatus';

const SPEED_OPTIONS = [
  { id: 'fast', label: 'Quick', desc: '3–10 mins', emoji: '⚡' },
  { id: 'normal', label: 'Normal', desc: '6–15 mins', emoji: '🕐' },
  { id: 'slow', label: 'Celebrity', desc: '30 mins–2 days', emoji: '👑' },
] as const;

const SettingsPage = () => {
  const { status: waStatus, syncState } = useWhatsAppStatus();
  const isConnected = waStatus === 'connected';
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  // System prompt removed — AI only replies for contacts with an assigned persona.
  const [saving, setSaving] = useState(false);
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [keyExists, setKeyExists] = useState(false);
  const [openaiKeyExists, setOpenaiKeyExists] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  // Prompt Library
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [showPromptForm, setShowPromptForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [promptName, setPromptName] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [savingNewPrompt, setSavingNewPrompt] = useState(false);

  // AI Voice Notes
  const [voiceNoteEnabled, setVoiceNoteEnabled] = useState(false);
  const [voiceNoteChance, setVoiceNoteChance] = useState(20);
  const [voiceNoteMaxPerDay, setVoiceNoteMaxPerDay] = useState(3);
  const [availableVoices, setAvailableVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [voiceBgVolume, setVoiceBgVolume] = useState(15);
  const [voiceDefaultBgSound, setVoiceDefaultBgSound] = useState('none');
  const [availableSounds, setAvailableSounds] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [previewingSoundId, setPreviewingSoundId] = useState<string | null>(null);
  const soundPreviewRef = useRef<HTMLAudioElement | null>(null);

  const togglePreview = (soundId: string) => {
    if (previewingSoundId === soundId) {
      soundPreviewRef.current?.pause();
      setPreviewingSoundId(null);
      return;
    }
    if (soundPreviewRef.current) soundPreviewRef.current.pause();
    const audio = new Audio(api.getSoundStreamUrl(soundId));
    audio.onended = () => setPreviewingSoundId(null);
    audio.play().catch(() => toast.error('Failed to play sound'));
    soundPreviewRef.current = audio;
    setPreviewingSoundId(soundId);
  };

  // Telegram Bot
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramTokenExists, setTelegramTokenExists] = useState(false);
  const [telegramChatIdExists, setTelegramChatIdExists] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);

  // Feature toggles
  const [sensitiveTopicEnabled, setSensitiveTopicEnabled] = useState(true);
  const [conversationStartersEnabled, setConversationStartersEnabled] = useState(false);
  const [autoSummarizeEnabled, setAutoSummarizeEnabled] = useState(true);

  // Availability settings
  const [replyChance, setReplyChance] = useState(70);
  const [responseSpeed, setResponseSpeed] = useState('normal');
  const [activeHoursStart, setActiveHoursStart] = useState('09:00');
  const [activeHoursEnd, setActiveHoursEnd] = useState('02:00');
  const [activeTimezone, setActiveTimezone] = useState('America/New_York');

  const activeSpeed = SPEED_OPTIONS.find((option) => option.id === responseSpeed) ?? SPEED_OPTIONS[1];

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
    // ai_system_prompt removed — personas drive every reply.
    api.getConfig('ai_reply_chance').then(data => {
      if (data.exists) setReplyChance(parseInt(data.value || '70', 10));
    }).catch(() => {});
    api.getConfig('ai_response_speed').then(data => {
      if (data.exists) setResponseSpeed(data.value || 'normal');
    }).catch(() => {});
    api.getConfig('ai_active_hours_start').then(data => {
      if (data.exists) setActiveHoursStart(data.value || '09:00');
    }).catch(() => {});
    api.getConfig('ai_active_hours_end').then(data => {
      if (data.exists) setActiveHoursEnd(data.value || '02:00');
    }).catch(() => {});
    api.getConfig('ai_timezone').then(data => {
      if (data.exists) setActiveTimezone(data.value || 'America/New_York');
    }).catch(() => {});
    api.getPrompts().then(setPrompts).catch(() => {});
    api.getConfig('telegram_bot_token').then(data => {
      if (data.exists) setTelegramTokenExists(true);
    }).catch(() => {});
    api.getConfig('telegram_chat_id').then(data => {
      if (data.exists) setTelegramChatIdExists(true);
    }).catch(() => {});
    api.getConfig('sensitive_topic_detection').then(data => {
      setSensitiveTopicEnabled(data.exists ? data.value !== 'false' : true);
    }).catch(() => {});
    api.getConfig('conversation_starters').then(data => {
      setConversationStartersEnabled(data.value === 'true');
    }).catch(() => {});
    api.getConfig('auto_summarize').then(data => {
      setAutoSummarizeEnabled(data.exists ? data.value !== 'false' : true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.getVoiceSettings().then(s => {
      setVoiceNoteEnabled(s.enabled);
      setVoiceNoteChance(s.chance);
      setVoiceNoteMaxPerDay(s.maxPerDay);
      setVoiceBgVolume(Math.round((s.bgVolume ?? 0.15) * 100));
      setVoiceDefaultBgSound(s.defaultBgSound || 'none');
    }).catch(() => {});
    api.getVoices().then(vs => setAvailableVoices(vs.map((v: any) => ({ id: v.id, name: v.name })))).catch(() => {});
    api.getSounds().then(s => setAvailableSounds(s.custom)).catch(() => {});
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
    if (!confirm('This will disconnect your WhatsApp account and wipe all messages, contacts, and session data. You will need to scan QR again. Continue?')) return;
    setLoggingOut(true);
    try {
      await api.fullReset();
      toast.success('Logged out — scan QR to reconnect');
    } catch { toast.error('Failed to logout'); }
    finally { setLoggingOut(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.triggerSync();
      toast.success('Recovery sync started — fetching latest chats & contacts');
      // Poll diagnostics for ~20s so the user sees live updates
      const pollUntil = Date.now() + 20000;
      const tick = async () => {
        try { setDiagnostics(await api.getSyncDiagnostics()); } catch {}
        if (Date.now() < pollUntil) setTimeout(tick, 2500);
        else setSyncing(false);
      };
      tick();
    } catch {
      toast.error('Failed to start sync');
      setSyncing(false);
    }
  };

  const handleLoadDiagnostics = async () => {
    setLoadingDiagnostics(true);
    try {
      const data = await api.getSyncDiagnostics();
      setDiagnostics(data);
    } catch { toast.error('Failed to load diagnostics'); }
    finally { setLoadingDiagnostics(false); }
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
              <p className="text-xs text-muted-foreground">Disconnect, wipe all data, and remove your session</p>
            </div>
          </div>
          <button onClick={handleLogout} disabled={loggingOut}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-40">
            {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            {loggingOut ? 'Logging out...' : 'Logout'}
          </button>
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
                    Automation is ON. Active timing is <span className="font-semibold">{activeSpeed.label}</span> ({activeSpeed.desc}) with <span className="font-semibold">{replyChance}%</span> reply chance.
                  </p>
                </div>
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
                <p className="text-xs text-muted-foreground">Saved mode: {activeSpeed.label} — replies wait {activeSpeed.desc} before sending, then typing time scales with the reply length.</p>
                <div className="grid grid-cols-3 gap-2">
                  {SPEED_OPTIONS.map((option) => (
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

              {/* AI Voice Notes */}
              <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <label className="text-sm font-medium text-foreground">AI Voice Notes</label>
                  </div>
                  <button
                    onClick={async () => {
                      const next = !voiceNoteEnabled;
                      setVoiceNoteEnabled(next);
                      try { await api.updateVoiceSettings({ enabled: next }); toast.success(next ? 'Voice notes ON' : 'Voice notes OFF'); }
                      catch { setVoiceNoteEnabled(!next); toast.error('Failed to save'); }
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${voiceNoteEnabled ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground border border-border'}`}
                  >{voiceNoteEnabled ? 'ON' : 'OFF'}</button>
                </div>
                <p className="text-xs text-muted-foreground">AI replies sometimes as a voice note. Each contact's persona must have a voice assigned (Prompt Library below).</p>
                {voiceNoteEnabled && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-muted-foreground">Voice-note chance per reply</label>
                        <span className="text-xs font-bold text-primary">{voiceNoteChance}%</span>
                      </div>
                      <Slider value={[voiceNoteChance]} onValueChange={(v) => setVoiceNoteChance(v[0])}
                        onValueCommit={(v) => api.updateVoiceSettings({ chance: v[0] }).catch(() => {})}
                        min={0} max={100} step={5} className="w-full" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Max voice notes per contact per day</label>
                      <input type="number" min={0} max={50} value={voiceNoteMaxPerDay}
                        onChange={(e) => setVoiceNoteMaxPerDay(parseInt(e.target.value || '0', 10))}
                        onBlur={() => api.updateVoiceSettings({ maxPerDay: voiceNoteMaxPerDay }).catch(() => {})}
                        className="w-24 px-3 py-1.5 rounded-lg bg-background border border-border text-foreground text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Default background sound</label>
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setVoiceDefaultBgSound('none');
                            api.updateVoiceSettings({ defaultBgSound: 'none' }).then(() => toast.success('Background sound saved')).catch(() => toast.error('Failed to save'));
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                            voiceDefaultBgSound === 'none'
                              ? 'bg-primary/15 border-primary/40 text-foreground'
                              : 'bg-background border-border text-foreground hover:bg-secondary/60'
                          }`}
                        >
                          <span className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0">🔇</span>
                          <span className="flex-1 text-left">None (voice only)</span>
                        </button>
                        {availableSounds.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground italic px-1">
                            No sounds yet — extract one in <Link to="/voice-studio" className="text-primary underline">Voice Studio</Link>.
                          </p>
                        ) : (
                          availableSounds.map(s => (
                            <div
                              key={s.id}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border cursor-pointer ${
                                voiceDefaultBgSound === s.id
                                  ? 'bg-primary/15 border-primary/40'
                                  : 'bg-background border-border hover:bg-secondary/60'
                              }`}
                              onClick={() => {
                                setVoiceDefaultBgSound(s.id);
                                api.updateVoiceSettings({ defaultBgSound: s.id }).then(() => toast.success('Background sound saved')).catch(() => toast.error('Failed to save'));
                              }}
                            >
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); togglePreview(s.id); }}
                                className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/30 shrink-0 active:scale-95"
                                title={previewingSoundId === s.id ? 'Pause' : 'Play preview'}
                              >
                                {previewingSoundId === s.id ? <Pause className="w-4 h-4 text-primary" /> : <Play className="w-4 h-4 text-primary ml-0.5" />}
                              </button>
                              <span className="flex-1 text-foreground truncate text-left">🎵 {s.name}</span>
                              {voiceDefaultBgSound === s.id && (
                                <span className="text-[10px] text-primary font-semibold uppercase tracking-wide">Selected</span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">Only your extracted sounds appear here. Upload more in Voice Studio.</p>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-muted-foreground">Background volume</label>
                        <span className="text-xs font-bold text-primary">{voiceBgVolume}%</span>
                      </div>
                      <Slider value={[voiceBgVolume]} onValueChange={(v) => setVoiceBgVolume(v[0])}
                        onValueCommit={(v) => api.updateVoiceSettings({ bgVolume: v[0] / 100 }).catch(() => {})}
                        min={0} max={100} step={5} className="w-full" />
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">Anti-spam: never two voice notes in a row, AI judges suitability based on reply length/tone.</p>
                  </div>
                )}
              </div>

              {/* Active Hours */}
              <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <Power className="w-4 h-4 text-primary" />
                  <label className="text-sm font-medium text-foreground">Active Hours (Night Mode)</label>
                </div>
                <p className="text-xs text-muted-foreground">AI only replies between these hours. Outside this window, messages are ignored.</p>
                <div className="mb-2">
                  <label className="text-[10px] text-muted-foreground mb-1 block">Timezone</label>
                  <select value={activeTimezone}
                    onChange={(e) => { setActiveTimezone(e.target.value); saveAvailabilitySetting('ai_timezone', e.target.value); }}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50">
                    <option value="America/New_York">New York (ET)</option>
                    <option value="America/Chicago">Chicago (CT)</option>
                    <option value="America/Denver">Denver (MT)</option>
                    <option value="America/Los_Angeles">Los Angeles (PT)</option>
                    <option value="America/Toronto">Toronto (ET)</option>
                    <option value="Europe/London">London (GMT/BST)</option>
                    <option value="Europe/Paris">Paris (CET)</option>
                    <option value="Africa/Lagos">Lagos (WAT)</option>
                    <option value="Asia/Dubai">Dubai (GST)</option>
                    <option value="Asia/Kolkata">India (IST)</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground mb-1 block">Start</label>
                    <input type="time" value={activeHoursStart}
                      onChange={(e) => { setActiveHoursStart(e.target.value); saveAvailabilitySetting('ai_active_hours_start', e.target.value); }}
                      className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  </div>
                  <span className="text-muted-foreground text-sm mt-4">→</span>
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground mb-1 block">End</label>
                    <input type="time" value={activeHoursEnd}
                      onChange={(e) => { setActiveHoursEnd(e.target.value); saveAvailabilitySetting('ai_active_hours_end', e.target.value); }}
                      className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">Currently: <span className="font-medium text-foreground">{activeHoursStart}</span> to <span className="font-medium text-foreground">{activeHoursEnd}</span> ({activeTimezone.split('/').pop()?.replace('_', ' ')})</p>
              </div>

              {/* System Prompt removed — AI replies only when a persona is assigned to the contact via the Prompt Library. */}

              {/* Prompt Library */}
              <div className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-primary" />
                    <label className="text-sm font-medium text-foreground">Prompt Library</label>
                  </div>
                  <button onClick={() => { setShowPromptForm(true); setEditingPrompt(null); setPromptName(''); setPromptContent(''); }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> New Persona
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Create character personas and assign them to specific contacts. Contacts without a persona use the global prompt above.</p>

                {/* Prompt form */}
                {showPromptForm && (
                  <div className="space-y-2 p-3 rounded-lg bg-background border border-border">
                    <input value={promptName} onChange={(e) => setPromptName(e.target.value)}
                      placeholder="Persona name (e.g. Jeff Dunham)"
                      className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
                    <textarea value={promptContent} onChange={(e) => setPromptContent(e.target.value)}
                      placeholder="Enter the full persona prompt..."
                      rows={5}
                      className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
                    <div className="flex items-center gap-2">
                      <button onClick={async () => {
                        if (!promptName.trim() || !promptContent.trim()) return;
                        setSavingNewPrompt(true);
                        try {
                          if (editingPrompt) {
                            await api.updatePrompt(editingPrompt.id, promptName.trim(), promptContent.trim());
                            setPrompts(prev => prev.map(p => p.id === editingPrompt.id ? { ...p, name: promptName.trim(), content: promptContent.trim() } : p));
                            toast.success('Persona updated');
                          } else {
                            const created = await api.createPrompt(promptName.trim(), promptContent.trim());
                            setPrompts(prev => [created, ...prev]);
                            toast.success('Persona created');
                          }
                          setShowPromptForm(false); setPromptName(''); setPromptContent(''); setEditingPrompt(null);
                        } catch { toast.error('Failed to save persona'); }
                        finally { setSavingNewPrompt(false); }
                      }} disabled={savingNewPrompt || !promptName.trim() || !promptContent.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40">
                        {savingNewPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {editingPrompt ? 'Update' : 'Save'}
                      </button>
                      <button onClick={() => { setShowPromptForm(false); setEditingPrompt(null); }}
                        className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Prompt list */}
                {prompts.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {prompts.map(p => (
                      <div key={p.id} className="flex items-start justify-between gap-2 p-3 rounded-lg bg-background border border-border">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">{p.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{p.content.slice(0, 100)}...</p>
                          <div className="mt-2 flex items-center gap-2">
                            <label className="text-[10px] text-muted-foreground">🎤 Voice:</label>
                            <select
                              value={p.voice_id || ''}
                              onChange={async (e) => {
                                const v = e.target.value || null;
                                try {
                                  await api.setPromptVoice(p.id, v);
                                  setPrompts(prev => prev.map(x => x.id === p.id ? { ...x, voice_id: v } : x));
                                  toast.success('Voice updated');
                                } catch { toast.error('Failed to set voice'); }
                              }}
                              className="text-[11px] bg-secondary border border-border rounded px-2 py-1 text-foreground max-w-[180px]"
                            >
                              <option value="">— No voice (text only) —</option>
                              {availableVoices.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => { setEditingPrompt(p); setPromptName(p.name); setPromptContent(p.content); setShowPromptForm(true); }}
                            className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={async () => {
                            if (!confirm(`Delete persona "${p.name}"?`)) return;
                            try { await api.deletePrompt(p.id); setPrompts(prev => prev.filter(x => x.id !== p.id)); toast.success('Persona deleted'); }
                            catch { toast.error('Failed to delete'); }
                          }}
                            className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No personas yet. Create one to assign different AI characters to contacts.</p>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </motion.div>

      {/* Telegram Bot */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center"><Bot className="w-5 h-5 text-primary" /></div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Telegram Bot</h3>
            <p className="text-xs text-muted-foreground">Get reply previews and sensitive topic alerts on Telegram</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Bot Token (from @BotFather)</label>
            <input type="password" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)}
              placeholder={telegramTokenExists ? '••••••••••••••••' : '123456:ABC-DEF...'}
              className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Chat ID(s) — separate multiple with commas</label>
            <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder={telegramChatIdExists ? '••••••••' : '123456789, 987654321'}
              className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            <p className="text-[11px] text-muted-foreground/80 mt-1">
              All listed chats receive previews & alerts. Cancel/Rewrite/Custom buttons work from any of them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={async () => {
              if (!telegramToken && !telegramChatId) return;
              setSavingTelegram(true);
              try {
                if (telegramToken) await api.setConfig('telegram_bot_token', telegramToken);
                if (telegramChatId) await api.setConfig('telegram_chat_id', telegramChatId);
                if (telegramToken) { setTelegramTokenExists(true); setTelegramToken(''); }
                if (telegramChatId) { setTelegramChatIdExists(true); setTelegramChatId(''); }
                toast.success('Telegram bot config saved');
              } catch { toast.error('Failed to save'); }
              finally { setSavingTelegram(false); }
            }} disabled={(!telegramToken && !telegramChatId) || savingTelegram}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40">
              {savingTelegram ? 'Saving...' : 'Save'}
            </button>
            <button onClick={async () => {
              setTestingTelegram(true);
              try {
                await api.testTelegram();
                toast.success('Test message sent! Check your Telegram.');
              } catch (err: any) { toast.error(err?.message || 'Test failed'); }
              finally { setTestingTelegram(false); }
            }} disabled={testingTelegram || (!telegramTokenExists && !telegramToken)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-40">
              {testingTelegram ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Test
            </button>
          </div>
          {(telegramTokenExists && telegramChatIdExists) && (
            <p className="text-xs text-primary">✓ Telegram bot configured</p>
          )}
        </div>
      </motion.div>

      {/* AI Intelligence Features */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center"><Sparkles className="w-5 h-5 text-primary" /></div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">AI Intelligence</h3>
            <p className="text-xs text-muted-foreground">Advanced AI features for smarter conversations</p>
          </div>
        </div>

        {/* Sensitive Topic Detection */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
          <div>
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-warning" /> Sensitive Topic Detection
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Pause AI on serious topics (death, medical, money) and alert you via Telegram</p>
          </div>
          <button onClick={async () => {
            const newVal = !sensitiveTopicEnabled;
            setSensitiveTopicEnabled(newVal);
            await api.setConfig('sensitive_topic_detection', String(newVal));
          }} className={`w-11 h-6 rounded-full transition-colors relative ${sensitiveTopicEnabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`block w-5 h-5 rounded-full bg-background shadow-sm transition-transform ${sensitiveTopicEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Conversation Starters */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
          <div>
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-primary" /> Conversation Starters
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">AI initiates natural conversations with close contacts (max 2/day)</p>
          </div>
          <button onClick={async () => {
            const newVal = !conversationStartersEnabled;
            setConversationStartersEnabled(newVal);
            await api.setConfig('conversation_starters', String(newVal));
          }} className={`w-11 h-6 rounded-full transition-colors relative ${conversationStartersEnabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`block w-5 h-5 rounded-full bg-background shadow-sm transition-transform ${conversationStartersEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Auto-Summarize */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
          <div>
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Brain className="w-4 h-4 text-primary" /> Auto-Summarize Conversations
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Automatically summarize long conversations and save to contact memory</p>
          </div>
          <button onClick={async () => {
            const newVal = !autoSummarizeEnabled;
            setAutoSummarizeEnabled(newVal);
            await api.setConfig('auto_summarize', String(newVal));
          }} className={`w-11 h-6 rounded-full transition-colors relative ${autoSummarizeEnabled ? 'bg-primary' : 'bg-muted'}`}>
            <span className={`block w-5 h-5 rounded-full bg-background shadow-sm transition-transform ${autoSummarizeEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default SettingsPage;
