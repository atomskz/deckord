import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DeckordError } from '@deckord/shared';
import type { DiscordRpcConfig } from './types';

export type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
};

export interface TokenStore {
  load(): Promise<StoredToken | null>;
  save(token: StoredToken): Promise<void>;
  clear(): Promise<void>;
}

/**
 * File-backed token store. MVP writes plaintext JSON locally; this is called out
 * in docs/security. Phase 9 replaces this with an OS-secured store (Windows DPAPI
 * / Credential Manager, macOS Keychain, libsecret) behind this same interface.
 */
export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<StoredToken | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as StoredToken;
    } catch {
      return null;
    }
  }

  async save(token: StoredToken): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(token, null, 2), { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

/** In-memory store — handy for tests and ephemeral prototypes. */
export class MemoryTokenStore implements TokenStore {
  private token: StoredToken | null = null;
  async load(): Promise<StoredToken | null> {
    return this.token;
  }
  async save(token: StoredToken): Promise<void> {
    this.token = token;
  }
  async clear(): Promise<void> {
    this.token = null;
  }
}

const TOKEN_ENDPOINT = 'https://discord.com/api/oauth2/token';
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1/callback';

/**
 * OAuth2 authorization-code → token exchange. The RPC `AUTHORIZE` command yields
 * a `code`; this exchanges it for tokens using the client secret. It runs on the
 * trusted local service (never in a browser client), so holding the secret here
 * is acceptable for the prototype (Phase 9 moves to an OS-secured store).
 */
export async function exchangeCodeForToken(
  config: DiscordRpcConfig,
  code: string,
): Promise<StoredToken> {
  if (!config.clientSecret) {
    throw new DeckordError('DISCORD_AUTH_FAILED', 'DISCORD_CLIENT_SECRET is required for the token exchange');
  }
  return requestToken(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri ?? DEFAULT_REDIRECT_URI,
  });
}

/** Refresh an access token using a stored refresh token. */
export async function refreshAccessToken(
  config: DiscordRpcConfig,
  refreshToken: string,
): Promise<StoredToken> {
  if (!config.clientSecret) {
    throw new DeckordError('DISCORD_AUTH_FAILED', 'DISCORD_CLIENT_SECRET is required to refresh the token');
  }
  return requestToken(config, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

/** True if the token exists and is not within `marginMs` of expiry. */
export function isTokenValid(token: StoredToken, marginMs = 60_000): boolean {
  if (!token.accessToken) return false;
  if (token.expiresAt === undefined) return true;
  return token.expiresAt - Date.now() > marginMs;
}

async function requestToken(
  config: DiscordRpcConfig,
  grant: Record<string, string>,
): Promise<StoredToken> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret ?? '',
    ...grant,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new DeckordError(
      'DISCORD_AUTH_FAILED',
      `Discord token endpoint returned ${response.status} ${response.statusText}: ${detail}`,
    );
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    scopes: json.scope ? json.scope.split(' ') : [],
  };
}
