import type { ServiceToClientMessage } from '@deckord/ipc-contract';
import type { DeckButtonEventKind } from '@deckord/shared';

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
