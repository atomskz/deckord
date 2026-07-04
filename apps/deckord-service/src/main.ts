import { loadConfig } from './config/index';
import { configureLogging } from './logging/index';
import { DeckordService } from './DeckordService';

async function main(): Promise<void> {
  const config = loadConfig();
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
