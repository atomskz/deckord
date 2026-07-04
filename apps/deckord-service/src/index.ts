/**
 * Public API of the Deckord service, so an embedder (the Electron desktop shell)
 * can run the whole pipeline in-process instead of spawning the CLI. The headless
 * entry point is still main.ts; this barrel exposes the pieces a host wires up:
 * a ServiceRunner + the settings/secret stores.
 */
export { ServiceRunner } from './ServiceRunner';
export { DeckordService, type DeckordServiceDeps } from './DeckordService';
export {
  loadConfig,
  resolveInitialProvider,
  type DeckordConfig,
  type ProviderPreference,
} from './config/index';
export {
  FileSettingsStore,
  MemorySettingsStore,
  mergeConfig,
  mergeSettings,
  settingsFromConfig,
  settingsPath,
  type SettingsStore,
} from './config/settings';
export {
  FileSecretStore,
  MemorySecretStore,
  SecretStoreTokenStore,
  SECRET_KEYS,
  secretsPath,
  withStoredClientSecret,
  type SecretStore,
} from './secrets/SecretStore';
export { configureLogging, type Logger } from './logging/index';
