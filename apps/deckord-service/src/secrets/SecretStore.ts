import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StoredToken, TokenStore } from '@deckord/discord-rpc';
import type { DeckordConfig } from '../config/index';

/**
 * A tiny key/value store for sensitive strings (Phase 9). It exists so the Discord
 * token AND the user-supplied client secret share one secured backend:
 *
 *  - headless service → `FileSecretStore` (0600 JSON — a plaintext fallback);
 *  - Electron desktop shell → a `safeStorage`-backed implementation of THIS
 *    interface (Windows DPAPI / macOS Keychain / libsecret) so values are
 *    encrypted at rest by the OS.
 *
 * Secrets never travel to the config UI; they cross the wire only as one-way
 * writes (see set_config).
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export const SECRET_KEYS = {
  /** OAuth client secret of the user's own Discord application. */
  clientSecret: 'discord.clientSecret',
  /** The persisted OAuth token (StoredToken JSON). */
  token: 'discord.token',
} as const;

/** Default location of the secrets file within the data dir. */
export function secretsPath(dataDir: string): string {
  return path.join(dataDir, 'secrets.json');
}

/**
 * JSON-file secret store (mode 0600). This is the headless fallback; it is NOT
 * OS-encrypted, only permission-restricted — the desktop shell should use the
 * safeStorage-backed store instead. Documented in docs/security.
 */
export class FileSecretStore implements SecretStore {
  private cache: Record<string, string> | null = null;

  constructor(private readonly filePath: string) {}

  async get(key: string): Promise<string | null> {
    return (await this.read())[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const map = { ...(await this.read()), [key]: value };
    await this.write(map);
  }

  async delete(key: string): Promise<void> {
    const map = { ...(await this.read()) };
    delete map[key];
    await this.write(map);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  private async read(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.cache = coerceStringMap(parsed);
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async write(map: Record<string, string>): Promise<void> {
    this.cache = map;
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
    // `mode` above only applies when the file is created; enforce it on rewrites too.
    if (process.platform !== 'win32') await chmod(this.filePath, 0o600);
  }
}

/** In-memory secret store for tests / ephemeral runs. */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

/**
 * Implements the discord-rpc `TokenStore` on top of a `SecretStore`, so the OAuth
 * token is persisted through the same (OS-secured, in Electron) backend as the
 * client secret. This is the Phase 9 replacement for `FileTokenStore`'s plaintext.
 */
export class SecretStoreTokenStore implements TokenStore {
  constructor(
    private readonly secrets: SecretStore,
    private readonly key: string = SECRET_KEYS.token,
  ) {}

  async load(): Promise<StoredToken | null> {
    const raw = await this.secrets.get(this.key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredToken;
    } catch {
      return null;
    }
  }

  async save(token: StoredToken): Promise<void> {
    await this.secrets.set(this.key, JSON.stringify(token));
  }

  async clear(): Promise<void> {
    await this.secrets.delete(this.key);
  }
}

/**
 * Inject a stored client secret into the config (it wins over the env fallback in
 * loadConfig). Returns the config unchanged when nothing is stored.
 */
export async function withStoredClientSecret(
  config: DeckordConfig,
  secrets: SecretStore,
): Promise<DeckordConfig> {
  const stored = await secrets.get(SECRET_KEYS.clientSecret);
  if (!stored) return config;
  return { ...config, discord: { ...config.discord, clientSecret: stored } };
}

function coerceStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
