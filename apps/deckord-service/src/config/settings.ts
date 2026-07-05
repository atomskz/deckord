import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeckordSettingsSchema, type DeckordSettings } from '@deckord/ipc-contract';
import type { DeckordConfig } from './index';

/**
 * Persisted user settings (Phase 9). `loadConfig(env)` produces the base config
 * from environment defaults; the settings.json overlay (edited from the config
 * UI) is layered on top with `mergeConfig`, so configuration survives restarts
 * and no longer requires environment variables.
 *
 * Secrets (Discord client secret, access token) are NEVER stored here — they go
 * through the SecretStore. See settings.ts vs secrets.ts.
 */

export interface SettingsStore {
  /** Current persisted settings ({} when none / unreadable). */
  load(): Promise<DeckordSettings>;
  /** Overwrite the persisted settings. */
  save(settings: DeckordSettings): Promise<void>;
  /** Deep-merge `partial` over the persisted settings, save, and return the result. */
  patch(partial: DeckordSettings): Promise<DeckordSettings>;
}

/** Default location of the settings file within the data dir. */
export function settingsPath(dataDir: string): string {
  return path.join(dataDir, 'settings.json');
}

/** JSON-file-backed settings store (mode 0600). Invalid files reset to defaults. */
export class FileSettingsStore implements SettingsStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<DeckordSettings> {
    try {
      const parsed = DeckordSettingsSchema.safeParse(JSON.parse(await readFile(this.filePath, 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  async save(settings: DeckordSettings): Promise<void> {
    const clean = DeckordSettingsSchema.parse(settings);
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
    // `mode` above only applies when the file is created; enforce it on rewrites too.
    if (process.platform !== 'win32') await chmod(this.filePath, 0o600);
  }

  async patch(partial: DeckordSettings): Promise<DeckordSettings> {
    const merged = mergeSettings(await this.load(), partial);
    await this.save(merged);
    return merged;
  }
}

/** In-memory store for tests / ephemeral runs. */
export class MemorySettingsStore implements SettingsStore {
  private settings: DeckordSettings;
  constructor(initial: DeckordSettings = {}) {
    this.settings = DeckordSettingsSchema.parse(initial);
  }
  async load(): Promise<DeckordSettings> {
    return this.settings;
  }
  async save(settings: DeckordSettings): Promise<void> {
    this.settings = DeckordSettingsSchema.parse(settings);
  }
  async patch(partial: DeckordSettings): Promise<DeckordSettings> {
    this.settings = mergeSettings(this.settings, partial);
    return this.settings;
  }
}

/**
 * Overlay persisted settings onto the env-derived base config. Absent fields keep
 * the base value. `deckAdapter === 'opendeck'` implies the OpenDeck endpoint is
 * enabled (matching the env behavior in loadConfig).
 */
export function mergeConfig(base: DeckordConfig, s: DeckordSettings): DeckordConfig {
  const deckAdapter = s.deckAdapter ?? base.deckAdapter;
  return {
    ...base,
    appName: s.appName ?? base.appName,
    logLevel: s.logLevel ?? base.logLevel,
    provider: s.provider ?? base.provider,
    deckAdapter,
    ws: {
      host: s.ws?.host ?? base.ws.host,
      port: s.ws?.port ?? base.ws.port,
      path: base.ws.path,
      token: s.ws?.token ?? base.ws.token,
    },
    discord: {
      ...base.discord,
      clientId: s.discord?.clientId ?? base.discord.clientId,
      redirectUri: s.discord?.redirectUri ?? base.discord.redirectUri,
    },
    openDeck: {
      enabled: (s.openDeck?.enabled ?? base.openDeck.enabled) || deckAdapter === 'opendeck',
      host: s.openDeck?.host ?? base.openDeck.host,
      port: s.openDeck?.port ?? base.openDeck.port,
      path: base.openDeck.path,
      iconSize: s.openDeck?.iconSize ?? base.openDeck.iconSize,
    },
    mock: {
      autoStart: s.mock?.autoStart ?? base.mock.autoStart,
      initialUsers: s.mock?.initialUsers ?? base.mock.initialUsers,
      speakingIntervalMs: s.mock?.speakingIntervalMs ?? base.mock.speakingIntervalMs,
    },
  };
}

/**
 * Project the effective config back into the editable settings shape, so the
 * config UI can display current values. Deliberately omits every secret.
 */
export function settingsFromConfig(c: DeckordConfig): DeckordSettings {
  return {
    appName: c.appName,
    logLevel: c.logLevel,
    provider: c.provider,
    deckAdapter: c.deckAdapter,
    ws: { host: c.ws.host, port: c.ws.port, token: c.ws.token },
    discord: { clientId: c.discord.clientId, redirectUri: c.discord.redirectUri },
    openDeck: {
      enabled: c.openDeck.enabled,
      host: c.openDeck.host,
      port: c.openDeck.port,
      iconSize: c.openDeck.iconSize,
    },
    mock: {
      autoStart: c.mock.autoStart,
      initialUsers: c.mock.initialUsers,
      speakingIntervalMs: c.mock.speakingIntervalMs,
    },
  };
}

/** Deep-merge two settings overlays (patch wins), dropping empty/undefined branches. */
export function mergeSettings(base: DeckordSettings, patch: DeckordSettings): DeckordSettings {
  return prune({
    ...base,
    ...patch,
    ws: mergeNested(base.ws, patch.ws),
    discord: mergeNested(base.discord, patch.discord),
    openDeck: mergeNested(base.openDeck, patch.openDeck),
    mock: mergeNested(base.mock, patch.mock),
  });
}

function mergeNested<T extends object>(a: T | undefined, b: T | undefined): T | undefined {
  if (a === undefined && b === undefined) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) } as T;
}

/** Drop top-level keys whose value is `undefined` so we don't persist noise. */
function prune<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
