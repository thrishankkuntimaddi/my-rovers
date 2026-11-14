export type ThemePref = 'light' | 'dark' | 'system';

export const LiquidGlass: {
  init(opts?: { root?: HTMLElement }): void;
  lens(): void;
  press(): void;
  floatHeaders(root?: HTMLElement): void;
  dockPill(dock: HTMLElement): () => void;
  theme: {
    get(): ThemePref;
    resolve(pref?: ThemePref): 'light' | 'dark';
    apply(pref?: ThemePref): 'light' | 'dark';
    set(pref: ThemePref): 'light' | 'dark';
  };
};
