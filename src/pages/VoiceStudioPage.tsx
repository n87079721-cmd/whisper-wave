import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Mic, Play, Square, Send, Loader2, ChevronDown, Sparkles, Info, Wand2, Undo2 } from 'lucide-react';
import { api, type Contact, type Voice } from '@/lib/api';
import { getContactDisplayMeta, getContactDisplayName } from '@/lib/contactDisplay';
import { toast } from 'sonner';

const MODELS = [
  { id: 'eleven_v3', name: 'v3 Human Mode ✨', desc: 'Most natural & expressive — recommended' },
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2', desc: 'High quality, 29 languages' },
  { id: 'eleven_monolingual_v1', name: 'English v1', desc: 'English only, legacy' },
];

const TAG_CATEGORIES = {
  'Emotions': [
    { tag: '[happy]', desc: 'Happy and joyful', emoji: '😊' },
    { tag: '[sad]', desc: 'Sad and melancholic', emoji: '😞' },
    { tag: '[angry]', desc: 'Angry tone', emoji: '😡' },
    { tag: '[excited]', desc: 'Excited and enthusiastic', emoji: '🤩' },
    { tag: '[scared]', desc: 'Fearful voice', emoji: '😨' },
    { tag: '[nervous]', desc: 'Nervous and anxious', emoji: '😰' },
    { tag: '[frustrated]', desc: 'Frustrated and annoyed', emoji: '😤' },
    { tag: '[disgusted]', desc: 'Disgusted reaction', emoji: '🤢' },
    { tag: '[embarrassed]', desc: 'Embarrassed tone', emoji: '😳' },
    { tag: '[proud]', desc: 'Proud and confident', emoji: '😏' },
    { tag: '[nostalgic]', desc: 'Wistful and nostalgic', emoji: '🥹' },
    { tag: '[elated]', desc: 'Overjoyed, ecstatic', emoji: '🥳' },
    { tag: '[resigned]', desc: 'Accepted defeat', emoji: '😔' },
    { tag: '[awe]', desc: 'Filled with wonder', emoji: '😯' },
  ],
  'Reactions': [
    { tag: '[laughing]', desc: 'Laughing while talking', emoji: '😂' },
    { tag: '[chuckling]', desc: 'Light chuckle', emoji: '🤭' },
    { tag: '[giggling]', desc: 'Playful giggle', emoji: '🤗' },
    { tag: '[crying]', desc: 'Tearful voice', emoji: '😢' },
    { tag: '[sobbing]', desc: 'Heavy crying', emoji: '😭' },
    { tag: '[gasping]', desc: 'Surprised gasp', emoji: '😱' },
    { tag: '[sighing]', desc: 'Deep sigh', emoji: '😮‍💨' },
    { tag: '[groaning]', desc: 'Frustrated groan', emoji: '😩' },
    { tag: '[scoffing]', desc: 'Dismissive scoff', emoji: '🙄' },
    { tag: '[snickering]', desc: 'Snickering under breath', emoji: '😏' },
    { tag: '[laughs softly]', desc: 'Soft gentle laugh', emoji: '☺️' },
    { tag: '[coughs]', desc: 'Light cough', emoji: '😷' },
    { tag: '[clapping]', desc: 'Clapping hands', emoji: '👏' },
  ],
  'Delivery': [
    { tag: '[whispering]', desc: 'Quiet whisper', emoji: '🤫' },
    { tag: '[shouting]', desc: 'Loud and projecting', emoji: '📢' },
    { tag: '[sarcastic tone]', desc: 'Sarcastic delivery', emoji: '😒' },
    { tag: '[dramatic tone]', desc: 'Over-dramatic delivery', emoji: '🎭' },
    { tag: '[serious tone]', desc: 'Serious and stern', emoji: '😐' },
    { tag: '[lighthearted]', desc: 'Light, casual tone', emoji: '😄' },
    { tag: '[reflective]', desc: 'Thoughtful, introspective', emoji: '🤔' },
    { tag: '[matter-of-fact]', desc: 'Plain, factual delivery', emoji: '📋' },
    { tag: '[wistful]', desc: 'Dreamy, longing tone', emoji: '🌙' },
    { tag: '[cautiously]', desc: 'Careful, hesitant tone', emoji: '🫤' },
    { tag: '[cheerfully]', desc: 'Bright, upbeat delivery', emoji: '🌟' },
    { tag: '[timidly]', desc: 'Shy, quiet delivery', emoji: '🫣' },
    { tag: '[quizzically]', desc: 'Questioning, curious', emoji: '🧐' },
  ],
  'Pacing': [
    { tag: '[pause]', desc: 'Natural pause', emoji: '⏸' },
    { tag: '[rushed]', desc: 'Speaking quickly', emoji: '⏩' },
    { tag: '[slows down]', desc: 'Gradually slower', emoji: '🐢' },
    { tag: '[drawn out]', desc: 'Stretched words', emoji: '🔄' },
    { tag: '[stammers]', desc: 'Stumbling over words', emoji: '😬' },
    { tag: '[hesitates]', desc: 'Pausing with uncertainty', emoji: '🤷' },
    { tag: '[deliberate]', desc: 'Slow, intentional pace', emoji: '🎯' },
    { tag: '[rapid-fire]', desc: 'Very fast delivery', emoji: '⚡' },
    { tag: '[emphasized]', desc: 'Stress on next words', emoji: '❗' },
    { tag: '[understated]', desc: 'Downplayed delivery', emoji: '🔇' },
    { tag: '[breathes]', desc: 'Audible breath', emoji: '🌬️' },
    { tag: '[continues softly]', desc: 'Trails off softly', emoji: '💨' },
    { tag: '[continues after a beat]', desc: 'Pause then continue', emoji: '⏯' },
    { tag: '...', desc: 'Long pause (punctuation)', emoji: '···' },
    { tag: '—', desc: 'Interruption / break', emoji: '—' },
  ],
  'Body & Sounds': [
    { tag: '[clearing throat]', desc: 'Ahem moment', emoji: '😤' },
    { tag: '[sniffling]', desc: 'Sniffling nose', emoji: '🤧' },
    { tag: '[yawning]', desc: 'Tired yawn', emoji: '🥱' },
    { tag: '[gulping]', desc: 'Nervous swallow', emoji: '😬' },
    { tag: '[panting]', desc: 'Out of breath', emoji: '🏃' },
    { tag: '[singing]', desc: 'Singing tone', emoji: '🎵' },
    { tag: '[humming]', desc: 'Humming a tune', emoji: '🎶' },
    { tag: '[explosion]', desc: 'Explosion sound', emoji: '💥' },
    { tag: '[gunshot]', desc: 'Gunshot sound', emoji: '🔫' },
    { tag: '[door creaking]', desc: 'Door creak', emoji: '🚪' },
    { tag: '[footsteps]', desc: 'Walking sounds', emoji: '👣' },
    { tag: '[thunder]', desc: 'Thunder rumble', emoji: '⛈️' },
  ],
};


