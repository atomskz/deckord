import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ElgatoLink } from '@deckord/adapter-opendeck';
import type { Logger } from '@deckord/shared';

export type OpenDeckLinkConfig = {
  host: string;
  port: number;
  path: string;
};

/**
 * The concrete Elgato link for Variant B: a loopback WebSocket endpoint the
 * host-launched relay connects to. It pipes raw Elgato frames both ways; all
 * protocol logic lives in @deckord/adapter-opendeck. Keeping the `ws` dependency
 * here (not in the adapter package) mirrors how the debug deck's WsServer lives in
 * the service.
 */
export class OpenDeckWsLink implements ElgatoLink {
  private wss: WebSocketServer | null = null;
  private relay: WebSocket | null = null;
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
      wss.on('connection', (ws) => this.attach(ws));
      wss.once('listening', () => {
        this.wss = wss;
        this.log.info(
          `OpenDeck relay endpoint on ws://${this.config.host}:${this.config.port}${this.config.path}`,
        );
        resolve();
      });
      wss.once('error', reject);
    });
  }

  send(frame: unknown): void {
    if (this.relay && this.relay.readyState === WebSocket.OPEN) {
      this.relay.send(JSON.stringify(frame));
    }
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
    this.relay = ws;
    this.log.info('OpenDeck relay connected');
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
      if (this.relay === ws) this.relay = null;
      this.log.info('OpenDeck relay disconnected');
      this.closeHandlers.forEach((h) => h());
    });
    ws.on('error', (err) => this.log.warn(`OpenDeck relay error: ${err.message}`));
  }
}
