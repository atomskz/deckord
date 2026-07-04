import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './index';
import {
  FileSettingsStore,
  mergeConfig,
  mergeSettings,
  settingsFromConfig,
  settingsPath,
} from './settings';

const base = () => loadConfig({ DECKORD_DATA_DIR: '/tmp/deckord-test' });

describe('mergeConfig', () => {
  it('overlays persisted settings onto the env-derived base', () => {
    const merged = mergeConfig(base(), {
      provider: 'discord-rpc',
      logLevel: 'debug',
      discord: { clientId: '999' },
      ws: { port: 8799 },
    });
    expect(merged.provider).toBe('discord-rpc');
    expect(merged.logLevel).toBe('debug');
    expect(merged.discord.clientId).toBe('999');
    expect(merged.ws.port).toBe(8799);
    // Untouched fields keep the base value.
    expect(merged.ws.host).toBe(base().ws.host);
    expect(merged.appName).toBe('Deckord');
  });

  it('keeps base values when the overlay is empty', () => {
    expect(mergeConfig(base(), {})).toEqual(base());
  });

  it('enabling the opendeck adapter implies the relay endpoint is on', () => {
    const merged = mergeConfig(base(), { deckAdapter: 'opendeck' });
    expect(merged.openDeck.enabled).toBe(true);
  });

  it('does not leak secrets into the projected settings', () => {
    const withSecret = mergeConfig(loadConfig({ DISCORD_CLIENT_SECRET: 'shh' }), {});
    const projected = settingsFromConfig(withSecret);
    expect(JSON.stringify(projected)).not.toContain('shh');
    expect('clientSecret' in (projected.discord ?? {})).toBe(false);
  });
});

describe('settingsFromConfig', () => {
  it('is a valid settings overlay round-trip through mergeConfig', () => {
    const projected = settingsFromConfig(base());
    expect(mergeConfig(base(), projected)).toEqual(base());
  });
});

describe('mergeSettings', () => {
  it('deep-merges nested branches with patch winning', () => {
    const merged = mergeSettings(
      { ws: { host: 'a', port: 1 }, discord: { clientId: 'x' } },
      { ws: { port: 2 }, provider: 'mock' },
    );
    expect(merged).toEqual({
      ws: { host: 'a', port: 2 },
      discord: { clientId: 'x' },
      provider: 'mock',
    });
  });

  it('does not introduce empty nested objects', () => {
    expect(mergeSettings({ provider: 'auto' }, {})).toEqual({ provider: 'auto' });
  });
});

describe('FileSettingsStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'deckord-settings-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns {} when the file is missing', async () => {
    const store = new FileSettingsStore(settingsPath(dir));
    expect(await store.load()).toEqual({});
  });

  it('saves and reloads settings (0600)', async () => {
    const store = new FileSettingsStore(settingsPath(dir));
    await store.save({ provider: 'discord-rpc', discord: { clientId: '42' } });
    expect(await store.load()).toEqual({ provider: 'discord-rpc', discord: { clientId: '42' } });
  });

  it('patch merges over existing settings', async () => {
    const store = new FileSettingsStore(settingsPath(dir));
    await store.save({ provider: 'mock', ws: { port: 1 } });
    const result = await store.patch({ ws: { port: 2 }, logLevel: 'debug' });
    expect(result).toEqual({ provider: 'mock', ws: { port: 2 }, logLevel: 'debug' });
    expect(await store.load()).toEqual(result);
  });

  it('resets to {} on a corrupt or schema-invalid file', async () => {
    const file = settingsPath(dir);
    await writeFile(file, '{ not json');
    expect(await new FileSettingsStore(file).load()).toEqual({});
    await writeFile(file, JSON.stringify({ ws: { port: 999999 } }));
    expect(await new FileSettingsStore(file).load()).toEqual({});
  });

  it('strips unknown keys when persisting', async () => {
    const file = settingsPath(dir);
    // A hand-edited file with an unknown key.
    await writeFile(file, JSON.stringify({ provider: 'mock', bogus: true }));
    const store = new FileSettingsStore(file);
    expect(await store.load()).toEqual({ provider: 'mock' });
  });
});
