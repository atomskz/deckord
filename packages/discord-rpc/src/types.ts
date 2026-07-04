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

export type RawVoiceState = {
  nick?: string;
  mute: boolean;
  deaf: boolean;
  self_mute: boolean;
  self_deaf: boolean;
  suppress: boolean;
  user: RawDiscordUser;
  volume?: number;
};

export function discordAvatarUrl(userId: string, avatarHash: string | null | undefined): string | undefined {
  if (!avatarHash) return undefined;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
}

/** Normalize a raw RPC voice state into Deckord's provider-agnostic VoiceUser. */
export function normalizeVoiceState(raw: RawVoiceState, isSpeaking = false): VoiceUser {
  const displayName = raw.nick || raw.user.global_name || raw.user.username;
  return {
    userId: raw.user.id,
    username: raw.user.username,
    displayName,
    avatarHash: raw.user.avatar ?? undefined,
    avatarUrl: discordAvatarUrl(raw.user.id, raw.user.avatar),
    isSpeaking,
    selfMute: raw.self_mute,
    serverMute: raw.mute,
    selfDeaf: raw.self_deaf,
    serverDeaf: raw.deaf,
    suppress: raw.suppress,
    volume: raw.volume,
  };
}
