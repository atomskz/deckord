import { MVP_SCOPES } from '@deckord/discord-rpc';
import type {
  ConfigClientMessage,
  ConfigPayload,
  ServiceToClientMessage,
  SetConfigPayload,
} from '@deckord/ipc-contract';
import type { Logger } from '@deckord/shared';
import type { DeckordConfig } from './index';
import { mergeSettings, settingsFromConfig, type SettingsStore } from './settings';
import { SECRET_KEYS, SecretStoreTokenStore, type SecretStore } from '../secrets/SecretStore';

type ConfigMessage = Extract<ServiceToClientMessage, { type: 'config' }>;
type Client = { send: (message: ServiceToClientMessage) => void };

export type ConfigControllerDeps = {
  /** The config the running service actually loaded (for reporting current state). */
  config: DeckordConfig;
  settings: SettingsStore;
  secrets: SecretStore;
  broadcast: (message: ServiceToClientMessage) => void;
  providerKind: () => 'discord-rpc' | 'mock';
  restart: () => Promise<void>;
  log: Logger;
};

/**
 * Handles the config-domain WS messages (Phase 9): report the effective settings
 * (with secret presence flags only), persist edits, and trigger "restart to
 * apply". It NEVER sends secret values back to the UI.
 */
export class ConfigController {
  /** True once a saved change is waiting for a restart to take effect. */
  private pendingRestart = false;
  /** Serialize handling so e.g. a Save-then-Connect burst is applied in order. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ConfigControllerDeps) {}

  handle(message: ConfigClientMessage, client: Client): Promise<void> {
    this.queue = this.queue.then(() => this.process(message, client));
    return this.queue;
  }

  private async process(message: ConfigClientMessage, client: Client): Promise<void> {
    try {
      switch (message.type) {
        case 'get_config':
          client.send(await this.buildConfigMessage());
          break;
        case 'set_config':
          await this.applySet(message.payload);
          // Broadcast so every connected UI reflects the saved (pending) state.
          this.deps.broadcast(await this.buildConfigMessage());
          break;
        case 'connect_discord':
          await this.deps.settings.patch({ provider: 'discord-rpc' });
          await this.deps.restart();
          break;
        case 'restart_service':
          await this.deps.restart();
          break;
      }
    } catch (error) {
      this.deps.log.warn(`config message '${message.type}' failed: ${String(error)}`);
      this.deps.broadcast({
        type: 'status',
        payload: {
          level: 'error',
          message: `Failed to apply configuration: ${String(error)}`,
          code: 'CONFIG_INVALID',
        },
      });
    }
  }

  /** Push the current config to a single (usually newly-connected) client. */
  async sendTo(client: Client): Promise<void> {
    client.send(await this.buildConfigMessage());
  }

  private async applySet(payload: SetConfigPayload): Promise<void> {
    let changed = false;

    const incoming = payload.settings ? this.stripMaskedWsToken(payload.settings) : undefined;
    if (incoming && Object.keys(incoming).length > 0) {
      await this.deps.settings.patch(incoming);
      changed = true;
    }

    const s = payload.secrets;
    if (s) {
      if (s.clientSecret !== undefined) {
        // Empty string clears the secret; any other value stores it.
        if (s.clientSecret === '') await this.deps.secrets.delete(SECRET_KEYS.clientSecret);
        else await this.deps.secrets.set(SECRET_KEYS.clientSecret, s.clientSecret);
        changed = true;
      }
      if (s.clearToken) {
        await this.deps.secrets.delete(SECRET_KEYS.token);
        changed = true;
      }
      if (s.accessToken !== undefined && s.accessToken !== '') {
        // A pasted access token replaces only the access token, preserving any
        // existing refresh token / scopes / expiry rather than wiping them.
        const store = new SecretStoreTokenStore(this.deps.secrets);
        const existing = await store.load();
        await store.save({
          ...existing,
          accessToken: s.accessToken,
          scopes: existing?.scopes ?? [...MVP_SCOPES],
        });
        changed = true;
      }
    }

    if (changed) this.pendingRestart = true;
  }

  /** The WS shared token is a secret; never round-trip its real value to the UI. */
  private static readonly WS_TOKEN_MASK = '***';

  private async buildConfigMessage(): Promise<ConfigMessage> {
    // Show the persisted (possibly pending) settings so the UI reflects saved edits
    // immediately, even before a restart applies them to the running pipeline.
    const effective = mergeSettings(
      settingsFromConfig(this.deps.config),
      await this.deps.settings.load(),
    );
    // Never send the WS shared token's real value to the UI (matches diagnostics).
    if (effective.ws?.token) {
      effective.ws = { ...effective.ws, token: ConfigController.WS_TOKEN_MASK };
    }
    const payload: ConfigPayload = {
      settings: effective,
      secrets: {
        // Presence is reported from the live secret store only, so clearing a
        // secret is reflected immediately (not stuck true until a restart).
        hasClientSecret: await this.deps.secrets.has(SECRET_KEYS.clientSecret),
        hasToken: await this.deps.secrets.has(SECRET_KEYS.token),
      },
      runtime: {
        provider: this.deps.providerKind(),
        restartRequired: this.pendingRestart,
        dataDir: this.deps.config.dataDir,
      },
    };
    return { type: 'config', payload };
  }

  /** Drop a masked WS token from an incoming settings patch so it never persists. */
  private stripMaskedWsToken(settings: SetConfigPayload['settings']): SetConfigPayload['settings'] {
    if (settings?.ws?.token !== ConfigController.WS_TOKEN_MASK) return settings;
    const { token: _masked, ...ws } = settings.ws;
    return { ...settings, ws };
  }
}
