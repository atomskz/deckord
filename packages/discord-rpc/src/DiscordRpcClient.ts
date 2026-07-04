import { randomUUID } from 'node:crypto';
import { DeckordError, createLogger, type Logger, type VoiceUser } from '@deckord/shared';
import { DiscordIpcTransport } from './DiscordIpcTransport';
import {
  RPC_COMMANDS,
  RPC_EVENTS,
  RpcOpcode,
  normalizeVoiceState,
  type DiscordRpcConfig,
  type RawVoiceState,
  type RpcConnectionState,
} from './types';

export type VoiceStateChange = { kind: 'create' | 'update' | 'delete'; user: VoiceUser };

export type SelectedVoiceChannel = {
  id: string;
  name: string;
  guildId?: string | null;
  voiceStates: RawVoiceState[];
};

type RawFrame = {
  cmd?: string;
  evt?: string | null;
  nonce?: string | null;
  data?: unknown;
};

type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * High-level Discord RPC client.
 *
 * The transport + handshake + request/response correlation + event dispatch are
 * implemented; the OAuth AUTHORIZE flow is a skeleton (see DiscordAuth). Supply a
 * pre-obtained `accessToken` in the config to exercise authenticated RPC, or let
 * the service fall back to the mock provider.
 */
export class DiscordRpcClient {
  private readonly transport = new DiscordIpcTransport();
  private readonly pending = new Map<string, Pending>();
  private readonly log: Logger;
  private state: RpcConnectionState = 'idle';
  private readyResolvers: { resolve: () => void; reject: (e: Error) => void } | null = null;

  private readonly voiceStateHandlers: ((change: VoiceStateChange) => void)[] = [];
  private readonly speakingHandlers: ((userId: string, speaking: boolean) => void)[] = [];
  private readonly channelSelectHandlers: ((channelId: string | null) => void)[] = [];
  private readonly closeHandlers: (() => void)[] = [];
  private readonly errorHandlers: ((error: Error) => void)[] = [];

  constructor(
    private readonly config: DiscordRpcConfig,
    logger: Logger = createLogger('discord-rpc'),
  ) {
    this.log = logger;
    this.transport.onMessage((op, data) => this.handleFrame(op, data));
    this.transport.onClose(() => {
      this.state = 'closed';
      this.closeHandlers.forEach((h) => h());
    });
    this.transport.onError((err) => this.errorHandlers.forEach((h) => h(err)));
  }

  getState(): RpcConnectionState {
    return this.state;
  }

