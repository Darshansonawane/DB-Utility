import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Logo from '../components/brand/Logo';
import LogoMark from '../components/brand/LogoMark';
import ColorModeToggle from '../components/brand/ColorModeToggle';
import { COLOR_MODE_KEY, ColorModeProvider, readStoredMode, useColorMode } from '../theme/ColorMode';

function Probe() { const { mode, preference } = useColorMode(); return <span data-testid="m">{preference}:{mode}</span>; }

describe('branding', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    });
  });

  it('Logo components expose accessible names', () => {
    render(<ColorModeProvider><Logo /><LogoMark /></ColorModeProvider>);
    expect(screen.getAllByRole('img', { name: 'FlowNexus' }).length).toBeGreaterThanOrEqual(2);
  });

  it('toggle cycles light -> dark -> system and persists', () => {
    localStorage.setItem(COLOR_MODE_KEY, 'light');
    render(<ColorModeProvider><ColorModeToggle /><Probe /></ColorModeProvider>);
    expect(screen.getByTestId('m')).toHaveTextContent('light:light');
    fireEvent.click(screen.getByRole('button', { name: /Theme: light/ }));
    expect(screen.getByTestId('m')).toHaveTextContent('dark:dark');
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /Theme: dark/ }));
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('system');
  });

  it('falls back to system on invalid storage', () => {
    localStorage.setItem(COLOR_MODE_KEY, 'bogus');
    expect(readStoredMode()).toBe('system');
  });
});
