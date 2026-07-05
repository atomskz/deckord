import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
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
import { DeckordError, type DeckButtonEventKind, type Logger } from '@deckord/shared';

export type WsClient = {
  id: number;
  /** True when the client presented the configured shared token. When no token is
   * configured (open dev mode) this is false and the API is unauthenticated. */
  authenticated: boolean;
  send: (message: ServiceToClientMessage) => void;
};

export type WsServerConfig = {
  host: string;
  port: number;
  path: string;
  token?: string;
};

type ClientRecord = { ws: WebSocket; authenticated: boolean };
type ButtonHandler = (event: { kind: DeckButtonEventKind; slotIndex: number }) => void;
type MockHandler = (command: MockCommand, userId?: string) => void;
type ConnectHandler = (client: WsClient) => void;
type ConfigHandler = (message: ConfigClientMessage, client: WsClient) => void;
type DiagnosticsHandler = (client: WsClient) => void;

/**
 * Local WebSocket transport. Binds to loopback and fails closed if asked to bind a
 * non-loopback host without a token. Every connection is Origin-checked (so a
 * drive-by web page can't reach the API) and, when a token is configured, gated by
 * a constant-time token comparison. Implements the adapter's `DeckWire`.
 */
export class WsServer implements DeckWire {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<number, ClientRecord>();
  private nextId = 1;

  private readonly buttonHandlers: ButtonHandler[] = [];
  private readonly mockHandlers: MockHandler[] = [];
  private readonly connectHandlers: ConnectHandler[] = [];
  private readonly configHandlers: ConfigHandler[] = [];
  private readonly diagnosticsHandlers: DiagnosticsHandler[] = [];

  constructor(
    private readonly config: WsServerConfig,
    private readonly log: Logger,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Fail closed: never expose an unauthenticated API beyond loopback.
      if (!isLoopbackHost(this.config.host) && !this.config.token) {
        reject(
          new DeckordError(
            'CONFIG_INVALID',
            `Refusing to bind the WebSocket API to non-loopback host "${this.config.host}" without DECKORD_WS_TOKEN`,
          ),
        );
        return;
      }
      const wss = new WebSocketServer({
        host: this.config.host,
        port: this.config.port,
        path: this.config.path,
        // Reject bad origins / missing tokens during the HTTP upgrade (401), so an
        // unauthorized client never completes the handshake or sees an open socket.
        verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) =>
          this.verifyClient(info.origin, info.req),
      });
      wss.on('connection', (ws, req) => this.handleConnection(ws, req));
      wss.once('listening', () => {
        this.wss = wss;
        if (!this.config.token) {
          this.log.warn(
            'WebSocket API has NO token (open dev mode). The desktop shell sets a per-install token automatically.',
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
    for (const { ws } of this.clients.values()) {
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

  /** A request for a diagnostics bundle. */
  onDiagnosticsRequest(handler: DiagnosticsHandler): void {
    this.diagnosticsHandlers.push(handler);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** The actually-bound port (useful when configured with port 0 in tests). */
  get boundPort(): number {
    const addr = this.wss?.address();
    return addr && typeof addr === 'object' ? addr.port : this.config.port;
  }

  async close(): Promise<void> {
    for (const { ws } of this.clients.values()) ws.close();
    this.clients.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
  }

  // --- internal ------------------------------------------------------------

  /** Upgrade-time gate: origin allowlist + token (before the handshake completes). */
  private verifyClient(origin: string | undefined, req: IncomingMessage): boolean {
    if (!originAllowed(origin)) {
      this.log.warn(`Rejected WebSocket upgrade: forbidden origin ${origin ?? '(none)'}`);
      return false;
    }
    if (!this.authorize(req.url ?? '').accept) {
      this.log.warn('Rejected WebSocket upgrade: invalid or missing token');
      return false;
    }
    return true;
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Already authorized by verifyClient; recompute the authenticated flag.
    const authenticated = this.authorize(req.url ?? '').authenticated;
    const id = this.nextId++;
    this.clients.set(id, { ws, authenticated });
    this.log.info(`Client connected (#${id}${authenticated ? ', authenticated' : ''}), ${this.clients.size} total`);

    // Send a snapshot synchronously on accept so it precedes any broadcast
    // (the mock speaking timer may fire before the client's `hello` arrives).
    this.notifyConnect(id);

    ws.on('message', (data) => this.handleMessage(id, data));
    ws.on('close', () => {
      this.clients.delete(id);
      this.log.info(`Client disconnected (#${id})`);
    });
    ws.on('error', (err) => this.log.warn(`Client #${id} socket error: ${err.message}`));
  }

  private authorize(url: string): { accept: boolean; authenticated: boolean } {
    if (!this.config.token) return { accept: true, authenticated: false };
    try {
      const parsed = new URL(url, 'http://127.0.0.1');
      const ok = tokensMatch(parsed.searchParams.get('token') ?? '', this.config.token);
      return { accept: ok, authenticated: ok };
    } catch {
      return { accept: false, authenticated: false };
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
      case 'get_diagnostics': {
        const client = this.makeClient(clientId);
        if (client) this.diagnosticsHandlers.forEach((h) => h(client));
        break;
      }
    }
  }

  private notifyConnect(clientId: number): void {
    const client = this.makeClient(clientId);
    if (client) this.connectHandlers.forEach((h) => h(client));
  }

  private makeClient(clientId: number): WsClient | null {
    const record = this.clients.get(clientId);
    if (!record) return null;
    return {
      id: clientId,
      authenticated: record.authenticated,
      send: (message) => {
        if (record.ws.readyState === WebSocket.OPEN) record.ws.send(encode(message));
      },
    };
  }
}

/** 127.0.0.1 / ::1 / localhost — NOT 0.0.0.0 (which binds every interface). */
function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/**
 * Allow non-browser clients (no Origin: the relay, native clients), Electron
 * (file://), and loopback web origins; reject everything else so a random web
 * page can't reach the API from a user's browser (CSWSH).
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'file:') return true;
    return isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

/** Constant-time token comparison (avoids leaking length/prefix via timing). */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
