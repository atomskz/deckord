import type { DeckButtonEvent, DeckLayoutSpec, RenderedDeckSlot } from '@deckord/shared';
import type { DeckCapabilities } from './types';

/**
 * The replaceable bottom layer. Everything above (Discord voice, deck-core,
 * renderer) is device-agnostic; only the concrete adapter knows how to paint
 * buttons and read presses on a specific target.
 *
 * MVP ships `DebugBrowserDeckAdapter`. Later: OpenDeck, StreamDock/AJAZZ, Elgato.
 * Deck-core must never depend on a concrete adapter, and an adapter must never
 * contain Discord logic.
 */
export interface IDeckAdapter {
  readonly id: string;
  readonly name: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Grid spec of this deck (rows, columns, slot count, icon size, knobs). */
  getLayoutSpec(): DeckLayoutSpec;

  /** Full capabilities — the grid spec plus how the device consumes visuals. */
  getCapabilities(): DeckCapabilities;

  /**
   * Register for capability changes at runtime (device hot-plug, or the user
   * re-assigning keys on a host-driven deck like OpenDeck). Static decks (the
   * debug browser deck) never fire it.
   */
  onCapabilitiesChanged(handler: (capabilities: DeckCapabilities) => void): void;

  /**
   * Register for "the device may have lost its key images, repaint from current
   * state" — without a capability change. Host-driven decks (OpenDeck) fire this
   * when the host re-emits `willAppear` on a profile edit and blanks the keys.
   * Optional: static decks never need it.
   */
  onRepaintNeeded?(handler: () => void): void;

  setSlot(slotIndex: number, slot: RenderedDeckSlot): Promise<void>;
  clearSlot(slotIndex: number): Promise<void>;
  clearAll(): Promise<void>;

  onButtonDown(handler: (event: DeckButtonEvent) => void): void;
  onButtonUp(handler: (event: DeckButtonEvent) => void): void;
}

export type DeckButtonHandler = (event: DeckButtonEvent) => void;
