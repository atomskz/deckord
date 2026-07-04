import type { RenderTheme } from '@deckord/renderer';

export type SlotImageRendererOptions = {
  theme?: RenderTheme;
  /** Square icon size in pixels (physical decks are typically 72–120px). Default 96. */
  size?: number;
};

/** Avatar input the canvas can decode: raw image bytes, a local file path, or a data URL. */
export type AvatarInput = Buffer | string;
