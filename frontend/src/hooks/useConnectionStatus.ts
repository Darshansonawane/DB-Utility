import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { StatusView } from '../types';

export function useConnectionStatus(intervalMs = 20_000) {
  const [status, setStatus] = useState<StatusView | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus({ connected: false, message: 'Backend not reachable' });
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { status, refresh };
}
