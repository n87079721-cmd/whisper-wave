import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Send, ChevronDown, Mic, Type, Loader2, Play, Square, Volume2 } from 'lucide-react';
import { api, type Contact, type Voice } from '@/lib/api';
import { getContactDisplayMeta, getContactDisplayName } from '@/lib/contactDisplay';
import { toast } from 'sonner';

const SendMessagePage = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedContact, setSelectedContact] = useState('');
  const [message, setMessage] = useState('');
  const [sendAs, setSendAs] = useState<'text' | 'voice'>('text');
  const [selectedVoice, setSelectedVoice] = useState('JBFqnCBsd6RMkjVDRZzb');
  const [showContacts, setShowContacts] = useState(false);
  const [sending, setSending] = useState(false);

  // Voice preview
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api.getContacts().then(res => setContacts(res.contacts)).catch(() => {});
    api.getVoices().then(v => {
      setVoices(v);
      if (v.length > 0) setSelectedVoice(v[0].id);
    }).catch(() => {});
  }, []);

  const selected = contacts.find(c => c.id === selectedContact);

  const handlePreview = async () => {
    if (!message.trim()) return;
    setPreviewing(true);
    try {
      const blob = await api.previewVoice(message, selectedVoice);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      toast.error(err.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else { audioRef.current.play(); setIsPlaying(true); }
  };

  const handleSend = async () => {
    if (!selectedContact || !message) return;
    setSending(true);
    try {
      if (sendAs === 'text') {
        const res = await api.sendText(selectedContact, message);
        if (res.error) throw new Error(res.error);
        toast.success('Message sent!');
      } else {
        const res = await api.sendVoice(selectedContact, message, selectedVoice);
        if (res.error) throw new Error(res.error);
        toast.success('Voice note sent as PTT!');
      }
      setMessage('');
      setPreviewUrl(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Send Message</h1>
        <p className="text-sm text-muted-foreground mt-1">Compose and send to any contact</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-xl p-6 space-y-5"
      >
        {/* Contact selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Recipient</label>
          <div className="relative">
            <button
              onClick={() => setShowContacts(!showContacts)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-secondary border border-border text-sm text-foreground hover:bg-secondary/80 transition-colors"
            >
              <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
                {selected ? `${getContactDisplayName(selected)}${getContactDisplayMeta(selected) ? ` (${getContactDisplayMeta(selected)})` : ''}` : 'Select a contact'}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
            {showContacts && (
              <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                {contacts.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No contacts. Connect WhatsApp first.</p>
                ) : (
                  contacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedContact(c.id); setShowContacts(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors"
                    >
                      {getContactDisplayName(c)}{getContactDisplayMeta(c) ? <span className="text-muted-foreground text-xs"> ({getContactDisplayMeta(c)})</span> : null}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Send as toggle */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Send as</label>
          <div className="flex gap-2">
            <button
              onClick={() => { setSendAs('text'); setPreviewUrl(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                sendAs === 'text'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              <Type className="w-4 h-4" /> Text
            </button>
            <button
              onClick={() => setSendAs('voice')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                sendAs === 'voice'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              <Mic className="w-4 h-4" /> Voice Note
            </button>
          </div>
        </div>

        {/* Voice selector */}
        {sendAs === 'voice' && voices.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Voice</label>
            <select
              value={selectedVoice}
              onChange={(e) => { setSelectedVoice(e.target.value); setPreviewUrl(null); }}
              className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-border text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              {voices.map(v => (
                <option key={v.id} value={v.id}>{v.name} — {v.desc}</option>
              ))}
            </select>
          </div>
        )}

        {/* Message input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {sendAs === 'voice' ? 'Text to convert to voice' : 'Message'}
          </label>
          <textarea
            value={message}
            onChange={(e) => { setMessage(e.target.value); setPreviewUrl(null); }}
            placeholder={sendAs === 'voice' ? 'Type text to generate voice note...' : 'Type your message...'}
            rows={4}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
          />
        </div>

        {/* Voice preview */}
        {sendAs === 'voice' && (
          <>
            <button
              onClick={handlePreview}
              disabled={!message.trim() || previewing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors disabled:opacity-40"
            >
              {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
              {previewing ? 'Generating preview...' : 'Preview Voice'}
            </button>

            {previewUrl && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 bg-secondary/70 rounded-lg p-3"
              >
                <button
                  onClick={togglePlay}
                  className="w-9 h-9 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
                >
                  {isPlaying ? <Square className="w-3.5 h-3.5 text-primary-foreground" /> : <Play className="w-3.5 h-3.5 text-primary-foreground ml-0.5" />}
                </button>
                <div className="flex-1 flex gap-0.5 items-center">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <div key={i} className="w-0.5 bg-primary/50 rounded-full" style={{ height: `${Math.random() * 18 + 4}px` }} />
                  ))}
                </div>
                <audio ref={audioRef} src={previewUrl} onEnded={() => setIsPlaying(false)} />
              </motion.div>
            )}

            <p className="text-xs text-muted-foreground">
              ✓ Sent as OGG/Opus PTT — shows native WhatsApp waveform
            </p>
          </>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!selectedContact || !message || sending}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {sendAs === 'voice' ? 'Generating & Sending...' : 'Sending...'}
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              {sendAs === 'voice' ? 'Generate & Send Voice Note' : 'Send Message'}
            </>
          )}
        </button>
      </motion.div>
    </div>
  );
};

export default SendMessagePage;
