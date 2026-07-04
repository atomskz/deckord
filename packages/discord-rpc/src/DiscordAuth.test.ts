import { describe, expect, it } from 'vitest';
import {
  exchangeCodeForToken,
  isTokenValid,
  refreshAccessToken,
  MemoryTokenStore,
  type StoredToken,
} from './DiscordAuth';
import { MVP_SCOPES, type DiscordRpcConfig } from './types';

const baseConfig: DiscordRpcConfig = {
  clientId: 'client-123',
  scopes: MVP_SCOPES,
};

describe('isTokenValid', () => {
  it('rejects a token without an access token', () => {
    expect(isTokenValid({ accessToken: '', scopes: [] })).toBe(false);
  });

  it('treats a token with no expiry as valid', () => {
    expect(isTokenValid({ accessToken: 'a', scopes: [] })).toBe(true);
  });

  it('accepts a token expiring comfortably in the future', () => {
    const token: StoredToken = { accessToken: 'a', scopes: [], expiresAt: Date.now() + 3_600_000 };
    expect(isTokenValid(token)).toBe(true);
  });

  it('rejects an expired token', () => {
    const token: StoredToken = { accessToken: 'a', scopes: [], expiresAt: Date.now() - 1000 };
    expect(isTokenValid(token)).toBe(false);
  });

  it('rejects a token within the expiry margin', () => {
    const token: StoredToken = { accessToken: 'a', scopes: [], expiresAt: Date.now() + 30_000 };
    expect(isTokenValid(token, 60_000)).toBe(false);
  });
});

describe('token exchange without a client secret', () => {
  it('exchangeCodeForToken throws DISCORD_AUTH_FAILED', async () => {
    await expect(exchangeCodeForToken(baseConfig, 'code')).rejects.toMatchObject({
      code: 'DISCORD_AUTH_FAILED',
    });
  });

  it('refreshAccessToken throws DISCORD_AUTH_FAILED', async () => {
    await expect(refreshAccessToken(baseConfig, 'refresh')).rejects.toMatchObject({
      code: 'DISCORD_AUTH_FAILED',
    });
  });
});

describe('MemoryTokenStore', () => {
  it('round-trips and clears a token', async () => {
    const store = new MemoryTokenStore();
    expect(await store.load()).toBeNull();
    const token: StoredToken = { accessToken: 'a', refreshToken: 'r', scopes: ['rpc'] };
    await store.save(token);
    expect(await store.load()).toEqual(token);
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
