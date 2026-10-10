'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { parseTheme, resolveTheme, themeKey, type ThemeMode, type ThemePreference } from '@/lib/theme';

type ThemeContextValue = { preference: ThemePreference; resolved: ThemeMode; setPreference: (value: ThemePreference) => void; storageAvailable: boolean };
const Context = createContext<ThemeContextValue | null>(null);
const applyTheme = (mode: ThemeMode) => { document.documentElement.dataset.theme = mode; document.documentElement.style.colorScheme = mode; };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setValue] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<ThemeMode>('light');
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let current: ThemePreference = 'system';
    try { current = parseTheme(localStorage.getItem(themeKey)); } catch { setStorageAvailable(false); }
    const update = (value: ThemePreference) => { current = value; const mode = resolveTheme(value, media.matches); setValue(value); setResolved(mode); applyTheme(mode); };
    update(current);
    const systemChanged = () => { if (current === 'system') update(current); };
    const stored = (event: StorageEvent) => { if (event.key === themeKey || event.key === null) update(parseTheme(event.newValue)); };
    const selected = (event: Event) => update((event as CustomEvent<ThemePreference>).detail);
    media.addEventListener('change', systemChanged);
    window.addEventListener('storage', stored);
    window.addEventListener('unicirq-theme', selected);
    return () => { media.removeEventListener('change', systemChanged); window.removeEventListener('storage', stored); window.removeEventListener('unicirq-theme', selected); };
  }, []);
  function setPreference(value: ThemePreference) {
    const safe = parseTheme(value);
    try { localStorage.setItem(themeKey, safe); setStorageAvailable(true); } catch { setStorageAvailable(false); }
    const mode = resolveTheme(safe, window.matchMedia('(prefers-color-scheme: dark)').matches);
    setValue(safe); setResolved(mode); applyTheme(mode);
    window.dispatchEvent(new CustomEvent('unicirq-theme', { detail: safe }));
  }
  return <Context.Provider value={{ preference, resolved, setPreference, storageAvailable }}>{children}</Context.Provider>;
}

export function useTheme() { const value = useContext(Context); if (!value) throw new Error('ThemeProvider is missing'); return value; }
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  return <button type="button" className={`theme-toggle ${className}`} onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}>{resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>;
}
export function ThemePicker() {
  const { preference, setPreference, storageAvailable } = useTheme();
  return <><div className="theme-picker" role="group" aria-label="Appearance preference">{([{ value: 'light', title: 'Light', note: 'Bright & clear', icon: Sun }, { value: 'dark', title: 'Dark', note: 'Easy on the eyes', icon: Moon }, { value: 'system', title: 'System', note: 'Match your device', icon: Monitor }] as const).map(({ value, title, note, icon: Icon }) => <button key={value} type="button" aria-pressed={preference === value} onClick={() => setPreference(value)}><span className={`theme-preview ${value}`}><Icon size={24} /></span><strong>{title}</strong><small>{note}</small>{preference === value ? <Check className="theme-selected" size={16} /> : null}</button>)}</div><p className="settings-note">{storageAvailable ? 'Your choice is saved on this browser and applies across UniCirq.' : 'Your browser blocked saving this preference. It will apply until this page closes.'}</p></>;
}
