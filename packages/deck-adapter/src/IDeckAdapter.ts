import type { DeckButtonEvent, DeckLayoutSpec, RenderedDeckSlot } from '@deckord/shared';

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

  /** Physical/virtual capabilities of this deck (grid size, icon size, knobs). */
  getLayoutSpec(): DeckLayoutSpec;

  setSlot(slotIndex: number, slot: RenderedDeckSlot): Promise<void>;
  clearSlot(slotIndex: number): Promise<void>;
  clearAll(): Promise<void>;

  onButtonDown(handler: (event: DeckButtonEvent) => void): void;
  onButtonUp(handler: (event: DeckButtonEvent) => void): void;
}

export type DeckButtonHandler = (event: DeckButtonEvent) => void;
