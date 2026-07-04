import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { VoiceUser } from '@deckord/shared';
import { AvatarCache } from './AvatarCache';

function user(over: Partial<VoiceUser> = {}): VoiceUser {
  return {
    userId: 'u1',
    username: 'nova',
    displayName: 'Nova',
    avatarUrl: 'https://cdn.example/x.png',
    avatarHash: 'abc',
    isSpeaking: false,
    selfMute: false,
    serverMute: false,
    selfDeaf: false,
    serverDeaf: false,
    suppress: false,
    ...over,
  };
}

describe('AvatarCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'deckord-av-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const imagePng = () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });

  it('downloads once, caches to disk, and dedups subsequent prefetches', async () => {
    const fetchMock = vi.fn(async () => imagePng());
    vi.stubGlobal('fetch', fetchMock);

    const cache = new AvatarCache({ dir });
    const first = await cache.prefetch(user());
    const second = await cache.prefetch(user());

    expect(first).toBeDefined();
    expect(first!.endsWith('.png')).toBe(true);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await cache.localPath(user())).toBe(first);
    expect(Buffer.from(await readFile(first!))).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects a non-image response (e.g. an HTML error page)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    );
    const cache = new AvatarCache({ dir });
    expect(await cache.prefetch(user())).toBeUndefined();
  });

  it('caches animated (a_) avatars with a .gif extension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/gif' } })),
    );
    const cache = new AvatarCache({ dir });
    const file = await cache.prefetch(user({ avatarHash: 'a_deadbeef' }));
    expect(file?.endsWith('.gif')).toBe(true);
  });

  it('does not retry after a failed download', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const cache = new AvatarCache({ dir });
    expect(await cache.prefetch(user())).toBeUndefined();
    expect(await cache.prefetch(user())).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolve returns the source URL and never downloads', () => {
    const cache = new AvatarCache({ dir, enabled: false });
    expect(cache.resolve(user())).toBe('https://cdn.example/x.png');
    expect(cache.resolve(user({ avatarUrl: undefined }))).toBeUndefined();
  });
});