  /** Connect the transport and complete the RPC handshake (does NOT authenticate). */
  async connect(): Promise<void> {
    this.state = 'connecting';
    await this.transport.connect();

    this.state = 'handshaking';
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolvers = { resolve, reject };
    });
    this.transport.send(RpcOpcode.Handshake, { v: 1, client_id: this.config.clientId });
    await ready;
  }

  /**
   * Interactive OAuth over RPC: shows the consent dialog inside the Discord
   * desktop client and returns the authorization `code` on the RPC channel — no
   * browser redirect listener is needed. Uses a long timeout since it waits on
   * the user. The `code` is then exchanged for tokens (see DiscordAuth).
   */
  async authorize(scopes: readonly string[] = this.config.scopes, prompt = 'none'): Promise<string> {
    const data = (await this.request(
      RPC_COMMANDS.AUTHORIZE,
      { client_id: this.config.clientId, scopes: [...scopes], prompt },
      undefined,
      120_000,
    )) as { code?: string } | null;
    if (!data?.code) {
      throw new DeckordError('DISCORD_AUTH_FAILED', 'Discord AUTHORIZE returned no code');
    }
    return data.code;
  }

  async authenticate(accessToken: string): Promise<void> {
    this.state = 'authenticating';
    await this.request(RPC_COMMANDS.AUTHENTICATE, { access_token: accessToken });
    this.state = 'ready';
  }

  async getSelectedVoiceChannel(): Promise<SelectedVoiceChannel | null> {
    const data = (await this.request(RPC_COMMANDS.GET_SELECTED_VOICE_CHANNEL, {})) as
      | {
          id: string;
          name: string;
          guild_id?: string | null;
          voice_states?: RawVoiceState[];
        }
      | null;
    if (!data) return null;
    return {
      id: data.id,
      name: data.name,
      guildId: data.guild_id ?? null,
      voiceStates: data.voice_states ?? [],
    };
  }

  /** Subscribe to voice + speaking events for a specific channel. */
  async subscribeVoiceChannel(channelId: string): Promise<void> {
    const args = { channel_id: channelId };
    await Promise.all([
      this.subscribe(RPC_EVENTS.VOICE_STATE_CREATE, args),
      this.subscribe(RPC_EVENTS.VOICE_STATE_UPDATE, args),
      this.subscribe(RPC_EVENTS.VOICE_STATE_DELETE, args),
      this.subscribe(RPC_EVENTS.SPEAKING_START, args),
      this.subscribe(RPC_EVENTS.SPEAKING_STOP, args),
    ]);
  }

  async subscribe(evt: string, args: Record<string, unknown> = {}): Promise<void> {
    await this.request(RPC_COMMANDS.SUBSCRIBE, args, evt);
  }

  /** Unsubscribe from the per-channel voice + speaking events (on channel switch). */
  async unsubscribeVoiceChannel(channelId: string): Promise<void> {
    const args = { channel_id: channelId };
    await Promise.all([
      this.unsubscribe(RPC_EVENTS.VOICE_STATE_CREATE, args),
      this.unsubscribe(RPC_EVENTS.VOICE_STATE_UPDATE, args),
      this.unsubscribe(RPC_EVENTS.VOICE_STATE_DELETE, args),
      this.unsubscribe(RPC_EVENTS.SPEAKING_START, args),
      this.unsubscribe(RPC_EVENTS.SPEAKING_STOP, args),
    ]);
  }

  async unsubscribe(evt: string, args: Record<string, unknown> = {}): Promise<void> {
    await this.request(RPC_COMMANDS.UNSUBSCRIBE, args, evt);
  }

  onVoiceState(handler: (change: VoiceStateChange) => void): void {
    this.voiceStateHandlers.push(handler);
  }
  onSpeaking(handler: (userId: string, speaking: boolean) => void): void {
    this.speakingHandlers.push(handler);
  }
  onChannelSelect(handler: (channelId: string | null) => void): void {
    this.channelSelectHandlers.push(handler);
  }
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }
  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DeckordError('WEBSOCKET_DISCONNECTED', 'RPC client closed'));
    }
    this.pending.clear();
    this.transport.close();
    this.state = 'closed';
  }

  private request(
    cmd: string,
    args: Record<string, unknown>,
    evt?: string,
    timeoutMs = 10_000,
  ): Promise<unknown> {
    const nonce = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new DeckordError('UNKNOWN', `RPC request ${cmd} timed out`));
      }, timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      const frame = evt ? { cmd, args, evt, nonce } : { cmd, args, nonce };
      this.transport.send(RpcOpcode.Frame, frame);
    });
  }

  private handleFrame(op: RpcOpcode, raw: unknown): void {
    if (op === RpcOpcode.Ping) {
      this.transport.send(RpcOpcode.Pong, raw);
      return;
    }
    const frame = raw as RawFrame;

    // Handshake READY.
    if (frame.evt === RPC_EVENTS.READY) {
      this.readyResolvers?.resolve();
      this.readyResolvers = null;
      return;
    }

    // Command response correlation.
    if (frame.nonce && this.pending.has(frame.nonce)) {
      const pending = this.pending.get(frame.nonce)!;
      clearTimeout(pending.timer);
      this.pending.delete(frame.nonce);
      if (frame.evt === RPC_EVENTS.ERROR) {
        pending.reject(new DeckordError('DISCORD_AUTH_FAILED', describeError(frame.data)));
      } else {
        pending.resolve(frame.data);
      }
      return;
    }

    // Dispatched subscription events.
    this.dispatchEvent(frame);
  }

  private dispatchEvent(frame: RawFrame): void {
    switch (frame.evt) {
      case RPC_EVENTS.VOICE_STATE_CREATE:
        this.emitVoiceState('create', frame.data);
        break;
      case RPC_EVENTS.VOICE_STATE_UPDATE:
        this.emitVoiceState('update', frame.data);
        break;
      case RPC_EVENTS.VOICE_STATE_DELETE:
        this.emitVoiceState('delete', frame.data);
        break;
      case RPC_EVENTS.SPEAKING_START:
        this.emitSpeaking(frame.data, true);
        break;
      case RPC_EVENTS.SPEAKING_STOP:
        this.emitSpeaking(frame.data, false);
        break;
      case RPC_EVENTS.VOICE_CHANNEL_SELECT: {
        const data = frame.data as { channel_id?: string | null } | undefined;
        this.channelSelectHandlers.forEach((h) => h(data?.channel_id ?? null));
        break;
      }
      default:
        this.log.debug(`Unhandled RPC event: ${frame.evt ?? '<none>'}`);
    }
  }

  private emitVoiceState(kind: VoiceStateChange['kind'], data: unknown): void {
    const raw = data as RawVoiceState | undefined;
    if (!raw?.user) return;
    const user = normalizeVoiceState(raw);
    this.voiceStateHandlers.forEach((h) => h({ kind, user }));
  }

  private emitSpeaking(data: unknown, speaking: boolean): void {
    const payload = data as { user_id?: string } | undefined;
    if (!payload?.user_id) return;
    this.speakingHandlers.forEach((h) => h(payload.user_id!, speaking));
  }
}

function describeError(data: unknown): string {
  const err = data as { message?: string; code?: number } | undefined;
  return err?.message ?? 'Discord RPC error';
}
