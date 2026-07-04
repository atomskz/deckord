import type { VoiceUser } from '@deckord/shared';
import type { RenderTheme } from './themes';

/** Resolves the best avatar source (URL or data URL) for a user, if any. */
export type AvatarResolver = (user: VoiceUser) => string | undefined;

/**
 * Everything the renderer needs to turn a logical layout into a presentational
 * one. The service supplies the current users, an avatar resolver (backed by the
 * avatar cache) and a theme.
 */
export type RenderContext = {
  users: Map<string, VoiceUser>;
  theme: RenderTheme;
  resolveAvatar?: AvatarResolver;
  channelName?: string | null;
  appName?: string;
};
