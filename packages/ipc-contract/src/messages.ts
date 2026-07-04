import type { z } from 'zod';
import type {
  ClientToServiceMessageSchema,
  ConfigPayloadSchema,
  DeckordSettingsSchema,
  LogLevelSchema,
  MockCommandSchema,
  ProviderPreferenceSchema,
  ServiceToClientMessageSchema,
  SetConfigPayloadSchema,
  StatusLevelSchema,
} from './schemas';

/** Bumped whenever the wire protocol changes in a breaking way. */
export const IPC_PROTOCOL_VERSION = 1;

/** Default loopback endpoint for the local WebSocket API. */
export const DEFAULT_WS_HOST = '127.0.0.1';
export const DEFAULT_WS_PORT = 8787;
export const DEFAULT_WS_PATH = '/deck';

export type StatusLevel = z.infer<typeof StatusLevelSchema>;
export type MockCommand = z.infer<typeof MockCommandSchema>;

/** Config domain (Phase 9). */
export type LogLevelWire = z.infer<typeof LogLevelSchema>;
export type ProviderPreferenceWire = z.infer<typeof ProviderPreferenceSchema>;
export type DeckordSettings = z.infer<typeof DeckordSettingsSchema>;
export type ConfigPayload = z.infer<typeof ConfigPayloadSchema>;
export type SetConfigPayload = z.infer<typeof SetConfigPayloadSchema>;

/** service → debug UI. */
export type ServiceToClientMessage = z.infer<typeof ServiceToClientMessageSchema>;

/** debug UI → service. */
export type ClientToServiceMessage = z.infer<typeof ClientToServiceMessageSchema>;

export type ServiceToClientType = ServiceToClientMessage['type'];
export type ClientToServiceType = ClientToServiceMessage['type'];

/** The config-domain subset of client → service messages (Phase 9). */
export type ConfigClientMessage = Extract<
  ClientToServiceMessage,
  { type: 'get_config' | 'set_config' | 'connect_discord' | 'restart_service' }
>;
