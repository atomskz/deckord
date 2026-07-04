import { DeckordError, createLogger, type Logger } from '@deckord/shared';
import type { DiscordRpcClient } from './DiscordRpcClient';
import {
  exchangeCodeForToken,
  isTokenValid,
  refreshAccessToken,
  type TokenStore,
} from './DiscordAuth';
import type { DiscordRpcConfig } from './types';

/**
 * Turns an already-handshaken RPC client into an authenticated one, acquiring an
 * access token by the cheapest available means:
 *
 *   1. an explicit `config.accessToken` (documented "fast path" — no app secret);
 *   2. a valid token from the store;
 *   3. a refresh of a stored (but expiring) token;
 *   4. a full interactive `AUTHORIZE` → code → token exchange, persisted to the store.
 *
 * The service calls `client.authenticate(token)` with whatever this returns.
 */
export class DiscordAuthenticator {
  private readonly log: Logger;

  constructor(
    private readonly config: DiscordRpcConfig,
    private readonly store: TokenStore,
    logger: Logger = createLogger('discord-auth'),
  ) {
    this.log = logger;
  }

  async acquire(client: DiscordRpcClient): Promise<string> {
    // 1. Explicit token (fast path / future-supported).
    if (this.config.accessToken) {
      this.log.debug('Using DISCORD_ACCESS_TOKEN from config');
      return this.config.accessToken;
    }

    // 2 & 3. Stored token, refreshing if it is expiring.
    const stored = await this.store.load();
    if (stored && isTokenValid(stored)) {
      this.log.debug('Using stored Discord token');
      return stored.accessToken;
    }
    if (stored?.refreshToken && this.config.clientSecret) {
      try {
        this.log.info('Refreshing Discord token');
        const refreshed = await refreshAccessToken(this.config, stored.refreshToken);
        await this.store.save(refreshed);
        return refreshed.accessToken;
      } catch (error) {
        this.log.warn(`Token refresh failed, re-authorizing: ${String(error)}`);
      }
    }

    // 4. Full interactive authorization.
    if (!this.config.clientSecret) {
      throw new DeckordError(
        'DISCORD_AUTH_REQUIRED',
        'No valid token and no DISCORD_CLIENT_SECRET for interactive AUTHORIZE. Set DISCORD_CLIENT_SECRET (and register the app) or supply DISCORD_ACCESS_TOKEN.',
      );
    }
    this.log.info('Starting interactive Discord AUTHORIZE (approve the prompt in the Discord client)…');
    const code = await client.authorize(this.config.scopes);
    const token = await exchangeCodeForToken(this.config, code);
    await this.store.save(token);
    this.log.info('Discord authorization complete; token stored');
    return token.accessToken;
  }
}