const VoiceStudioPage = () => {
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [selectedModel, setSelectedModel] = useState('eleven_v3');
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState('');
  
  const [showContacts, setShowContacts] = useState(false);
  const [sending, setSending] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState('');
  const [showTagHelp, setShowTagHelp] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [activeTagCategory, setActiveTagCategory] = useState('Emotions');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => {});
    setLoadingVoices(true);
    api
      .getVoices()
      .then((v) => {
        setVoices(v);
        if (v.length > 0) setSelectedVoice(v[0].id);
      })
      .catch((err: Error) => {
        setVoices([]);
        toast.error(err.message || 'Failed to load voices from ElevenLabs');
      })
      .finally(() => setLoadingVoices(false));
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

  const insertTag = (tag: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setText(prev => prev + ' ' + tag + ' ');
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newText = text.slice(0, start) + tag + ' ' + text.slice(end);
    setText(newText);
    setAudioUrl(null);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + tag.length + 1;
    }, 0);
  };

  const filteredVoices = voices.filter(v =>
    !voiceFilter || v.name.toLowerCase().includes(voiceFilter.toLowerCase()) ||
    v.desc.toLowerCase().includes(voiceFilter.toLowerCase())
  );

  const selected = contacts.find(c => c.id === selectedContact);
  const currentVoice = voices.find(v => v.id === selectedVoice);
  const isV3 = selectedModel === 'eleven_v3';

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
                {model.id === 'eleven_v3' && <Sparkles className="w-3 h-3 inline ml-1" />}
              </button>
            ))}
          </div>
        </div>

        {/* Voice selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">
              Your Voices {loadingVoices && <Loader2 className="w-3 h-3 inline animate-spin ml-1" />}
            </label>
            <span className="text-xs text-muted-foreground">{voices.length} voices from your account</span>
          </div>
          <input
            type="text"
            placeholder="Search voices..."
            value={voiceFilter}
            onChange={e => setVoiceFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {filteredVoices.map(voice => (
              <button
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`flex items-center gap-2 p-2.5 rounded-lg text-left transition-all ${
                  selectedVoice === voice.id
                    ? 'bg-primary/15 border border-primary/30'
                    : 'bg-secondary border border-transparent hover:border-border'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${
                  selectedVoice === voice.id ? 'bg-primary/20' : 'bg-muted'
                }`}>
                  {voice.gender === 'male' ? '♂' : voice.gender === 'female' ? '♀' : '◎'}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{voice.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {voice.category && <span className="capitalize">{voice.category} · </span>}
                    {voice.desc}
                  </p>
                </div>
              </button>
            ))}
            {filteredVoices.length === 0 && !loadingVoices && (
              <p className="text-xs text-muted-foreground col-span-full py-4 text-center">
                No voices found. Make sure your ElevenLabs API key is set in Settings.
              </p>
            )}
          </div>
        </div>

        {/* Speech tags helper (shown for v3) */}
        {isV3 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-foreground">Expression Tags</label>
              <button onClick={() => setShowTagHelp(!showTagHelp)} className="text-muted-foreground hover:text-foreground">
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
            {showTagHelp && (
              <p className="text-xs text-muted-foreground bg-secondary rounded-lg p-2">
                v3 supports expression tags that make the voice react naturally — laughing, whispering, sighing, etc.
                Click any tag to insert it at the cursor position.
                Example: <code className="text-primary">[laughing] Oh stop it, you're too funny!</code>
              </p>
            )}
            {/* Category tabs */}
            <div className="flex gap-1.5 flex-wrap">
              {Object.keys(TAG_CATEGORIES).map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveTagCategory(cat)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all border ${
                    activeTagCategory === cat
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {/* Tags for active category */}
            <div className="flex gap-1.5 flex-wrap">
              {TAG_CATEGORIES[activeTagCategory as keyof typeof TAG_CATEGORIES].map(st => (
                <button
                  key={st.tag}
                  onClick={() => insertTag(st.tag)}
                  className="px-2.5 py-1.5 rounded-md bg-secondary text-xs text-secondary-foreground hover:bg-secondary/80 transition-colors border border-border flex items-center gap-1"
                  title={st.desc}
                >
                  <span>{st.emoji}</span>
                  <span>{st.tag}</span>
                </button>
              ))}
            </div>
          </div>
        )}


        {/* Text input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Text to speak</label>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setAudioUrl(null);
              if (originalText !== null) setOriginalText(null);
            }}
            placeholder={isV3
              ? "[laughing] Oh stop it! ... [whispering] But seriously, I miss you."
              : "Type or paste the text you want to convert to a voice note..."}
            rows={4}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{text.length} characters</p>
            {isV3 && (
              <div className="flex items-center gap-2">
                {originalText !== null && (
                  <button
                    onClick={() => { setText(originalText); setOriginalText(null); setAudioUrl(null); }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-secondary text-xs text-secondary-foreground hover:bg-secondary/80 transition-colors border border-border"
                  >
                    <Undo2 className="w-3 h-3" />
                    Undo
                  </button>
                )}
                <button
                  onClick={async () => {
                    const sourceText = (originalText ?? text).trim();
                    const preservedOriginal = originalText ?? text;
                    if (!sourceText) return;
                    setIsEnhancing(true);
                    try {
                      const res = await api.enhanceText(sourceText);
                      setOriginalText(preservedOriginal);
                      setText(res.enhanced);
                      setAudioUrl(null);
                      toast.success('Fresh rewrite ready');
                    } catch (err: any) {
                      toast.error(err.message || 'Failed to enhance text');
                    } finally {
                      setIsEnhancing(false);
                    }
                  }}
                  disabled={!text.trim() || isEnhancing}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary/15 text-xs text-primary font-medium hover:bg-primary/25 transition-colors border border-primary/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isEnhancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  {isEnhancing ? 'Enhancing...' : '✨ Enhance'}
                </button>
              </div>
            )}
          </div>
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
                    {selected ? `${getContactDisplayName(selected)}${getContactDisplayMeta(selected) ? ` (${getContactDisplayMeta(selected)})` : ''}` : 'Select recipient'}
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
                        {getContactDisplayName(c)}{getContactDisplayMeta(c) ? <span className="text-muted-foreground text-xs"> ({getContactDisplayMeta(c)})</span> : null}
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
