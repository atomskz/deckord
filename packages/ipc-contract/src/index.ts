import { DeckordError, err, ok, type Result } from '@deckord/shared';
import {
  ClientToServiceMessageSchema,
  ServiceToClientMessageSchema,
} from './schemas';
import type { ClientToServiceMessage, ServiceToClientMessage } from './messages';

export * from './schemas';
export * from './messages';
export * from './types';

/** Serialize a message for transport. */
export function encode(message: ServiceToClientMessage | ClientToServiceMessage): string {
  return JSON.stringify(message);
}

function parseJson(raw: string): Result<unknown, DeckordError> {
  try {
    return ok(JSON.parse(raw) as unknown);
  } catch (cause) {
    return err(new DeckordError('IPC_MESSAGE_INVALID', 'Message is not valid JSON', { cause }));
  }
}

/** Validate a raw string as a client → service message. */
export function decodeClientMessage(raw: string): Result<ClientToServiceMessage, DeckordError> {
  const json = parseJson(raw);
  if (!json.ok) return json;
  const parsed = ClientToServiceMessageSchema.safeParse(json.value);
  if (!parsed.success) {
    return err(new DeckordError('IPC_MESSAGE_INVALID', parsed.error.message, { cause: parsed.error }));
  }
  return ok(parsed.data);
}

/** Validate a raw string as a service → client message. */
export function decodeServiceMessage(raw: string): Result<ServiceToClientMessage, DeckordError> {
  const json = parseJson(raw);
  if (!json.ok) return json;
  const parsed = ServiceToClientMessageSchema.safeParse(json.value);
  if (!parsed.success) {
    return err(new DeckordError('IPC_MESSAGE_INVALID', parsed.error.message, { cause: parsed.error }));
  }
  return ok(parsed.data);
}
