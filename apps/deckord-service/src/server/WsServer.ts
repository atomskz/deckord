import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  decodeClientMessage,
  encode,
  type ClientToServiceMessage,
  type ConfigClientMessage,
  type MockCommand,
  type ServiceToClientMessage,
} from '@deckord/ipc-contract';
import type { DeckWire } from '@deckord/deck-adapter';
import type { DeckButtonEventKind, Logger } from '@deckord/shared';

export type WsClient = {
  id: number;
  send: (message: ServiceToClientMessage) => void;
};

export type WsServerConfig = {
  host: string;
  port: number;
  path: string;
  token?: string;
};

type ButtonHandler = (event: { kind: DeckButtonEventKind; slotIndex: number }) => void;
type MockHandler = (command: MockCommand, userId?: string) => void;
type ConnectHandler = (client: WsClient) => void;
type ConfigHandler = (message: ConfigClientMessage, client: WsClient) => void;

/**
 * Local WebSocket transport. Binds to loopback only, optionally gated by a shared
 * token. Implements the adapter's `DeckWire` (broadcast + button events) and also
 * surfaces client connect + mock commands to the orchestrator.
 */
export class WsServer implements DeckWire {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<number, WebSocket>();
  private nextId = 1;

  private readonly buttonHandlers: ButtonHandler[] = [];
  private readonly mockHandlers: MockHandler[] = [];
  private readonly connectHandlers: ConnectHandler[] = [];
  private readonly configHandlers: ConfigHandler[] = [];

  constructor(
    private readonly config: WsServerConfig,
    private readonly log: Logger,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.config.host,
        port: this.config.port,
        path: this.config.path,
      });
      wss.on('connection', (ws, req) => this.handleConnection(ws, req.url ?? ''));
      wss.once('listening', () => {
        this.wss = wss;
        if (!this.config.token) {
          this.log.warn(
            'WebSocket API has NO token (debug-only). Set DECKORD_WS_TOKEN before exposing beyond localhost.',
          );
        }
        this.log.info(
          `WebSocket API listening on ws://${this.config.host}:${this.config.port}${this.config.path}`,
        );
        resolve();
      });
      wss.once('error', reject);
    });
  }

  broadcast(message: ServiceToClientMessage): void {
    const raw = encode(message);
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
  }

  onButton(handler: ButtonHandler): void {
    this.buttonHandlers.push(handler);
  }

  onMockCommand(handler: MockHandler): void {
    this.mockHandlers.push(handler);
  }

  onClientConnect(handler: ConnectHandler): void {
    this.connectHandlers.push(handler);
  }

  /** Config-domain messages (get/set-config, connect_discord, restart_service). */
  onConfigMessage(handler: ConfigHandler): void {
    this.configHandlers.push(handler);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  async close(): Promise<void> {
    for (const ws of this.clients.values()) ws.close();
    this.clients.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
  }

  // --- internal ------------------------------------------------------------

  private handleConnection(ws: WebSocket, url: string): void {
    if (!this.authorize(url)) {
      this.log.warn('Rejected WebSocket connection: invalid or missing token');
      ws.close(1008, 'unauthorized');
      return;
    }

    const id = this.nextId++;
    this.clients.set(id, ws);
    this.log.info(`Debug deck connected (client #${id}), ${this.clients.size} total`);

    // Send a snapshot synchronously on accept so it precedes any broadcast
    // (the mock speaking timer may fire before the client's `hello` arrives).
    this.notifyConnect(id);

    ws.on('message', (data) => this.handleMessage(id, data));
    ws.on('close', () => {
      this.clients.delete(id);
      this.log.info(`Debug deck disconnected (client #${id})`);
    });
    ws.on('error', (err) => this.log.warn(`Client #${id} socket error: ${err.message}`));
  }

  private authorize(url: string): boolean {
    if (!this.config.token) return true;
    try {
      const parsed = new URL(url, 'http://127.0.0.1');
      return parsed.searchParams.get('token') === this.config.token;
    } catch {
      return false;
    }
  }

  private handleMessage(clientId: number, data: RawData): void {
    const decoded = decodeClientMessage(data.toString());
    if (!decoded.ok) {
      this.log.warn(`Invalid message from client #${clientId}: ${decoded.error.message}`);
      return;
    }
    this.route(clientId, decoded.value);
  }

  private route(clientId: number, message: ClientToServiceMessage): void {
    switch (message.type) {
      case 'hello':
        // Re-send the snapshot on hello too: this is the frame the client sends
        // once its socket is fully open, so it guarantees the *live* socket gets a
        // snapshot even if the connect-time one landed on an abandoned socket.
        this.log.info(
          `Client #${clientId} hello (${message.payload.client} v${message.payload.version})`,
        );
        this.notifyConnect(clientId);
        break;
      case 'button_down':
        this.buttonHandlers.forEach((h) => h({ kind: 'down', slotIndex: message.payload.slotIndex }));
        break;
      case 'button_up':
        this.buttonHandlers.forEach((h) => h({ kind: 'up', slotIndex: message.payload.slotIndex }));
        break;
      case 'mock_command':
        this.mockHandlers.forEach((h) => h(message.payload.command, message.payload.userId));
        break;
      case 'get_config':
      case 'set_config':
      case 'connect_discord':
      case 'restart_service': {
        const client = this.makeClient(clientId);
        if (client) this.configHandlers.forEach((h) => h(message, client));
        break;
      }
    }
  }

  private notifyConnect(clientId: number): void {
    const client = this.makeClient(clientId);
    if (client) this.connectHandlers.forEach((h) => h(client));
  }

  private makeClient(clientId: number): WsClient | null {
    const ws = this.clients.get(clientId);
    if (!ws) return null;
    return {
      id: clientId,
      send: (message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encode(message));
      },
    };
  }
}
