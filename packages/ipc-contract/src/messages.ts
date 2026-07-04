import type { z } from 'zod';
import type {
  ClientToServiceMessageSchema,
  MockCommandSchema,
  ServiceToClientMessageSchema,
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

/** service → debug UI. */
export type ServiceToClientMessage = z.infer<typeof ServiceToClientMessageSchema>;

/** debug UI → service. */
export type ClientToServiceMessage = z.infer<typeof ClientToServiceMessageSchema>;

export type ServiceToClientType = ServiceToClientMessage['type'];
export type ClientToServiceType = ClientToServiceMessage['type'];
