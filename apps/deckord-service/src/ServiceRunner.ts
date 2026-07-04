import { setLogLevel, type Logger } from '@deckord/shared';
import { loadConfig, type DeckordConfig } from './config/index';
import { mergeConfig, type SettingsStore } from './config/settings';
import { SecretStoreTokenStore, withStoredClientSecret, type SecretStore } from './secrets/SecretStore';
import { DeckordService } from './DeckordService';

/**
 * Owns the DeckordService lifecycle and can rebuild it from the persisted stores.
 * "Restart to apply" (a config change or Connect Discord) goes through here: the
 * running service is stopped and a fresh one is constructed with the latest
 * settings + secrets. The config UI's WebSocket drops briefly and auto-reconnects.
 *
 * This is the single restart seam shared by the headless `main` and the Electron
 * shell — the shell reuses it verbatim so tray/menu restarts behave identically.
 */
export class ServiceRunner {
  private service: DeckordService | null = null;
  private restarting = false;

  constructor(
    private readonly log: Logger,
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore,
    /** Env-derived base config; overridable for tests. */
    private readonly loadBase: () => DeckordConfig = () => loadConfig(),
  ) {}

  async start(): Promise<void> {
    await this.build();
  }

  async stop(): Promise<void> {
    await this.service?.stop();
    this.service = null;
  }

  /** Stop and rebuild with the latest persisted config. Re-entrancy-guarded. */
  readonly restart = async (): Promise<void> => {
    if (this.restarting) return;
    this.restarting = true;
    try {
      this.log.info('Restarting service to apply configuration…');
      await this.service?.stop();
      await this.build();
    } finally {
      this.restarting = false;
    }
  };

  private async build(): Promise<void> {
    const config = await withStoredClientSecret(
      mergeConfig(this.loadBase(), await this.settings.load()),
      this.secrets,
    );
    setLogLevel(config.logLevel);
    this.service = new DeckordService(config, this.log, {
      tokenStore: new SecretStoreTokenStore(this.secrets),
      settingsStore: this.settings,
      secretStore: this.secrets,
      onRestart: this.restart,
    });
    await this.service.start();
  }
}
