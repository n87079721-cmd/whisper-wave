import { useState, useEffect, useCallback } from 'react';
import { api, isBackendConfigured } from '@/lib/api';

type ConnectionStatus = 'disconnected' | 'qr_waiting' | 'connected' | 'reconnecting';

export interface SyncState {
  phase: 'idle' | 'waiting_history' | 'importing' | 'partial' | 'ready' | 'recovering';
  connectedAt: string | null;
  lastHistorySyncAt: string | null;
  storeContacts: number;
  historyChats: number;
  historyContacts: number;
  historyMessages: number;
  unresolvedLids: number;
  totalDbContacts: number;
  totalDbMessages: number;
}

const defaultSyncState: SyncState = {
  phase: 'idle',
  connectedAt: null,
  lastHistorySyncAt: null,
  storeContacts: 0,
  historyChats: 0,
  historyContacts: 0,
  historyMessages: 0,
  unresolvedLids: 0,
  totalDbContacts: 0,
  totalDbMessages: 0,
};

export function useWhatsAppStatus() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [qr, setQr] = useState<string | null>(null);
  const [stats, setStats] = useState({ messagesSent: 0, voiceSent: 0, messagesReceived: 0, activeContacts: 0 });
  const [syncState, setSyncState] = useState<SyncState>(defaultSyncState);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data.status);
      if (data.stats) setStats(data.stats);
      if (data.syncState) setSyncState(data.syncState);
      if (data.status === 'qr_waiting') {
        try {
          const qrData = await api.getQR();
          if (qrData.qr) setQr(qrData.qr);
        } catch {}
      } else if (data.status === 'connected') {
        setQr(null);
      }
    } catch (err: any) {
      console.error('[WA Status] refresh error:', err);
      if (err?.message?.includes('Backend URL not configured')) {
        setStatus('disconnected');
        setQr(null);
        return;
      }
      setStatus((prev) => (prev === 'qr_waiting' ? prev : 'reconnecting'));
    }
  }, []);

  useEffect(() => {
    if (!isBackendConfigured()) {
      setStatus('disconnected');
      setQr(null);
      return;
    }

    refresh();

    let es: EventSource | null = null;
    try {
      es = api.createEventSource();
      es.addEventListener('status', (e) => {
        const data = JSON.parse(e.data);
        setStatus(data.status);
        if (data.status === 'connected') setQr(null);
      });
      es.addEventListener('qr', (e) => {
        const data = JSON.parse(e.data);
        setQr(data.qr);
        setStatus('qr_waiting');
      });
      es.addEventListener('message', () => {
        refresh();
      });
      es.addEventListener('history_sync', () => {
        refresh();
      });
      es.addEventListener('sync_state', (e) => {
        try {
          const data = JSON.parse(e.data);
          setSyncState(data);
        } catch {}
      });
      es.onerror = () => {
        if (!isBackendConfigured()) {
          setStatus('disconnected');
          setQr(null);
          return;
        }
        setStatus((prev) => (prev === 'qr_waiting' ? prev : 'reconnecting'));
        setTimeout(refresh, 5000);
      };
    } catch {}

    return () => { es?.close(); };
  }, [refresh]);

  // Also poll QR if status is qr_waiting
  useEffect(() => {
    if (status !== 'qr_waiting') return;
    const fetchQr = async () => {
      try {
        const data = await api.getQR();
        if (data.qr) setQr(data.qr);
      } catch {}
    };
    fetchQr();
    const interval = setInterval(fetchQr, 5000);
    return () => clearInterval(interval);
  }, [status]);

  return { status, qr, stats, syncState, refresh };
}
