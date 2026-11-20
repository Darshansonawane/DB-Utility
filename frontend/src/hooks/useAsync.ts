import { useCallback, useState } from 'react';
import { errMsg } from '../services/api';

/** Wraps an async action with loading + readable error state. */
export function useAsync() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errMsg(e));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);
  return { loading, error, setError, run };
}
