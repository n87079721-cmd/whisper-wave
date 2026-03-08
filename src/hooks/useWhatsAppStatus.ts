import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

type ConnectionStatus = 'disconnected' | 'qr_waiting' | 'connected' | 'reconnecting';

export function useWhatsAppStatus() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [qr, setQr] = useState<string | null>(null);
  const [stats, setStats] = useState({ messagesSent: 0, voiceSent: 0, messagesReceived: 0, activeContacts: 0 });

  const refresh = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data.status);
      if (data.stats) setStats(data.stats);
    } catch {
      // Keep previous state on transient backend/network errors to avoid false logout UI
      setStatus((prev) => (prev === 'qr_waiting' ? prev : 'reconnecting'));
    }
  }, []);

  useEffect(() => {
    refresh();

    // SSE for real-time updates
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
        refresh(); // Refresh stats on new message
      });
      es.onerror = () => {
        // Reconnect after delay
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

  return { status, qr, stats, refresh };
}
