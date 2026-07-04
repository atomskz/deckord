import type { IDeckAdapter } from './IDeckAdapter';

/**
 * A factory that can probe for its target and construct the adapter. This is the
 * seam that lets the service pick an adapter at runtime from whatever is connected
 * instead of hardcoding one. The debug browser deck is always available; physical
 * adapters (OpenDeck, StreamDock/AJAZZ, Elgato) implement `isSupported()` to report
 * whether their hardware is present.
 */
export interface DeckAdapterFactory {
  readonly id: string;
  readonly name: string;
  /** Whether this adapter's target is available right now (device connected, etc.). */
  isSupported(): Promise<boolean>;
  create(): Promise<IDeckAdapter>;
}

export type DeckAdapterSelection = {
  factory: DeckAdapterFactory;
  adapter: IDeckAdapter;
};

/**
 * Holds the registered adapter factories and selects one to use. Deck-core and the
 * orchestrator never name a concrete adapter — they ask the registry, which keeps
 * the door open for multiple decks / hot-plug (re-select when hardware changes).
 */
export class DeckAdapterRegistry {
  private readonly factories: DeckAdapterFactory[] = [];

  register(factory: DeckAdapterFactory): this {
    this.factories.push(factory);
    return this;
  }

  list(): DeckAdapterFactory[] {
    return [...this.factories];
  }

  get(id: string): DeckAdapterFactory | undefined {
    return this.factories.find((factory) => factory.id === id);
  }

  /**
   * Choose an adapter: the preferred one if it is registered and supported,
   * otherwise the first registered factory that reports support. Returns undefined
   * if none are supported.
   */
  async select(preferredId?: string): Promise<DeckAdapterFactory | undefined> {
    if (preferredId) {
      const preferred = this.get(preferredId);
      if (preferred && (await preferred.isSupported())) return preferred;
    }
    for (const factory of this.factories) {
      if (await factory.isSupported()) return factory;
    }
    return undefined;
  }

  /** Select and construct in one step. */
  async selectAndCreate(preferredId?: string): Promise<DeckAdapterSelection | undefined> {
    const factory = await this.select(preferredId);
    if (!factory) return undefined;
    return { factory, adapter: await factory.create() };
  }
}
