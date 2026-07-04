import { describe, expect, it, vi } from 'vitest';
import { DiscordAuthenticator } from './DiscordAuthenticator';
import { MemoryTokenStore, type StoredToken } from './DiscordAuth';
import type { DiscordRpcClient } from './DiscordRpcClient';
import { MVP_SCOPES, type DiscordRpcConfig } from './types';

const config = (overrides: Partial<DiscordRpcConfig> = {}): DiscordRpcConfig => ({
  clientId: 'client-123',
  scopes: MVP_SCOPES,
  ...overrides,
});

/** A client stub whose authorize() fails the test if it is unexpectedly called. */
function clientThatMustNotAuthorize(): DiscordRpcClient {
  return {
    authorize: vi.fn(() => {
      throw new Error('authorize should not be called');
    }),
  } as unknown as DiscordRpcClient;
}

describe('DiscordAuthenticator.acquire', () => {
  it('uses an explicit accessToken (fast path) without touching the client', async () => {
    const auth = new DiscordAuthenticator(
      config({ accessToken: 'explicit-token' }),
      new MemoryTokenStore(),
    );
    await expect(auth.acquire(clientThatMustNotAuthorize())).resolves.toBe('explicit-token');
  });

  it('uses a valid stored token without re-authorizing', async () => {
    const store = new MemoryTokenStore();
    const stored: StoredToken = {
      accessToken: 'stored-token',
      scopes: ['rpc'],
      expiresAt: Date.now() + 3_600_000,
    };
    await store.save(stored);
    const auth = new DiscordAuthenticator(config(), store);
    await expect(auth.acquire(clientThatMustNotAuthorize())).resolves.toBe('stored-token');
  });

  it('throws DISCORD_AUTH_REQUIRED when no token and no client secret', async () => {
    const auth = new DiscordAuthenticator(config(), new MemoryTokenStore());
    await expect(auth.acquire(clientThatMustNotAuthorize())).rejects.toMatchObject({
      code: 'DISCORD_AUTH_REQUIRED',
    });
  });

  it('runs the full AUTHORIZE → exchange flow is guarded by the secret (no secret → no authorize call)', async () => {
    const client = clientThatMustNotAuthorize();
    const auth = new DiscordAuthenticator(config(), new MemoryTokenStore());
    await expect(auth.acquire(client)).rejects.toBeDefined();
    expect(client.authorize).not.toHaveBeenCalled();
  });
});
