import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Slide, Snackbar, type AlertColor } from '@mui/material';
import AnimatedCheck from './AnimatedCheck';

interface Note { id: number; severity: AlertColor; message: string }
export interface Notify {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const none = () => {};
const Ctx = createContext<Notify>({ success: none, error: none, warning: none, info: none });
export const useNotify = () => useContext(Ctx);

/** One consistent place for success / warning / error / info toasts. Errors shake once; success draws a check. */
export function NotifierProvider({ children }: { children: ReactNode }) {
  const [note, setNote] = useState<Note | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((severity: AlertColor, message: string) => {
    setNote({ id: Date.now() + Math.random(), severity, message });
    setOpen(true);
  }, []);
  const api = useMemo<Notify>(() => ({
    success: (m) => show('success', m), error: (m) => show('error', m), warning: (m) => show('warning', m), info: (m) => show('info', m),
  }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <Snackbar open={open} onClose={(_, reason) => { if (reason !== 'clickaway') setOpen(false); }} TransitionComponent={Slide}
        autoHideDuration={note?.severity === 'error' ? 8000 : 4500} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert key={note?.id} elevation={6} variant="filled" severity={note?.severity ?? 'info'} onClose={() => setOpen(false)} className={note?.severity === 'error' ? 'shake' : undefined}
          icon={note?.severity === 'success' ? <AnimatedCheck size={20} /> : undefined} sx={{ minWidth: 280, maxWidth: 520, alignItems: 'center' }}>
          {note?.message}
        </Alert>
      </Snackbar>
    </Ctx.Provider>
  );
}
