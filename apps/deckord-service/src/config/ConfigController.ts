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

  constructor(private readonly deps: ConfigControllerDeps) {}

  async handle(message: ConfigClientMessage, client: Client): Promise<void> {
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

    if (payload.settings && Object.keys(payload.settings).length > 0) {
      await this.deps.settings.patch(payload.settings);
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
        // A pasted access token is stored as a StoredToken so the auth flow uses it.
        await new SecretStoreTokenStore(this.deps.secrets).save({
          accessToken: s.accessToken,
          scopes: [...MVP_SCOPES],
        });
        changed = true;
      }
    }

    if (changed) this.pendingRestart = true;
  }

  private async buildConfigMessage(): Promise<ConfigMessage> {
    // Show the persisted (possibly pending) settings so the UI reflects saved edits
    // immediately, even before a restart applies them to the running pipeline.
    const effective = mergeSettings(
      settingsFromConfig(this.deps.config),
      await this.deps.settings.load(),
    );
    const payload: ConfigPayload = {
      settings: effective,
      secrets: {
        hasClientSecret:
          Boolean(this.deps.config.discord.clientSecret) ||
          (await this.deps.secrets.has(SECRET_KEYS.clientSecret)),
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
}
