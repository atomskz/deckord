import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ElgatoLink } from '@deckord/adapter-opendeck';
import type { Logger } from '@deckord/shared';

export type OpenDeckLinkConfig = {
  host: string;
  port: number;
  path: string;
};

const MAX_OUTBOUND_BUFFER = 1000;

/**
 * The concrete Elgato link for Variant B: a loopback WebSocket endpoint the
 * host-launched relay connects to. It pipes raw Elgato frames both ways; all
 * protocol logic lives in @deckord/adapter-opendeck. Keeping the `ws` dependency
 * here (not in the adapter package) mirrors how the debug deck's WsServer lives in
 * the service.
 *
 * Outbound frames (setImage, …) are buffered while no relay is attached and flushed
 * on connect, so images produced before/around a relay (re)connect aren't lost.
 */
export class OpenDeckWsLink implements ElgatoLink {
  private wss: WebSocketServer | null = null;
  private relay: WebSocket | null = null;
  private readonly outbound: unknown[] = [];
  private readonly frameHandlers: ((frame: unknown) => void)[] = [];
  private readonly closeHandlers: (() => void)[] = [];

  constructor(
    private readonly config: OpenDeckLinkConfig,
    private readonly log: Logger,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.config.host,
        port: this.config.port,
        path: this.config.path,
      });
      let settled = false;
      wss.on('connection', (ws) => this.attach(ws));
      // A single 'error' listener that rejects the bind, then logs later errors so a
      // post-listen server error is never an unhandled (crashing) 'error' event.
      wss.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
          return;
        }
        this.log.warn(`OpenDeck relay server error: ${err.message}`);
      });
      wss.once('listening', () => {
        settled = true;
        this.wss = wss;
        this.log.info(
          `OpenDeck relay endpoint on ws://${this.config.host}:${this.config.port}${this.config.path}`,
        );
        resolve();
      });
    });
  }

  send(frame: unknown): void {
    if (this.relay && this.relay.readyState === WebSocket.OPEN) {
      this.relay.send(JSON.stringify(frame));
      return;
    }
    this.outbound.push(frame);
    if (this.outbound.length > MAX_OUTBOUND_BUFFER) this.outbound.shift();
  }

  onFrame(handler: (frame: unknown) => void): void {
    this.frameHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  async stop(): Promise<void> {
    this.relay?.close();
    this.relay = null;
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
  }

  private attach(ws: WebSocket): void {
    // Only one relay at a time; replace any existing live one explicitly.
    if (this.relay && this.relay !== ws && this.relay.readyState === WebSocket.OPEN) {
      this.log.warn('A second OpenDeck relay connected; closing the previous one');
      this.relay.close();
    }
    this.relay = ws;
    this.log.info('OpenDeck relay connected');
    while (this.outbound.length > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(this.outbound.shift()));
    }

    ws.on('message', (data: RawData) => {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.frameHandlers.forEach((h) => h(frame));
    });
    ws.on('close', () => {
      const wasActive = this.relay === ws;
      if (wasActive) this.relay = null;
      this.log.info('OpenDeck relay disconnected');
      if (wasActive) this.closeHandlers.forEach((h) => h()); // only the live relay's close propagates
    });
    ws.on('error', (err) => this.log.warn(`OpenDeck relay error: ${err.message}`));
  }
}
