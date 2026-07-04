/**
 * Deckord's typed error surface. Every recoverable condition the service can hit
 * (see docs/architecture.md "Error handling") maps to a stable code so the debug
 * UI and logs can react without string-matching messages.
 */

export type DeckordErrorCode =
  | 'DISCORD_NOT_RUNNING'
  | 'DISCORD_IPC_NOT_FOUND'
  | 'DISCORD_AUTH_REQUIRED'
  | 'DISCORD_AUTH_FAILED'
  | 'DISCORD_SCOPES_UNAVAILABLE'
  | 'NO_SELECTED_VOICE_CHANNEL'
  | 'AVATAR_DOWNLOAD_FAILED'
  | 'WEBSOCKET_DISCONNECTED'
  | 'DEBUG_UI_DISCONNECTED'
  | 'PROVIDER_SWITCHED_TO_MOCK'
  | 'IPC_MESSAGE_INVALID'
  | 'CONFIG_INVALID'
  | 'UNKNOWN';

export type ErrorPayload = {
  code: DeckordErrorCode;
  message: string;
};

export class DeckordError extends Error {
  readonly code: DeckordErrorCode;

  constructor(code: DeckordErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DeckordError';
    this.code = code;
  }

  toPayload(): ErrorPayload {
    return { code: this.code, message: this.message };
  }
}

export function isDeckordError(value: unknown): value is DeckordError {
  return value instanceof DeckordError;
}

/** Normalize any thrown value into a DeckordError so callers get a stable shape. */
export function toDeckordError(value: unknown, fallbackCode: DeckordErrorCode = 'UNKNOWN'): DeckordError {
  if (value instanceof DeckordError) return value;
  if (value instanceof Error) return new DeckordError(fallbackCode, value.message, { cause: value });
  return new DeckordError(fallbackCode, String(value));
}
