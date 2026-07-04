import { loadConfig } from './config/index';
import { FileSettingsStore, mergeConfig, settingsPath } from './config/settings';
import { FileSecretStore, SecretStoreTokenStore, secretsPath, withStoredClientSecret } from './secrets/SecretStore';
import { configureLogging } from './logging/index';
import { DeckordService } from './DeckordService';

async function main(): Promise<void> {
  // Base config from environment defaults, overlaid with the persisted settings.json
  // the config UI writes (Phase 9), then the stored client secret injected on top.
  const base = loadConfig();
  const settingsStore = new FileSettingsStore(settingsPath(base.dataDir));
  const secretStore = new FileSecretStore(secretsPath(base.dataDir));
  const config = await withStoredClientSecret(mergeConfig(base, await settingsStore.load()), secretStore);
  const log = configureLogging(config.logLevel);

  log.info(`Starting ${config.appName} service (provider preference: ${config.provider})`);

  // Persist the OAuth token through the secret store (0600 here; OS-secured in the
  // Electron shell) instead of FileTokenStore's plaintext JSON.
  const service = new DeckordService(config, log, {
    tokenStore: new SecretStoreTokenStore(secretStore),
  });
  await service.start();

  const shutdown = (signal: string) => {
    log.info(`Received ${signal}, shutting down…`);
    void service.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[FATAL] Deckord service failed to start:', error);
  process.exit(1);
});
