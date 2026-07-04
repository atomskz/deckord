import type { ServiceToClientMessage } from '@deckord/ipc-contract';
import type { DeckButtonEventKind, DeckLayoutSpec } from '@deckord/shared';

/**
 * The transport an adapter uses to reach its clients. A browser-based debug deck
 * implements this over WebSocket; a physical deck adapter would not use it at all
 * (it talks to the device SDK instead). Keeping this narrow is what lets the deck
 * adapter package stay free of any concrete transport dependency (`ws`, USB, …).
 */
export interface DeckWire {
  broadcast(message: ServiceToClientMessage): void;
  onButton(handler: (event: { kind: DeckButtonEventKind; slotIndex: number }) => void): void;
}

/** How a device consumes slot visuals: CSS model (browser) or PNG pixels (physical LCD). */
export type DeckImageFormat = 'css' | 'png';

/**
 * What a concrete deck can do — negotiated so the pipeline (and a future adapter
 * selector) can pick the right output. Extends the physical grid spec with the
 * device's visual/interaction capabilities.
 */
export type DeckCapabilities = DeckLayoutSpec & {
  imageFormats: DeckImageFormat[];
  /** Number of rotary knobs, if any (e.g. some StreamDock/AJAZZ models). */
  knobCount?: number;
  supportsBrightness?: boolean;
  /** True if the device renders title/subtitle text itself (vs. baked into the image). */
  hasTextApi?: boolean;
};
