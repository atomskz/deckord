import { createLogger, setLogLevel, type Logger, type LogLevel } from '@deckord/shared';

export function configureLogging(level: LogLevel): Logger {
  setLogLevel(level);
  return createLogger('deckord');
}

export type { Logger };
