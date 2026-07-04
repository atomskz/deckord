import { loadConfig } from './config/index';
import { FileSettingsStore, mergeConfig, settingsPath } from './config/settings';
import { FileSecretStore, secretsPath } from './secrets/SecretStore';
import { configureLogging } from './logging/index';
import { ServiceRunner } from './ServiceRunner';

async function main(): Promise<void> {
  // Base config from environment defaults; the persisted settings.json overlay and
  // stored secrets are applied by ServiceRunner (which also owns "restart to apply").
  const base = loadConfig();
  const settingsStore = new FileSettingsStore(settingsPath(base.dataDir));
  const secretStore = new FileSecretStore(secretsPath(base.dataDir));

  const initialLevel = mergeConfig(base, await settingsStore.load()).logLevel;
  const log = configureLogging(initialLevel);
  log.info(`Starting ${base.appName} service…`);

  const runner = new ServiceRunner(log, settingsStore, secretStore);
  await runner.start();

  const shutdown = (signal: string) => {
    log.info(`Received ${signal}, shutting down…`);
    void runner.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[FATAL] Deckord service failed to start:', error);
  process.exit(1);
});
