import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DeckordError } from '@deckord/shared';
import type { RpcOpcode } from './types';

/** Sanity cap on a single frame; a larger/negative length means a desynced stream. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

type MessageHandler = (op: RpcOpcode, data: unknown) => void;
type CloseHandler = () => void;
type ErrorHandler = (error: Error) => void;

/**
 * Low-level Discord IPC transport: connects to the local `discord-ipc-{0..9}`
 * named pipe (Windows) / unix socket and frames messages as
 * `[int32 op][int32 length][utf8 json]`.
 *
 * This is a real, working transport — the higher-level auth flow in
 * DiscordRpcClient is the part that remains a skeleton.
 */
export class DiscordIpcTransport {
  private socket: net.Socket | null = null;
  private readBuffer: Buffer = Buffer.alloc(0);
  private readonly messageHandlers: MessageHandler[] = [];
  private readonly closeHandlers: CloseHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];

  /** Try discord-ipc-0..9 and connect to the first that accepts us. */
  async connect(): Promise<void> {
    for (let id = 0; id < 10; id++) {
      const socketPath = ipcPath(id);
      try {
        this.socket = await connectSocket(socketPath);
        this.attach(this.socket);
        return;
      } catch {
        // try next pipe id
      }
    }
    throw new DeckordError(
      'DISCORD_IPC_NOT_FOUND',
      'No Discord IPC pipe found (discord-ipc-0..9). Is the Discord desktop client running?',
    );
  }

  send(op: RpcOpcode, payload: unknown): void {
    if (!this.socket) throw new DeckordError('DISCORD_NOT_RUNNING', 'IPC transport is not connected');
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(body.length, 4);
    this.socket.write(Buffer.concat([header, body]));
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }
  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }
  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  private attach(socket: net.Socket): void {
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.closeHandlers.forEach((h) => h()));
    socket.on('error', (err) => this.errorHandlers.forEach((h) => h(err)));
  }

  private onData(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    while (this.readBuffer.length >= 8) {
      const op = this.readBuffer.readInt32LE(0);
      const len = this.readBuffer.readInt32LE(4);
      if (len < 0 || len > MAX_FRAME_BYTES) {
        this.errorHandlers.forEach((h) => h(new Error(`Invalid Discord IPC frame length: ${len}`)));
        this.readBuffer = Buffer.alloc(0);
        this.close();
        return;
      }
      if (this.readBuffer.length < 8 + len) break;
      const body = this.readBuffer.subarray(8, 8 + len).toString('utf8');
      this.readBuffer = this.readBuffer.subarray(8 + len);
      let data: unknown = undefined;
      try {
        data = JSON.parse(body);
      } catch (err) {
        this.errorHandlers.forEach((h) => h(err as Error));
        continue;
      }
      this.messageHandlers.forEach((h) => h(op as RpcOpcode, data));
    }
  }
}

function ipcPath(id: number): string {
  if (process.platform === 'win32') {
    return `\\\\?\\pipe\\discord-ipc-${id}`;
  }
  const base =
    process.env.XDG_RUNTIME_DIR ??
    process.env.TMPDIR ??
    process.env.TMP ??
    process.env.TEMP ??
    os.tmpdir();
  return path.join(base, `discord-ipc-${id}`);
}

function connectSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const onError = (err: Error) => {
      socket.removeListener('connect', onConnect);
      reject(err);
    };
    const onConnect = () => {
      socket.removeListener('error', onError);
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once('connect', onConnect);
  });
}
