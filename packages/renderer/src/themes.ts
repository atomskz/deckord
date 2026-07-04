/**
 * Theme tokens. The debug UI does its own CSS styling, but these tokens are the
 * single source of truth for the future PNG renderer (Phase 5) and are handy for
 * keeping the debug UI visually consistent.
 */
export type RenderTheme = {
  name: string;
  colors: {
    background: string;
    slotBackground: string;
    text: string;
    subtitle: string;
    speaking: string;
    muted: string;
    deafened: string;
    selected: string;
    empty: string;
    status: string;
  };
};

export const DARK_THEME: RenderTheme = {
  name: 'dark',
  colors: {
    background: '#1e1f22',
    slotBackground: '#2b2d31',
    text: '#f2f3f5',
    subtitle: '#b5bac1',
    speaking: '#23a55a',
    muted: '#f23f43',
    deafened: '#f0b232',
    selected: '#5865f2',
    empty: '#232428',
    status: '#404249',
  },
};

export const DEFAULT_THEME = DARK_THEME;
