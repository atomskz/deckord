import {
  EMPTY_VISUAL_STATE,
  type DeckButtonEvent,
  type DeckLayoutSpec,
  type DeckSlot,
  type RenderedDeckSlot,
} from '@deckord/shared';
import type { IDeckAdapter, DeckButtonHandler } from './IDeckAdapter';
import type { DeckWire } from './types';

/**
 * MVP adapter: renders the deck into a browser window over a WebSocket wire and
 * receives virtual button presses back. It contains ZERO Discord logic and ZERO
 * deck-assignment logic — it only translates the generic adapter contract into
 * wire messages, exactly as a physical adapter would translate it into device
 * SDK calls.
 */
export class DebugBrowserDeckAdapter implements IDeckAdapter {
  readonly id = 'debug-browser';
  readonly name = 'Debug Browser Deck';

  private readonly downHandlers: DeckButtonHandler[] = [];
  private readonly upHandlers: DeckButtonHandler[] = [];

  constructor(
    private readonly wire: DeckWire,
    private readonly spec: DeckLayoutSpec,
  ) {
    this.wire.onButton(({ kind, slotIndex }) => {
      const event: DeckButtonEvent = {
        kind,
        slotIndex,
        deckId: this.id,
        timestamp: Date.now(),
      };
      const handlers = kind === 'down' ? this.downHandlers : this.upHandlers;
      for (const handler of handlers) handler(event);
    });
  }

  async start(): Promise<void> {
    /* Wire lifecycle is owned by the service's WebSocket server. */
  }

  async stop(): Promise<void> {
    /* no-op */
  }

  getLayoutSpec(): DeckLayoutSpec {
    return this.spec;
  }

  async setSlot(slotIndex: number, slot: RenderedDeckSlot): Promise<void> {
    this.wire.broadcast({
      type: 'slot_update',
      payload: { slotIndex, slot: renderedToDeckSlot(slot) },
    });
  }

  async clearSlot(slotIndex: number): Promise<void> {
    this.wire.broadcast({
      type: 'slot_update',
      payload: { slotIndex, slot: emptyDeckSlot(slotIndex) },
    });
  }

  async clearAll(): Promise<void> {
    for (let i = 0; i < this.spec.slotCount; i++) {
      await this.clearSlot(i);
    }
  }

  onButtonDown(handler: DeckButtonHandler): void {
    this.downHandlers.push(handler);
  }

  onButtonUp(handler: DeckButtonHandler): void {
    this.upHandlers.push(handler);
  }
}

function renderedToDeckSlot(slot: RenderedDeckSlot): DeckSlot {
  return {
    slotIndex: slot.slotIndex,
    kind: slot.kind,
    userId: slot.userId,
    title: slot.title,
    subtitle: slot.subtitle,
    visualState: slot.visualState,
    image: slot.image,
    badges: slot.badges,
    accessibilityLabel: slot.accessibilityLabel,
  };
}

function emptyDeckSlot(slotIndex: number): DeckSlot {
  return {
    slotIndex,
    kind: 'empty',
    visualState: { ...EMPTY_VISUAL_STATE },
    badges: [],
  };
}
