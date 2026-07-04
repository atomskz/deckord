import { describe, expect, it, vi } from 'vitest';
import { createLogger, setLogLevel, type LogLevel } from '@deckord/shared';
import type { ConfigClientMessage, ServiceToClientMessage } from '@deckord/ipc-contract';
import { loadConfig } from './index';
import { MemorySettingsStore } from './settings';
import { MemorySecretStore, SECRET_KEYS } from '../secrets/SecretStore';
import { ConfigController } from './ConfigController';

setLogLevel('error' as LogLevel);

function harness() {
  const settings = new MemorySettingsStore();
  const secrets = new MemorySecretStore();
  const broadcasts: ServiceToClientMessage[] = [];
  const sent: ServiceToClientMessage[] = [];
  const restart = vi.fn(async () => {});
  const controller = new ConfigController({
    config: loadConfig({ DECKORD_DATA_DIR: '/tmp/deckord-cfg-test' }),
    settings,
    secrets,
    broadcast: (m) => broadcasts.push(m),
    providerKind: () => 'mock',
    restart,
    log: createLogger('test'),
  });
  const client = { send: (m: ServiceToClientMessage) => sent.push(m) };
  const handle = (m: ConfigClientMessage) => controller.handle(m, client);
  return { controller, settings, secrets, broadcasts, sent, restart, client, handle };
}

function configOf(messages: ServiceToClientMessage[]) {
  const msg = messages.find((m) => m.type === 'config');
  if (msg?.type !== 'config') throw new Error('no config message');
  return msg.payload;
}

describe('ConfigController', () => {
  it('get_config replies with the effective settings and secret flags', async () => {
    const h = harness();
    await h.handle({ type: 'get_config' });
    const payload = configOf(h.sent);
    expect(payload.settings.provider).toBe('auto');
    expect(payload.secrets).toEqual({ hasClientSecret: false, hasToken: false });
    expect(payload.runtime.provider).toBe('mock');
    expect(payload.runtime.restartRequired).toBe(false);
  });

  it('set_config persists settings, marks restart required, and broadcasts', async () => {
    const h = harness();
    await h.handle({ type: 'set_config', payload: { settings: { provider: 'discord-rpc', ws: { port: 8799 } } } });
    expect(await h.settings.load()).toEqual({ provider: 'discord-rpc', ws: { port: 8799 } });
    const payload = configOf(h.broadcasts);
    expect(payload.settings.provider).toBe('discord-rpc');
    expect(payload.settings.ws?.port).toBe(8799);
    expect(payload.runtime.restartRequired).toBe(true);
  });

  it('stores a client secret and reports its presence (never its value)', async () => {
    const h = harness();
    await h.handle({ type: 'set_config', payload: { secrets: { clientSecret: 'top-secret' } } });
    expect(await h.secrets.get(SECRET_KEYS.clientSecret)).toBe('top-secret');
    const payload = configOf(h.broadcasts);
    expect(payload.secrets.hasClientSecret).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('top-secret');
  });

  it('an empty client secret clears it', async () => {
    const h = harness();
    await h.secrets.set(SECRET_KEYS.clientSecret, 'old');
    await h.handle({ type: 'set_config', payload: { secrets: { clientSecret: '' } } });
    expect(await h.secrets.get(SECRET_KEYS.clientSecret)).toBeNull();
  });

  it('a pasted access token is stored as a token and clearToken forgets it', async () => {
    const h = harness();
    await h.handle({ type: 'set_config', payload: { secrets: { accessToken: 'abc123' } } });
    expect(await h.secrets.has(SECRET_KEYS.token)).toBe(true);
    await h.handle({ type: 'set_config', payload: { secrets: { clearToken: true } } });
    expect(await h.secrets.has(SECRET_KEYS.token)).toBe(false);
  });

  it('connect_discord persists the provider and restarts', async () => {
    const h = harness();
    await h.handle({ type: 'connect_discord' });
    expect((await h.settings.load()).provider).toBe('discord-rpc');
    expect(h.restart).toHaveBeenCalledOnce();
  });

  it('restart_service restarts', async () => {
    const h = harness();
    await h.handle({ type: 'restart_service' });
    expect(h.restart).toHaveBeenCalledOnce();
  });
});
