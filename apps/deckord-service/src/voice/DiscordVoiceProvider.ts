import type { MockCommand } from '@deckord/ipc-contract';
import {
  DiscordAuthenticator,
  DiscordRpcClient,
  RPC_EVENTS,
  normalizeVoiceState,
  type DiscordRpcConfig,
  type SelectedVoiceChannel,
  type TokenStore,
  type VoiceStateChange,
} from '@deckord/discord-rpc';
import { createLogger, type Logger, type VoiceChannelState, type VoiceUser } from '@deckord/shared';
import type { IVoiceProvider, ProviderStatus } from './types';

const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Adapts the Discord RPC client to the provider interface. Owns the full lifecycle:
 * handshake → authenticate (via DiscordAuthenticator) → subscribe to the global
 * channel-select plus per-channel voice/speaking events → reconnect on drop.
 *
 * `start()` throws a typed DeckordError when Discord isn't running / not
 * authorized; VoiceService catches that and falls back to the mock provider. Once
 * started, a dropped connection is retried here (no fallback), so a Discord client
 * restart is transparent.
 */
export class DiscordVoiceProvider implements IVoiceProvider {
  readonly kind = 'discord-rpc' as const;

  private readonly log: Logger;
  private readonly authenticator: DiscordAuthenticator;
  private readonly updateHandlers: ((state: VoiceChannelState) => void)[] = [];
  private readonly statusHandlers: ((status: ProviderStatus) => void)[] = [];

  private client: DiscordRpcClient;
  private users = new Map<string, VoiceUser>();
  private channel: SelectedVoiceChannel | null = null;
  private subscribedChannelId: string | null = null;
  private connected = false;
  private stopped = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: DiscordRpcConfig,
    store: TokenStore,
    logger: Logger = createLogger('discord'),
  ) {
    this.log = logger;
    this.authenticator = new DiscordAuthenticator(config, store, logger.child('auth'));
    this.client = this.buildClient();
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connectAndAuth();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.subscribedChannelId) {
      await this.client.unsubscribeVoiceChannel(this.subscribedChannelId).catch(() => undefined);
      this.subscribedChannelId = null;
    }
    this.client.close();
    this.connected = false;
  }

  getState(): VoiceChannelState {
    return this.snapshot();
  }

  onUpdate(handler: (state: VoiceChannelState) => void): void {
    this.updateHandlers.push(handler);
  }

  onStatus(handler: (status: ProviderStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  command(command: MockCommand): void {
    this.log.warn(`Ignoring debug command "${command}" — not supported by the Discord provider.`);
  }

  // --- lifecycle -----------------------------------------------------------

  private buildClient(): DiscordRpcClient {
    const client = new DiscordRpcClient(this.config, this.log);
    client.onVoiceState((change) => this.applyVoiceState(change));
    client.onSpeaking((userId, speaking) => this.applySpeaking(userId, speaking));
    client.onChannelSelect(() => void this.reloadChannel());
    client.onClose(() => this.handleClose());
    client.onError((err) => this.status('error', err.message));
    return client;
  }

  private async connectAndAuth(): Promise<void> {
    await this.client.connect();
    const token = await this.authenticator.acquire(this.client);
    await this.client.authenticate(token);
    this.connected = true;
    this.reconnectAttempts = 0;
    // Global channel-select so joining/leaving/switching a channel is detected.
    await this.client.subscribe(RPC_EVENTS.VOICE_CHANNEL_SELECT);
    await this.loadSelectedChannel();
    this.status('info', 'Connected to Discord RPC');
    this.emit();
  }

  private handleClose(): void {
    if (this.stopped) return;
    this.connected = false;
    this.subscribedChannelId = null;
    this.status('warning', 'Discord RPC connection closed', 'WEBSOCKET_DISCONNECTED');
    this.emit();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.log.info(`Reconnecting to Discord in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    this.client = this.buildClient();
    try {
      await this.connectAndAuth();
    } catch (error) {
      this.status('warning', `Discord reconnect failed: ${String(error)}`, 'WEBSOCKET_DISCONNECTED');
      this.scheduleReconnect();
    }
  }

  // --- channel + events ----------------------------------------------------

  private async loadSelectedChannel(): Promise<void> {
    const channel = await this.client.getSelectedVoiceChannel();

    // Moved channels? Drop the old per-channel subscriptions first.
    if (this.subscribedChannelId && this.subscribedChannelId !== channel?.id) {
      await this.client.unsubscribeVoiceChannel(this.subscribedChannelId).catch(() => undefined);
      this.subscribedChannelId = null;
    }

    this.channel = channel;
    this.users.clear();

    if (!channel) {
      this.status('warning', 'No voice channel selected in Discord', 'NO_SELECTED_VOICE_CHANNEL');
      return;
    }

    for (const raw of channel.voiceStates) {
      const user = normalizeVoiceState(raw);
      this.users.set(user.userId, user);
    }

    if (this.subscribedChannelId !== channel.id) {
      await this.client.subscribeVoiceChannel(channel.id);
      this.subscribedChannelId = channel.id;
    }
  }

  private async reloadChannel(): Promise<void> {
    try {
      await this.loadSelectedChannel();
      this.emit();
    } catch (error) {
      this.status('error', `Failed to reload voice channel: ${String(error)}`);
    }
  }

  private applyVoiceState(change: VoiceStateChange): void {
    if (change.kind === 'delete') {
      this.users.delete(change.user.userId);
    } else {
      const existing = this.users.get(change.user.userId);
      // Speaking arrives via separate events; preserve it across state updates.
      this.users.set(change.user.userId, {
        ...change.user,
        isSpeaking: existing?.isSpeaking ?? false,
      });
    }
    this.emit();
  }

  private applySpeaking(userId: string, speaking: boolean): void {
    const user = this.users.get(userId);
    if (!user) return;
    user.isSpeaking = speaking;
    this.emit();
  }

  // --- state emission ------------------------------------------------------

  private snapshot(): VoiceChannelState {
    return {
      provider: 'discord-rpc',
      connected: this.connected,
      channelId: this.channel?.id ?? null,
      channelName: this.channel?.name ?? null,
      guildId: this.channel?.guildId ?? null,
      users: [...this.users.values()].map((u) => ({ ...u })),
      updatedAt: Date.now(),
    };
  }

  private emit(): void {
    const state = this.snapshot();
    for (const handler of this.updateHandlers) handler(state);
  }

  private status(level: ProviderStatus['level'], message: string, code?: string): void {
    for (const handler of this.statusHandlers) handler({ level, message, code });
  }
}
