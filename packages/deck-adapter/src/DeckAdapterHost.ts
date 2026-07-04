import type { DeckButtonEvent, DeckLayout, DeckSlot, RenderedDeckSlot } from '@deckord/shared';
import type { IDeckAdapter } from './IDeckAdapter';

export type SlotMapper = (slot: DeckSlot) => RenderedDeckSlot;

/**
 * Drives an IDeckAdapter from full DeckLayouts, pushing only the slots that
 * actually changed. This keeps deck-core and the orchestrator ignorant of the
 * concrete adapter while avoiding redundant device writes (important for slow
 * physical decks; harmless for the debug deck).
 */
export class DeckAdapterHost {
  private readonly previous = new Map<number, string>();
  /** Serializes applies so overlapping calls can't interleave device writes. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly adapter: IDeckAdapter,
    private readonly toRendered: SlotMapper,
  ) {}

  get adapterId(): string {
    return this.adapter.id;
  }

  start(): Promise<void> {
    return this.adapter.start();
  }

  stop(): Promise<void> {
    return this.adapter.stop();
  }

  onButtonDown(handler: (event: DeckButtonEvent) => void): void {
    this.adapter.onButtonDown(handler);
  }

  onButtonUp(handler: (event: DeckButtonEvent) => void): void {
    this.adapter.onButtonUp(handler);
  }

  /**
   * Push a layout, returning the slot indices that were actually updated.
   * Applies run one at a time (queued); the diff map is only ever mutated inside
   * a single in-flight `doApply`, so concurrent callers can't corrupt it or
   * produce out-of-order device writes.
   */
  apply(layout: DeckLayout): Promise<number[]> {
    return this.enqueue(() => this.doApply(layout));
  }

  reset(): Promise<void> {
    return this.enqueue(async () => {
      this.previous.clear();
      await this.adapter.clearAll();
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    // `.then(task, task)` runs `task` regardless of the previous result, and the
    // queue tail is kept always-resolved so one failed apply never blocks the next.
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doApply(layout: DeckLayout): Promise<number[]> {
    const changed: number[] = [];
    for (const slot of layout.slots) {
      const rendered = this.toRendered(slot);
      const key = JSON.stringify(rendered);
      if (this.previous.get(slot.slotIndex) !== key) {
        await this.adapter.setSlot(slot.slotIndex, rendered);
        this.previous.set(slot.slotIndex, key);
        changed.push(slot.slotIndex);
      }
    }
    return changed;
  }
}
