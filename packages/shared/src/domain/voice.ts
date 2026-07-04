/**
 * Normalized voice-domain types. These are provider-agnostic: the Discord RPC
 * provider and the mock provider both emit exactly these shapes, so nothing
 * downstream (deck-core, renderer, adapters, UI) knows where the data came from.
 */

export type VoiceProviderKind = 'discord-rpc' | 'mock';

export type VoiceUser = {
  userId: string;
  username: string;
  displayName: string;

  avatarHash?: string;
  avatarUrl?: string;
  avatarLocalPath?: string;

  isSpeaking: boolean;

  selfMute: boolean;
  serverMute: boolean;
  selfDeaf: boolean;
  serverDeaf: boolean;
  suppress: boolean;

  volume?: number;
};

export type VoiceChannelState = {
  provider: VoiceProviderKind;
  connected: boolean;
  channelId: string | null;
  channelName: string | null;
  guildId?: string | null;
  guildName?: string | null;
  users: VoiceUser[];
  updatedAt: number;
};

/** Convenience: is this user muted in any way (self or server)? */
export function isUserMuted(user: VoiceUser): boolean {
  return user.selfMute || user.serverMute;
}

/** Convenience: is this user deafened in any way (self or server)? */
export function isUserDeafened(user: VoiceUser): boolean {
  return user.selfDeaf || user.serverDeaf;
}
