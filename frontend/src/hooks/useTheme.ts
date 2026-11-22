import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ThemeMode } from '../api/types';

const THEME_STORAGE_KEY = 'nikki_dash_theme';

function readStoredTheme(fallback: ThemeMode): ThemeMode {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null;
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    // Ignore storage restriction
  }
  return fallback;
}

export function useTheme(initial: ThemeMode = 'system') {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme(initial));
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage restriction
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  useEffect(() => {
    const apply = () => {
      let resolved: 'dark' | 'light' = 'dark';
      if (theme === 'light') resolved = 'light';
      else if (theme === 'dark') resolved = 'dark';
      else if (typeof window !== 'undefined' && window.matchMedia) {
        resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    };
    apply();
    if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener?.('change', apply);
      return () => mq.removeEventListener?.('change', apply);
    }
  }, [theme]);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
