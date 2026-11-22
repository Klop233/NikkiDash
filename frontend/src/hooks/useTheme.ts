import { useEffect, useState } from 'preact/hooks';
import type { ThemeMode } from '../api/types';

export function useTheme(initial: ThemeMode = 'system') {
  const [theme, setTheme] = useState<ThemeMode>(initial);

  useEffect(() => {
    const apply = () => {
      let resolved: 'dark' | 'light' = 'dark';
      if (theme === 'light') resolved = 'light';
      else if (theme === 'dark') resolved = 'dark';
      else if (typeof window !== 'undefined' && window.matchMedia) {
        resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
      document.documentElement.setAttribute('data-theme', resolved);
    };
    apply();
    if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener?.('change', apply);
      return () => mq.removeEventListener?.('change', apply);
    }
  }, [theme]);

  return { theme, setTheme };
}
