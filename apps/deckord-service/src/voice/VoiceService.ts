import type { MockCommand } from '@deckord/ipc-contract';
import { FileTokenStore, type TokenStore } from '@deckord/discord-rpc';
import { toDeckordError, type Logger, type VoiceChannelState } from '@deckord/shared';
import { resolveInitialProvider, type DeckordConfig } from '../config/index';
import { DiscordVoiceProvider } from './DiscordVoiceProvider';
import { MockVoiceProvider } from './MockVoiceProvider';
import type { IVoiceProvider, ProviderStatus } from './types';

const EMPTY_STATE: VoiceChannelState = {
  provider: 'mock',
  connected: false,
  channelId: null,
  channelName: null,
  users: [],
  updatedAt: 0,
};

/**
 * Owns the active voice provider and implements the "graceful fallback to mock"
 * requirement: if the preferred provider (Discord RPC) can't start, it switches
 * to the mock provider and reports a status, so the rest of the system keeps
 * running unchanged.
 */
export class VoiceService {
  private provider: IVoiceProvider | null = null;
  private state: VoiceChannelState = EMPTY_STATE;

  private readonly updateHandlers: ((state: VoiceChannelState) => void)[] = [];
  private readonly statusHandlers: ((status: ProviderStatus) => void)[] = [];

  constructor(
    private readonly config: DeckordConfig,
    private readonly log: Logger,
    /** Where the Discord OAuth token is persisted. Defaults to a plaintext file;
     * the service injects an OS-secured (SecretStore-backed) store in Phase 9. */
    private readonly tokenStore: TokenStore = new FileTokenStore(config.discordTokenPath),
  ) {}

  async start(): Promise<void> {
    const initial = resolveInitialProvider(this.config);
    if (initial === 'discord-rpc') {
      const started = await this.tryStartDiscord();
      if (started) return;
    }
    await this.use(new MockVoiceProvider(this.config.mock, this.log.child('mock')));
  }

  getState(): VoiceChannelState {
    return this.state;
  }

  get providerKind(): VoiceChannelState['provider'] {
    return this.provider?.kind ?? 'mock';
  }

  onUpdate(handler: (state: VoiceChannelState) => void): void {
    this.updateHandlers.push(handler);
  }

  onStatus(handler: (status: ProviderStatus) => void): void {
    this.statusHandlers.push(handler);
  }

  command(command: MockCommand, userId?: string): void {
    this.provider?.command(command, userId);
  }

  async stop(): Promise<void> {
    await this.provider?.stop();
  }

  // --- internal ------------------------------------------------------------

  private async tryStartDiscord(): Promise<boolean> {
    const provider = new DiscordVoiceProvider(this.config.discord, this.tokenStore, this.log.child('discord'));
    try {
      await this.use(provider);
      return true;
    } catch (error) {
      const err = toDeckordError(error);
      this.log.warn(`Discord provider failed to start: ${err.code} — ${err.message}`);
      await provider.stop().catch(() => undefined);
      this.emitStatus({
        level: 'warning',
        message: `Discord RPC unavailable (${err.code}). Falling back to mock provider.`,
        code: 'PROVIDER_SWITCHED_TO_MOCK',
      });
      return false;
    }
  }

  private async use(provider: IVoiceProvider): Promise<void> {
    provider.onUpdate((state) => {
      this.state = state;
      for (const handler of this.updateHandlers) handler(state);
    });
    provider.onStatus((status) => this.emitStatus(status));
    this.provider = provider;
    await provider.start();
    this.state = provider.getState();
  }

  private emitStatus(status: ProviderStatus): void {
    for (const handler of this.statusHandlers) handler(status);
  }
}
