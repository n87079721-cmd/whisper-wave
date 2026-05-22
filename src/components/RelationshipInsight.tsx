import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface Props { contactId: string }

const RelationshipInsight = ({ contactId }: Props) => {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [graph, setGraph] = useState<any>(null);
  const [mood, setMood] = useState<any>(null);
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getRelationshipGraph(contactId);
      setGraph(res.relationship_graph);
      setMood(res.mood_state);
    } catch {
      setGraph(null); setMood(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { setGraph(null); setMood(null); setOpen(false); }, [contactId]);
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, contactId]);

  const reset = async () => {
    if (!confirm('Reset the AI\'s memory of mood + open promises for this contact?')) return;
    setResetting(true);
    try {
      await api.resetRelationshipGraph(contactId);
      setGraph(null); setMood(null);
      toast.success('Relationship insight cleared');
    } catch { toast.error('Failed to reset'); }
    finally { setResetting(false); }
  };

  const moodLabel = typeof mood === 'string' ? mood : mood?.mood || mood?.label || null;
  const promises = Array.isArray(graph?.promises) ? graph.promises : [];
  const openPromises = promises.filter((p: any) => p && p.status !== 'done' && p.status !== 'missed');
  const facts = Array.isArray(graph?.facts) ? graph.facts : [];

  return (
    <div className="rounded-md border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-foreground"
      >
        <span>Relationship Insight</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          ) : (
            <>
              {!graph && !mood && (
                <p className="text-muted-foreground">No insight yet. It builds up as the AI replies over time.</p>
              )}
              {moodLabel && (
                <div>
                  <p className="text-muted-foreground">Mood</p>
                  <p className="text-foreground">{moodLabel}</p>
                </div>
              )}
              {openPromises.length > 0 && (
                <div>
                  <p className="text-muted-foreground">Open promises</p>
                  <ul className="list-disc ml-4 text-foreground space-y-0.5">
                    {openPromises.slice(0, 6).map((p: any, i: number) => (
                      <li key={i}>{p.text || p.promise || JSON.stringify(p)}{p.due ? ` — ${p.due}` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
              {facts.length > 0 && (
                <div>
                  <p className="text-muted-foreground">Facts</p>
                  <ul className="list-disc ml-4 text-foreground space-y-0.5">
                    {facts.slice(0, 8).map((f: any, i: number) => (
                      <li key={i}>{typeof f === 'string' ? f : (f.text || JSON.stringify(f))}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={load}
                  className="px-2 py-1 rounded border border-input bg-background hover:bg-secondary text-[11px]"
                >Refresh</button>
                {(graph || mood) && (
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={reset}
                    className="px-2 py-1 rounded border border-destructive/50 text-destructive hover:bg-destructive/10 text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
                  ><RotateCcw className="w-3 h-3" /> {resetting ? 'Resetting…' : 'Reset'}</button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RelationshipInsight;