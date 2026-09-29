import { create } from 'zustand';

const KEY = 'zola-theme';

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(theme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F0F0F' : '#F8F6F2');
  return dark;
}

function readSaved() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const useThemeStore = create((set, get) => ({
  theme: readSaved() || 'dark',
  isDark: true,

  init(defaultTheme) {
    const theme = readSaved() || defaultTheme || 'dark';
    set({ theme, isDark: apply(theme) });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (get().theme === 'system') set({ isDark: apply('system') });
    });
  },

  setTheme(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme, isDark: apply(theme) });
  },
}));
