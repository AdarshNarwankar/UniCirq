export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';
export const themeKey = 'unicirq.theme.v1';
export const parseTheme = (value: unknown): ThemePreference => value === 'light' || value === 'dark' ? value : 'system';
export const resolveTheme = (preference: ThemePreference, systemDark: boolean): ThemeMode => preference === 'system' ? systemDark ? 'dark' : 'light' : preference;

// Run before first paint; the provider uses the same validated preference rules.
export const themeInitScript = `(function(){var p='system';try{var v=localStorage.getItem('${themeKey}');if(v==='light'||v==='dark')p=v;}catch(e){}var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light';})();`;
