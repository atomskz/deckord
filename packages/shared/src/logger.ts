/**
 * Minimal structured logger. Browser-safe (no direct `process` access) so the
 * same package can be imported by the service and, type-only, by the UI.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let activeLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  activeLevel = level;
}

export function getLogLevel(): LogLevel {
  return activeLevel;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  child(scope: string): Logger;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[activeLevel];
}

function emit(scope: string, level: LogLevel, message: string, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const prefix = `[${level.toUpperCase()}]${scope ? ` [${scope}]` : ''}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(`${prefix} ${message}`, ...args);
}

export function createLogger(scope = ''): Logger {
  return {
    debug: (message, ...args) => emit(scope, 'debug', message, args),
    info: (message, ...args) => emit(scope, 'info', message, args),
    warn: (message, ...args) => emit(scope, 'warn', message, args),
    error: (message, ...args) => emit(scope, 'error', message, args),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}
