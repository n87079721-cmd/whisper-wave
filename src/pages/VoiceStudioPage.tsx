import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Play, Square, Send, Volume2 } from 'lucide-react';

const voices = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', desc: 'Warm, authoritative' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', desc: 'Friendly, natural' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', desc: 'Calm, professional' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', desc: 'Gentle, soothing' },
];

const VoiceStudioPage = () => {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(voices[0].id);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasPreview, setHasPreview] = useState(false);

  const handleGenerate = () => {
    if (!text) return;
    setIsGenerating(true);
    // Mock generation delay
    setTimeout(() => {
      setIsGenerating(false);
      setHasPreview(true);
    }, 2000);
  };

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
        {/* Voice selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Voice</label>
          <div className="grid grid-cols-2 gap-2">
            {voices.map(voice => (
              <button
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all ${
                  selectedVoice === voice.id
                    ? 'bg-primary/15 border border-primary/30'
                    : 'bg-secondary border border-transparent hover:border-border'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  selectedVoice === voice.id ? 'bg-primary/20' : 'bg-muted'
                }`}>
                  <Volume2 className={`w-4 h-4 ${selectedVoice === voice.id ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{voice.name}</p>
                  <p className="text-xs text-muted-foreground">{voice.desc}</p>
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
            onChange={(e) => { setText(e.target.value); setHasPreview(false); }}
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
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              Generate Voice Note
            </>
          )}
        </button>

        {/* Preview */}
        {hasPreview && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-secondary rounded-lg p-4 space-y-3"
          >
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preview</p>
            <div className="flex items-center gap-3">
              <button className="w-10 h-10 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors">
                <Play className="w-4 h-4 text-primary-foreground ml-0.5" />
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
              <span className="text-xs text-muted-foreground">0:08</span>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                <Send className="w-4 h-4" /> Send as Voice Note
              </button>
              <button className="px-4 py-2.5 rounded-lg bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors">
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
