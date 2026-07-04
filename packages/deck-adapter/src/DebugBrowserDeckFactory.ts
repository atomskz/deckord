import { DebugBrowserDeckAdapter } from './DebugBrowserDeckAdapter';
import type { DeckAdapterFactory } from './DeckAdapterRegistry';
import type { IDeckAdapter } from './IDeckAdapter';
import type { DeckCapabilities, DeckWire } from './types';

/**
 * Factory for the always-available virtual browser deck. It is constructed with
 * the WebSocket wire + capabilities and reports support unconditionally, so it is
 * the natural fallback when no physical deck is connected.
 */
export class DebugBrowserDeckFactory implements DeckAdapterFactory {
  readonly id = 'debug-browser';
  readonly name = 'Debug Browser Deck';

  constructor(
    private readonly wire: DeckWire,
    private readonly capabilities: DeckCapabilities,
  ) {}

  async isSupported(): Promise<boolean> {
    return true; // virtual deck — always available
  }

  async create(): Promise<IDeckAdapter> {
    return new DebugBrowserDeckAdapter(this.wire, this.capabilities);
  }
}
