import os from 'node:os';
import path from 'node:path';
import { DEFAULT_WS_HOST, DEFAULT_WS_PATH, DEFAULT_WS_PORT } from '@deckord/ipc-contract';
import { MVP_SCOPES, type DiscordRpcConfig } from '@deckord/discord-rpc';
import type { LogLevel } from '@deckord/shared';

export type ProviderPreference = 'auto' | 'mock' | 'discord-rpc';

export type DeckordConfig = {
  appName: string;
  logLevel: LogLevel;
  provider: ProviderPreference;
  ws: {
    host: string;
    port: number;
    path: string;
    /** Optional shared secret required as `?token=` when connecting. */
    token?: string;
  };
  discord: DiscordRpcConfig;
  /** Where the Discord OAuth token is persisted (Phase 9 → OS-secured store). */
  discordTokenPath: string;
  /** Directory where downloaded avatars are cached. */
  avatarCacheDir: string;
  mock: {
    autoStart: boolean;
    initialUsers: number;
    speakingIntervalMs: number;
  };
};

function num(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function logLevel(value: string | undefined): LogLevel {
  return value === 'debug' || value === 'warn' || value === 'error' ? value : 'info';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DeckordConfig {
  const clientId = env.DISCORD_CLIENT_ID ?? '';
  const accessToken = env.DISCORD_ACCESS_TOKEN;

  const preference = (env.DECKORD_PROVIDER as ProviderPreference | undefined) ?? 'auto';

  const dataDir = env.DECKORD_DATA_DIR ?? path.join(os.homedir(), '.deckord');

  return {
    appName: env.DECKORD_APP_NAME ?? 'Deckord',
    logLevel: logLevel(env.DECKORD_LOG_LEVEL),
    provider: preference,
    ws: {
      host: env.DECKORD_WS_HOST ?? DEFAULT_WS_HOST,
      port: num(env.DECKORD_WS_PORT, DEFAULT_WS_PORT),
      path: env.DECKORD_WS_PATH ?? DEFAULT_WS_PATH,
      token: env.DECKORD_WS_TOKEN,
    },
    discord: {
      clientId,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      accessToken,
      scopes: MVP_SCOPES,
      redirectUri: env.DISCORD_REDIRECT_URI,
    },
    discordTokenPath: env.DECKORD_TOKEN_PATH ?? path.join(dataDir, 'discord-token.json'),
    avatarCacheDir: env.DECKORD_AVATAR_DIR ?? path.join(dataDir, 'avatars'),
    mock: {
      autoStart: bool(env.DECKORD_MOCK_AUTOSTART, true),
      initialUsers: num(env.DECKORD_MOCK_USERS, 5),
      speakingIntervalMs: num(env.DECKORD_MOCK_SPEAKING_MS, 1600),
    },
  };
}

/**
 * Resolve which provider to actually try first. `auto` uses Discord RPC only when
 * a client id + access token are present (the MVP has no interactive AUTHORIZE
 * flow); otherwise the mock provider.
 */
export function resolveInitialProvider(config: DeckordConfig): 'mock' | 'discord-rpc' {
  if (config.provider === 'mock') return 'mock';
  if (config.provider === 'discord-rpc') return 'discord-rpc';
  // `auto`: use Discord when we can authenticate — either a supplied access token
  // or a client secret (for the interactive AUTHORIZE flow).
  const canAuth = Boolean(config.discord.accessToken || config.discord.clientSecret);
  return config.discord.clientId && canAuth ? 'discord-rpc' : 'mock';
}
