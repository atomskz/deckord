import {
  decodeServiceMessage,
  encode,
  IPC_PROTOCOL_VERSION,
  type ClientToServiceMessage,
  type ServiceToClientMessage,
} from '@deckord/ipc-contract';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export type DeckSocketHandlers = {
  onMessage: (message: ServiceToClientMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
};

/**
 * Thin WebSocket client for the debug deck. Auto-reconnects (the service may not
 * be up yet when the browser loads) and validates every inbound frame against
 * the shared ipc-contract schema before handing it up.
 */
export class DeckSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: DeckSocketHandlers,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.handlers.onStatus('connecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      console.info('[deckord] websocket open →', this.url);
      this.handlers.onStatus('open');
      this.send({ type: 'hello', payload: { client: 'debug-deck', version: `0.1.0/${IPC_PROTOCOL_VERSION}` } });
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      const result = decodeServiceMessage(String(event.data));
      if (result.ok) this.handlers.onMessage(result.value);
      else console.warn('[deckord] dropped invalid message:', result.error.message);
    };

    ws.onclose = (event: CloseEvent) => {
      console.warn(
        `[deckord] websocket closed (code=${event.code}${event.reason ? `, reason=${event.reason}` : ''})`,
      );
      this.handlers.onStatus('closed');
      this.scheduleReconnect();
    };

    ws.onerror = (event) => {
      console.error('[deckord] websocket error', event);
      ws.close();
    };
  }

  send(message: ClientToServiceMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(message));
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 1500);
  }
}

/** Build the WS URL with an optional shared token, defaulting to loopback. */
export function resolveWsUrl(): string {
  const base = import.meta.env.VITE_WS_URL ?? 'ws://127.0.0.1:8787/deck';
  // The desktop shell injects a per-install token via the page URL (?token=…);
  // dev can bake one in with VITE_WS_TOKEN.
  const fromUrl =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null;
  const token = fromUrl ?? import.meta.env.VITE_WS_TOKEN;
  if (!token) return base;
  const url = new URL(base);
  url.searchParams.set('token', token);
  return url.toString();
}
