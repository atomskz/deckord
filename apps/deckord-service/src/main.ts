import { loadConfig } from './config/index';
import { FileSettingsStore, mergeConfig, settingsPath } from './config/settings';
import { configureLogging } from './logging/index';
import { DeckordService } from './DeckordService';

async function main(): Promise<void> {
  // Base config from environment defaults, overlaid with the persisted settings.json
  // the config UI writes (Phase 9), so configuration survives restarts.
  const base = loadConfig();
  const settingsStore = new FileSettingsStore(settingsPath(base.dataDir));
  const config = mergeConfig(base, await settingsStore.load());
  const log = configureLogging(config.logLevel);

  log.info(`Starting ${config.appName} service (provider preference: ${config.provider})`);

  const service = new DeckordService(config, log);
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
