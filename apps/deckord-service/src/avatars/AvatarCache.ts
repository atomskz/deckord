import { access, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AvatarResolver } from '@deckord/renderer';
import { createLogger, type Logger, type VoiceUser } from '@deckord/shared';

const DOWNLOAD_TIMEOUT_MS = 8000;
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

export type AvatarCacheOptions = {
  /** Directory where downloaded avatars are stored. */
  dir: string;
  /** Set false to disable downloading (resolve still returns the source URL). */
  enabled?: boolean;
};

/**
 * Resolves and caches user avatars.
 *
 * `resolve` (used by the renderer for the browser deck) keeps returning the source
 * URL, which the browser loads directly. `prefetch` downloads the avatar to disk so
 * a future physical deck — which needs raw bytes, not a URL — can read it via
 * `localPath` (consumed by @deckord/image-renderer). Downloads are de-duplicated by
 * user + avatar hash, time-limited, size-capped, and never retried after a failure.
 */
export class AvatarCache {
  private readonly dir: string;
  private readonly enabled: boolean;
  private readonly log: Logger;

  private readonly cached = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly inFlight = new Map<string, Promise<string | undefined>>();

  constructor(options: AvatarCacheOptions, logger: Logger = createLogger('avatars')) {
    this.dir = options.dir;
    this.enabled = options.enabled ?? true;
    this.log = logger;
  }

  /** Avatar source for the renderer (browser loads the URL directly). */
  readonly resolve: AvatarResolver = (user: VoiceUser): string | undefined => {
    return user.avatarUrl ?? user.avatarLocalPath;
  };

  /** Path to the cached avatar file if present, else undefined (for the image-renderer). */
  async localPath(user: VoiceUser): Promise<string | undefined> {
    const key = this.keyFor(user);
    if (!key) return undefined;
    const file = this.filePath(key, extFor(user));
    if (this.cached.has(key)) return file;
    if (await exists(file)) {
      this.cached.add(key);
      return file;
    }
    return undefined;
  }

  /** Download + cache the avatar if not already cached. Returns the local path. */
  async prefetch(user: VoiceUser): Promise<string | undefined> {
    const key = this.keyFor(user);
    if (!this.enabled || !key || !user.avatarUrl) return undefined;
    const file = this.filePath(key, extFor(user));
    if (this.cached.has(key)) return file;
    if (this.failed.has(key)) return undefined;

    const running = this.inFlight.get(key);
    if (running) return running;

    const task = this.ensure(user.avatarUrl, key, file);
    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }

  // --- internal ------------------------------------------------------------

  private async ensure(url: string, key: string, file: string): Promise<string | undefined> {
    if (await exists(file)) {
      this.cached.add(key);
      return file;
    }
    return this.download(url, key, file);
  }

  private async download(url: string, key: string, file: string): Promise<string | undefined> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) throw new Error(`unexpected content-type "${contentType}"`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_AVATAR_BYTES) throw new Error(`avatar too large (${bytes.length} bytes)`);
      await mkdir(this.dir, { recursive: true });
      await writeFile(file, bytes);
      this.cached.add(key);
      this.log.debug(`Cached avatar ${key} (${bytes.length} bytes)`);
      return file;
    } catch (error) {
      this.failed.add(key);
      this.log.warn(`AVATAR_DOWNLOAD_FAILED for ${key}: ${String(error)}`);
      return undefined;
    }
  }

  private keyFor(user: VoiceUser): string | undefined {
    if (!user.avatarUrl) return undefined;
    const hash = user.avatarHash ?? createHash('sha1').update(user.avatarUrl).digest('hex').slice(0, 12);
    // Sanitize so a userId/hash can never contain path separators or `..` traversal.
    return `${safe(user.userId)}_${safe(hash)}`;
  }

  private filePath(key: string, ext: string): string {
    return path.join(this.dir, `${key}.${ext}`);
  }
}

/** Animated Discord avatars (hash prefixed `a_`) are GIFs; everything else is PNG. */
function extFor(user: VoiceUser): string {
  return user.avatarHash?.startsWith('a_') ? 'gif' : 'png';
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
