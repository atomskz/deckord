import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { createLogger, setLogLevel } from '@deckord/shared';
import { WsServer, type WsClient as ServiceClient, type WsServerConfig } from './WsServer';

setLogLevel('error');
const log = createLogger('test');

const servers: WsServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function startServer(over: Partial<WsServerConfig> = {}): Promise<WsServer> {
  const server = new WsServer({ host: '127.0.0.1', port: 0, path: '/deck', ...over }, log);
  servers.push(server);
  await server.start();
  return server;
}

type Outcome = { ok: boolean; code?: number };

function tryConnect(url: string, opts: { origin?: string } = {}): Promise<Outcome> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (o: Outcome) => {
      if (!done) {
        done = true;
        resolve(o);
      }
    };
    const ws = new WsClient(url, opts.origin ? { origin: opts.origin } : {});
    ws.on('open', () => {
      finish({ ok: true });
      ws.close();
    });
    // A rejected upgrade (401) surfaces as an error and/or an abnormal close.
    ws.on('error', () => finish({ ok: false }));
    ws.on('close', (code) => finish({ ok: false, code }));
  });
}

const urlFor = (server: WsServer, query = '') =>
  `ws://127.0.0.1:${server.boundPort}/deck${query}`;

describe('WsServer authorization', () => {
  it('accepts connections in open mode (no token) but marks them unauthenticated', async () => {
    const server = await startServer();
    const connected: ServiceClient[] = [];
    server.onClientConnect((c) => connected.push(c));

    const outcome = await tryConnect(urlFor(server));
    expect(outcome.ok).toBe(true);
    await vi_waitFor(() => connected.length > 0);
    expect(connected.at(-1)?.authenticated).toBe(false);
  });

  it('rejects a connection without the token when a token is configured', async () => {
    const server = await startServer({ token: 'sekret' });
    expect((await tryConnect(urlFor(server))).ok).toBe(false);
  });

  it('accepts and authenticates a connection with the correct token', async () => {
    const server = await startServer({ token: 'sekret' });
    const connected: ServiceClient[] = [];
    server.onClientConnect((c) => connected.push(c));

    const outcome = await tryConnect(urlFor(server, '?token=sekret'));
    expect(outcome.ok).toBe(true);
    await vi_waitFor(() => connected.length > 0);
    expect(connected.at(-1)?.authenticated).toBe(true);
  });

  it('rejects a wrong token', async () => {
    const server = await startServer({ token: 'sekret' });
    expect((await tryConnect(urlFor(server, '?token=nope'))).ok).toBe(false);
  });

  it('rejects a forbidden (cross-site) Origin', async () => {
    const server = await startServer();
    expect((await tryConnect(urlFor(server), { origin: 'https://evil.example' })).ok).toBe(false);
  });

  it('allows a loopback web Origin', async () => {
    const server = await startServer();
    expect((await tryConnect(urlFor(server), { origin: 'http://127.0.0.1:5173' })).ok).toBe(true);
  });

  it('refuses to bind a non-loopback host without a token (fail closed)', async () => {
    const server = new WsServer({ host: '0.0.0.0', port: 0, path: '/deck' }, log);
    await expect(server.start()).rejects.toThrow(/non-loopback/i);
  });

  it('allows a non-loopback bind when a token is set', async () => {
    // 0.0.0.0 with a token is permitted by policy; bind may still fail in a
    // sandbox, so only assert the policy check does not reject up front.
    const server = new WsServer({ host: '0.0.0.0', port: 0, path: '/deck', token: 't' }, log);
    servers.push(server);
    await server.start().catch((e) => {
      // A real bind error is fine; a policy rejection ("non-loopback ... without") is not.
      expect(String(e)).not.toMatch(/without DECKORD_WS_TOKEN/);
    });
  });
});

/** Tiny poll helper (avoids importing vitest fake timers for a race-free assert). */
async function vi_waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
