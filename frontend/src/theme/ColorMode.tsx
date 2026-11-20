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

/**
 * HelloGroup two-colour palette, as in the HelloPaisa app: deep navy for structure and actions (buttons, headings, links, focus) and
 * brand red for accents (active markers, highlights, secondary emphasis). In dark mode red takes over the actions, since navy would vanish.
 * Hover/active use `dark`, tints use `light`; everything derives from these tokens.
 */
export const BRAND_RED = '#E22042';
export const BRAND_NAVY = '#0F3F78';
const RED = { main: BRAND_RED, light: '#F0647D', dark: '#B8142F', contrastText: '#FFFFFF' };
const NAVY = { main: BRAND_NAVY, light: '#3F6FA8', dark: '#0A2A52', contrastText: '#FFFFFF' };

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
    styleOverrides: { root: { transition: `background-color 160ms ${EASE}, padding-left 160ms ${EASE}`, '&:hover': { backgroundColor: 'rgba(15, 63, 120, 0.08)' } } },
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
  palette: {
    mode: 'light', primary: NAVY, secondary: RED, background: { default: '#f4f6fa' },
    text: { primary: '#10254A', secondary: '#4A5B78' },
  },
  components: {
    ...sharedComponents,
    // navy header with a red accent line, like the HelloPaisa launch screen
    MuiAppBar: { styleOverrides: { colorPrimary: { backgroundImage: 'linear-gradient(90deg, #0A2A52, #0F3F78)', borderBottom: `3px solid ${BRAND_RED}` } } },
  },
});
export const darkTheme = createTheme({
  ...base,
  palette: {
    mode: 'dark',
    primary: { ...RED, light: '#FF8FA3' },
    secondary: { ...RED, light: '#FF8FA3' },
    background: { default: '#07142b', paper: '#0d2147' },
  },
  components: { ...sharedComponents, MuiAppBar: { styleOverrides: { colorPrimary: { backgroundColor: '#0A1F44', backgroundImage: 'none', borderBottom: `3px solid ${BRAND_RED}` } } } },
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
