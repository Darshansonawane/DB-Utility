import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { StatusView } from '../types';

export const CONNECTIONS_CHANGED = 'flownexus:connections-changed';

/** `status` is the active MySQL connection (what queries run on); `statuses` is every live connection of this browser session. */
export function useConnectionStatus(intervalMs = 20_000) {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [statuses, setStatuses] = useState<StatusView[]>([]);
  const refresh = useCallback(async () => {
    try {
      const [s, all] = await Promise.all([api.status(), api.statuses().catch(() => [] as StatusView[])]);
      setStatus(s);
      setStatuses(all);
    } catch {
      setStatus({ connected: false, message: 'Backend not reachable' });
      setStatuses([]);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), intervalMs);
    // the Connections page announces changes so the top bar updates at once instead of at the next poll
    const onChanged = () => void refresh();
    window.addEventListener(CONNECTIONS_CHANGED, onChanged);
    return () => { clearInterval(t); window.removeEventListener(CONNECTIONS_CHANGED, onChanged); };
  }, [refresh, intervalMs]);
  return { status, statuses, refresh };
}
