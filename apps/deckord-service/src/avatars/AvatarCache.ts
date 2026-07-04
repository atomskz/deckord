import type { AvatarResolver } from '@deckord/renderer';
import { createLogger, type Logger, type VoiceUser } from '@deckord/shared';

/**
 * Resolves avatar sources for the renderer.
 *
 * MVP: returns whatever URL/local path the provider already supplied (Discord
 * CDN URL, or nothing → the UI draws an initials placeholder). Phase 5 will add
 * real downloading + on-disk caching + data-URL generation for physical decks;
 * that lives behind this same `resolve` resolver so nothing upstream changes.
 */
export class AvatarCache {
  private readonly log: Logger;

  constructor(logger: Logger = createLogger('avatars')) {
    this.log = logger;
  }

  readonly resolve: AvatarResolver = (user: VoiceUser): string | undefined => {
    return user.avatarUrl ?? user.avatarLocalPath;
  };

  /** Placeholder for Phase 5: fetch + cache to disk, then return a local path. */
  async prefetch(_user: VoiceUser): Promise<void> {
    /* not implemented in MVP */
  }
}
