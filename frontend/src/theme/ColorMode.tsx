import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from '@mui/material';

export type ColorModePref = 'light' | 'dark' | 'system';
export const COLOR_MODE_KEY = 'dbutility.colorMode';
const LEGACY_COLOR_MODE_KEY = 'flownexus.colorMode';

export function readStoredMode(): ColorModePref {
  try {
    const v = localStorage.getItem(COLOR_MODE_KEY) ?? localStorage.getItem(LEGACY_COLOR_MODE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage unavailable */ }
  return 'system';
}

const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** Shared polish: consistent radius, soft shadows, and subtle hover feedback (all of it is switched off for reduced motion in motion.css). */
const sharedComponents = {
  MuiButton: {
    styleOverrides: {
      root: { borderRadius: 8, transition: `transform 160ms ${EASE}, box-shadow 160ms ${EASE}, background-color 160ms ${EASE}`, '&:active': { transform: 'scale(0.98)' } },
      contained: { '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 6px 14px rgba(10, 31, 68, 0.22)' } },
      outlined: { '&:hover': { transform: 'translateY(-1px)' } },
    },
  },
  MuiIconButton: { styleOverrides: { root: { transition: `transform 160ms ${EASE}, background-color 160ms ${EASE}`, '&:hover': { transform: 'scale(1.08)' } } } },
  MuiCard: { styleOverrides: { root: { borderRadius: 12, boxShadow: '0 1px 2px rgba(10, 31, 68, 0.06), 0 4px 14px rgba(10, 31, 68, 0.06)', transition: `box-shadow 200ms ${EASE}` } } },
  MuiChip: { styleOverrides: { root: { transition: `background-color 200ms ${EASE}, color 200ms ${EASE}, transform 200ms ${EASE}` } } },
  MuiDialog: { styleOverrides: { paper: { borderRadius: 14 } } },
  MuiTableRow: { styleOverrides: { root: { transition: `background-color 160ms ${EASE}` } } },
  MuiListItemButton: {
    styleOverrides: { root: { transition: `background-color 160ms ${EASE}, padding-left 160ms ${EASE}`, '&:hover': { backgroundColor: 'rgba(30, 107, 255, 0.08)' } } },
  },
  MuiTextField: { defaultProps: { variant: 'outlined' as const } },
};

const base = {
  shape: { borderRadius: 8 },
  typography: { fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif', h5: { fontWeight: 700 }, h6: { fontWeight: 650 } },
  components: sharedComponents,
};
export const lightTheme = createTheme({
  ...base,
  palette: { mode: 'light', primary: { main: '#0b3a6f' }, secondary: { main: '#00897b' }, background: { default: '#f3f6fb' } },
});
export const darkTheme = createTheme({
  ...base,
  palette: {
    mode: 'dark',
    primary: { main: '#4d8dff' },
    secondary: { main: '#26c6b5' },
    background: { default: '#07142b', paper: '#0d2147' },
  },
  components: { ...sharedComponents, MuiAppBar: { styleOverrides: { colorPrimary: { backgroundColor: '#0A1F44', backgroundImage: 'none' } } } },
});

interface Ctx { preference: ColorModePref; mode: 'light' | 'dark'; setPreference: (p: ColorModePref) => void; cycle: () => void }
const ColorModeContext = createContext<Ctx>({ preference: 'system', mode: 'light', setPreference: () => {}, cycle: () => {} });

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ColorModePref>(readStoredMode);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode: 'light' | 'dark' = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  const setPreference = useCallback((p: ColorModePref) => {
    setPref(p);
    try { localStorage.setItem(COLOR_MODE_KEY, p); } catch { /* ignore */ }
  }, []);
  const cycle = useCallback(() => setPreference(preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light'), [preference, setPreference]);
  useEffect(() => { document.documentElement.style.colorScheme = mode; }, [mode]);
  const value = useMemo(() => ({ preference, mode, setPreference, cycle }), [preference, mode, setPreference, cycle]);
  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={mode === 'dark' ? darkTheme : lightTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export const useColorMode = () => useContext(ColorModeContext);
