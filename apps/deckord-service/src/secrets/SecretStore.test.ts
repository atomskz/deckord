import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index';
import {
  FileSecretStore,
  MemorySecretStore,
  SECRET_KEYS,
  SecretStoreTokenStore,
  secretsPath,
  withStoredClientSecret,
} from './SecretStore';

describe('FileSecretStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'deckord-secrets-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('get/set/has/delete round-trip', async () => {
    const store = new FileSecretStore(secretsPath(dir));
    expect(await store.get('k')).toBeNull();
    expect(await store.has('k')).toBe(false);
    await store.set('k', 'v');
    expect(await store.get('k')).toBe('v');
    expect(await store.has('k')).toBe(true);
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
  });

  it('persists across instances and writes 0600', async () => {
    const file = secretsPath(dir);
    await new FileSecretStore(file).set(SECRET_KEYS.clientSecret, 'shh');
    expect(await new FileSecretStore(file).get(SECRET_KEYS.clientSecret)).toBe('shh');
    const mode = (await stat(file)).mode & 0o777;
    // Skip on platforms without POSIX perms (Windows reports 0666).
    if (process.platform !== 'win32') expect(mode).toBe(0o600);
  });

  it('tolerates a corrupt file', async () => {
    const store = new FileSecretStore(secretsPath(dir));
    await store.set('a', '1');
    // Overwrite with junk out-of-band and read via a fresh instance.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(secretsPath(dir), 'not json');
    expect(await new FileSecretStore(secretsPath(dir)).get('a')).toBeNull();
  });
});

describe('SecretStoreTokenStore', () => {
  it('implements the TokenStore contract over a SecretStore', async () => {
    const secrets = new MemorySecretStore();
    const tokens = new SecretStoreTokenStore(secrets);
    expect(await tokens.load()).toBeNull();
    await tokens.save({ accessToken: 'a', refreshToken: 'r', scopes: ['identify'] });
    expect(await tokens.load()).toEqual({ accessToken: 'a', refreshToken: 'r', scopes: ['identify'] });
    // Stored under the token key in the same backend.
    expect(await secrets.has(SECRET_KEYS.token)).toBe(true);
    await tokens.clear();
    expect(await tokens.load()).toBeNull();
  });
});

describe('withStoredClientSecret', () => {
  it('injects the stored client secret (winning over env)', async () => {
    const secrets = new MemorySecretStore();
    await secrets.set(SECRET_KEYS.clientSecret, 'stored');
    const config = await withStoredClientSecret(loadConfig({ DISCORD_CLIENT_SECRET: 'env' }), secrets);
    expect(config.discord.clientSecret).toBe('stored');
  });

  it('leaves config untouched when nothing is stored', async () => {
    const base = loadConfig({ DISCORD_CLIENT_SECRET: 'env' });
    const config = await withStoredClientSecret(base, new MemorySecretStore());
    expect(config).toBe(base);
    expect(config.discord.clientSecret).toBe('env');
  });
});
