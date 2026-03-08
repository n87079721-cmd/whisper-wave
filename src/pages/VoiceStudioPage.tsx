import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Mic, Play, Square, Send, Volume2, Loader2, ChevronDown } from 'lucide-react';
import { api, type Contact, type Voice } from '@/lib/api';
import { toast } from 'sonner';

const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2', desc: 'Highest quality, 29 languages' },
  { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5', desc: 'Low latency, high quality' },
  { id: 'eleven_monolingual_v1', name: 'English v1', desc: 'English only, legacy' },
];

const VoiceStudioPage = () => {
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('JBFqnCBsd6RMkjVDRZzb');
  const [selectedModel, setSelectedModel] = useState('eleven_multilingual_v2');
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState('');
  const [showContacts, setShowContacts] = useState(false);
  const [sending, setSending] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => {});
    api.getVoices().then(v => {
      setVoices(v);
      if (v.length > 0) setSelectedVoice(v[0].id);
    }).catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!text) return;
    setIsGenerating(true);
    setAudioUrl(null);
    try {
      const blob = await api.previewVoice(text, selectedVoice, selectedModel);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate voice');
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSendVoice = async () => {
    if (!selectedContact || !text) return;
    setSending(true);
    try {
      const res = await api.sendVoice(selectedContact, text, selectedVoice, selectedModel);
      if (res.error) throw new Error(res.error);
      toast.success('Voice note sent as PTT!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send voice note');
    } finally {
      setSending(false);
    }
  };

  const selected = contacts.find(c => c.id === selectedContact);
  const currentVoice = voices.find(v => v.id === selectedVoice);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Voice Studio</h1>
        <p className="text-sm text-muted-foreground mt-1">Generate realistic WhatsApp voice notes with ElevenLabs</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-xl p-6 space-y-5"
      >
        {/* Model selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Model</label>
          <div className="flex gap-2 flex-wrap">
            {MODELS.map(model => (
              <button
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  selectedModel === model.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
                title={model.desc}
              >
                {model.name}
              </button>
            ))}
          </div>
        </div>

        {/* Voice selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Voice Avatar</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {voices.map(voice => (
              <button
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`flex items-center gap-2 p-2.5 rounded-lg text-left transition-all ${
                  selectedVoice === voice.id
                    ? 'bg-primary/15 border border-primary/30'
                    : 'bg-secondary border border-transparent hover:border-border'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                  selectedVoice === voice.id ? 'bg-primary/20' : 'bg-muted'
                }`}>
                  {voice.gender === 'male' ? '♂' : voice.gender === 'female' ? '♀' : '◎'}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{voice.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{voice.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Text input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Text to speak</label>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setAudioUrl(null); }}
            placeholder="Type or paste the text you want to convert to a voice note..."
            rows={4}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
          />
          <p className="text-xs text-muted-foreground">{text.length} characters</p>
        </div>

        {/* Generate */}
        <button
          onClick={handleGenerate}
          disabled={!text || isGenerating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              Preview Voice Note
            </>
          )}
        </button>

        {/* Preview */}
        {audioUrl && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-secondary rounded-lg p-4 space-y-4"
          >
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preview</p>
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
              >
                {isPlaying ? (
                  <Square className="w-4 h-4 text-primary-foreground" />
                ) : (
                  <Play className="w-4 h-4 text-primary-foreground ml-0.5" />
                )}
              </button>
              <div className="flex-1 flex gap-0.5 items-center">
                {Array.from({ length: 40 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-primary/50 rounded-full"
                    style={{ height: `${Math.random() * 24 + 6}px` }}
                  />
                ))}
              </div>
            </div>
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
            />

            <p className="text-xs text-muted-foreground">
              ✓ Will be sent as OGG/Opus PTT voice note with waveform display
            </p>

            {/* Contact selector for sending */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Send to</label>
              <div className="relative">
                <button
                  onClick={() => setShowContacts(!showContacts)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground"
                >
                  <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
                    {selected ? `${selected.name || selected.phone} (${selected.phone})` : 'Select recipient'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </button>
                {showContacts && (
                  <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-lg shadow-xl max-h-36 overflow-y-auto">
                    {contacts.map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedContact(c.id); setShowContacts(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                      >
                        {c.name || c.phone} <span className="text-muted-foreground text-xs">({c.phone})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSendVoice}
                disabled={!selectedContact || sending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? 'Sending...' : 'Send as Voice Note'}
              </button>
              <button
                onClick={() => setAudioUrl(null)}
                className="px-4 py-2.5 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors"
              >
                Discard
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

export default VoiceStudioPage;
