import type { DeckAdapterFactory, IDeckAdapter } from '@deckord/deck-adapter';
import { OpenDeckAdapter, type OpenDeckAdapterOptions } from './OpenDeckAdapter';
import { OpenDeckPluginTransport, type ElgatoLink } from './OpenDeckPluginTransport';

/**
 * Factory for the OpenDeck adapter. It is constructed with the Elgato link (the WS
 * the relay connects to) that the service owns. `isSupported()` is true when
 * OpenDeck is opted into — the relay connects asynchronously, so there is nothing
 * to probe outbound; until it connects, the adapter simply has no keys and renders
 * nothing.
 */
export class OpenDeckFactory implements DeckAdapterFactory {
  readonly id = 'opendeck';
  readonly name = 'OpenDeck';

  constructor(
    private readonly link: ElgatoLink,
    private readonly options: OpenDeckAdapterOptions = {},
  ) {}

  async isSupported(): Promise<boolean> {
    return true;
  }

  async create(): Promise<IDeckAdapter> {
    return new OpenDeckAdapter(new OpenDeckPluginTransport(this.link), this.options);
  }
}
