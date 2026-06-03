import { useEffect, useState } from 'react';
import { Bot, Dice5, Gauge, Brain, Loader2, Hand } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const SPEED_OPTIONS = [
  { id: 'fast', label: 'Quick', desc: '3–10 mins', emoji: '⚡' },
  { id: 'normal', label: 'Normal', desc: '6–15 mins', emoji: '🕐' },
  { id: 'slow', label: 'Celebrity', desc: '30 mins–2 days', emoji: '👑' },
] as const;

/**
 * Dashboard-resident AI Reply Tuning panel.
 * Centralises the most important AI behaviour knobs:
 *   • Automation master toggle
 *   • Reply Chance
 *   • Response Speed
 *   • Question Cooldown (streak threshold + cooldown length)
 *
 * All values are per-account, stored via the existing config endpoints.
 */
const AiReplyTuning = () => {
  const [loaded, setLoaded] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [replyChance, setReplyChance] = useState(70);
  const [responseSpeed, setResponseSpeed] = useState('normal');
  const [questionStreakThreshold, setQuestionStreakThreshold] = useState(3);
  const [questionCooldownLength, setQuestionCooldownLength] = useState(2);
  const [manualMuteMinutes, setManualMuteMinutes] = useState(5);

  useEffect(() => {
    Promise.allSettled([
      api.getConfig('automation_enabled').then(d => setAutoEnabled(d.value === 'true')),
      api.getConfig('ai_reply_chance').then(d => { if (d.exists) setReplyChance(parseInt(d.value || '70', 10)); }),
      api.getConfig('ai_response_speed').then(d => { if (d.exists) setResponseSpeed(d.value || 'normal'); }),
      api.getConfig('ai_question_streak_threshold').then(d => { if (d.exists) setQuestionStreakThreshold(parseInt(d.value || '3', 10)); }),
      api.getConfig('ai_question_cooldown_length').then(d => { if (d.exists) setQuestionCooldownLength(parseInt(d.value || '2', 10)); }),
      api.getConfig('ai_manual_mute_minutes').then(d => { if (d.exists) setManualMuteMinutes(parseInt(d.value || '5', 10)); }),
    ]).finally(() => setLoaded(true));
  }, []);

  const save = async (key: string, value: string) => {
    try { await api.setConfig(key, value); }
    catch { toast.error('Failed to save setting'); }
  };

  const toggleAuto = async () => {
    const next = !autoEnabled;
    setAutoEnabled(next);
    try {
      await api.setConfig('automation_enabled', String(next));
      toast.success(next ? 'Automation ON' : 'Automation OFF');
    } catch {
      setAutoEnabled(!next);
      toast.error('Failed to save');
    }
  };

  const activeSpeed = SPEED_OPTIONS.find(o => o.id === responseSpeed) ?? SPEED_OPTIONS[1];

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      {/* Header + master toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">AI Reply Tuning</h3>
            <p className="text-xs text-muted-foreground">
              {autoEnabled
                ? <>Automation ON · {activeSpeed.label} · {replyChance}% reply chance</>
                : 'Automation OFF — AI will not auto-reply'}
            </p>
          </div>
        </div>
        <button
          onClick={toggleAuto}
          disabled={!loaded}
          className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${autoEnabled ? 'bg-primary' : 'bg-muted'}`}
          aria-label="Toggle automation"
        >
          <span
            className="absolute top-1 w-4 h-4 rounded-full bg-foreground transition-transform"
            style={{ transform: `translateX(${autoEnabled ? 24 : 2}px)` }}
          />
        </button>
      </div>

      {!loaded && (
        <div className="flex items-center justify-center py-4 text-muted-foreground text-xs gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading settings…
        </div>
      )}

      {loaded && autoEnabled && (
        <div className="space-y-4">
          {/* Reply Chance */}
          <div className="space-y-2 p-3 rounded-lg bg-secondary/60 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Dice5 className="w-4 h-4 text-primary" />
                <label className="text-xs font-medium text-foreground">Reply Chance</label>
              </div>
              <span className="text-xs font-bold text-primary">{replyChance}%</span>
            </div>
            <Slider
              value={[replyChance]}
              onValueChange={(v) => setReplyChance(v[0])}
              onValueCommit={(v) => save('ai_reply_chance', String(v[0]))}
              min={10} max={100} step={5}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Ghost mode 👻</span>
              <span>Always available 📱</span>
            </div>
          </div>

          {/* Response Speed */}
          <div className="space-y-2 p-3 rounded-lg bg-secondary/60 border border-border">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary" />
              <label className="text-xs font-medium text-foreground">Response Speed</label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {SPEED_OPTIONS.map(option => (
                <button
                  key={option.id}
                  onClick={() => { setResponseSpeed(option.id); save('ai_response_speed', option.id); }}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    responseSpeed === option.id
                      ? 'bg-primary/15 border-primary text-primary'
                      : 'bg-background border-border text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  <div className="text-base">{option.emoji}</div>
                  <div className="text-[11px] font-medium">{option.label}</div>
                  <div className="text-[10px] opacity-70">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Question Cooldown */}
          <div className="space-y-3 p-3 rounded-lg bg-secondary/60 border border-border">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              <label className="text-xs font-medium text-foreground">Question Cooldown</label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              After <span className="font-semibold text-foreground">{questionStreakThreshold}</span> replies with questions, the AI must send <span className="font-semibold text-foreground">{questionCooldownLength}</span> question-free replies before asking again.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-muted-foreground">Trigger after</label>
                <span className="text-xs font-bold text-primary">{questionStreakThreshold} replies</span>
              </div>
              <Slider
                value={[questionStreakThreshold]}
                onValueChange={(v) => setQuestionStreakThreshold(v[0])}
                onValueCommit={(v) => save('ai_question_streak_threshold', String(v[0]))}
                min={1} max={6} step={1}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-muted-foreground">Cooldown length</label>
                <span className="text-xs font-bold text-primary">{questionCooldownLength} replies</span>
              </div>
              <Slider
                value={[questionCooldownLength]}
                onValueChange={(v) => setQuestionCooldownLength(v[0])}
                onValueCommit={(v) => save('ai_question_cooldown_length', String(v[0]))}
                min={1} max={5} step={1}
              />
            </div>
          </div>

          {/* Manual Reply Mute */}
          <div className="space-y-2 p-3 rounded-lg bg-secondary/60 border border-border">
            <div className="flex items-center gap-2">
              <Hand className="w-4 h-4 text-primary" />
              <label className="text-xs font-medium text-foreground">Manual Reply Mute</label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              When you reply manually from your phone, pause the AI for this chat for{' '}
              <span className="font-semibold text-foreground">
                {manualMuteMinutes === 0 ? 'never (off)' : `${manualMuteMinutes} min`}
              </span>
              . Stops the AI from talking over you when you forget it's on.
            </p>
            <Slider
              value={[manualMuteMinutes]}
              onValueChange={(v) => setManualMuteMinutes(v[0])}
              onValueCommit={(v) => save('ai_manual_mute_minutes', String(v[0]))}
              min={0} max={60} step={1}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Off</span>
              <span>60 min</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiReplyTuning;