import type { VoiceUser } from '@deckord/shared';

/** Discord IPC frame opcodes. */
export enum RpcOpcode {
  Handshake = 0,
  Frame = 1,
  Close = 2,
  Ping = 3,
  Pong = 4,
}

/** RPC commands we may issue (read-only subset for the MVP). */
export const RPC_COMMANDS = {
  AUTHORIZE: 'AUTHORIZE',
  AUTHENTICATE: 'AUTHENTICATE',
  GET_SELECTED_VOICE_CHANNEL: 'GET_SELECTED_VOICE_CHANNEL',
  GET_CHANNEL: 'GET_CHANNEL',
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
} as const;
export type RpcCommand = (typeof RPC_COMMANDS)[keyof typeof RPC_COMMANDS];

/** RPC events we subscribe to. */
export const RPC_EVENTS = {
  READY: 'READY',
  ERROR: 'ERROR',
  VOICE_CHANNEL_SELECT: 'VOICE_CHANNEL_SELECT',
  VOICE_STATE_CREATE: 'VOICE_STATE_CREATE',
  VOICE_STATE_UPDATE: 'VOICE_STATE_UPDATE',
  VOICE_STATE_DELETE: 'VOICE_STATE_DELETE',
  SPEAKING_START: 'SPEAKING_START',
  SPEAKING_STOP: 'SPEAKING_STOP',
} as const;
export type RpcEvent = (typeof RPC_EVENTS)[keyof typeof RPC_EVENTS];

/** Minimal read-only scopes required for the MVP. NEVER request rpc.voice.write. */
export const MVP_SCOPES = ['identify', 'rpc', 'rpc.voice.read'] as const;

export type DiscordRpcConfig = {
  clientId: string;
  /** Only needed for the OAuth token exchange (Phase 4+). Never ship this in the client. */
  clientSecret?: string;
  scopes: readonly string[];
  redirectUri?: string;
  /** Optional pre-obtained access token to skip the AUTHORIZE step. */
  accessToken?: string;
};

export type RpcConnectionState =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'authenticating'
  | 'ready'
  | 'error'
  | 'closed';

// ---------------------------------------------------------------------------
// Raw Discord payloads (partial — only what we consume) and normalization
// ---------------------------------------------------------------------------

export type RawDiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string;
  avatar?: string | null;
  bot?: boolean;
};

/**
 * The mute/deaf flags Discord actually nests under `voice_state` on each voice
 * participant (confirmed against a live client — they are NOT top-level).
 */
export type RawVoiceStateFlags = {
  mute?: boolean;
  deaf?: boolean;
  self_mute?: boolean;
  self_deaf?: boolean;
  suppress?: boolean;
};

export type RawVoiceState = {
  nick?: string;
  /** Nested flags (canonical). Top-level mute/deaf are kept as a legacy fallback. */
  voice_state?: RawVoiceStateFlags;
  mute?: boolean;
  deaf?: boolean;
  self_mute?: boolean;
  self_deaf?: boolean;
  suppress?: boolean;
  user: RawDiscordUser;
  volume?: number;
};

export function discordAvatarUrl(userId: string, avatarHash: string | null | undefined): string | undefined {
  if (!avatarHash) return undefined;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
}

/**
 * Normalize a raw RPC voice state into Deckord's provider-agnostic VoiceUser.
 * Reads the flags from `voice_state` (with a top-level legacy fallback) and
 * defaults every boolean to `false`, so a missing field never produces an
 * `undefined` that would fail the wire schema.
 */
export function normalizeVoiceState(raw: RawVoiceState, isSpeaking = false): VoiceUser {
  const displayName = raw.nick || raw.user.global_name || raw.user.username;
  const vs = raw.voice_state ?? {};
  return {
    userId: raw.user.id,
    username: raw.user.username,
    displayName,
    avatarHash: raw.user.avatar ?? undefined,
    avatarUrl: discordAvatarUrl(raw.user.id, raw.user.avatar),
    isSpeaking,
    selfMute: vs.self_mute ?? raw.self_mute ?? false,
    serverMute: vs.mute ?? raw.mute ?? false,
    selfDeaf: vs.self_deaf ?? raw.self_deaf ?? false,
    serverDeaf: vs.deaf ?? raw.deaf ?? false,
    suppress: vs.suppress ?? raw.suppress ?? false,
    volume: raw.volume,
  };
}
