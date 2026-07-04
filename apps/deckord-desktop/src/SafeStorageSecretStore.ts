import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { SecretStore } from 'deckord-service';

/**
 * OS-secured SecretStore for the Electron shell. Values are encrypted with
 * `safeStorage` (Windows DPAPI / macOS Keychain / Linux libsecret) and the
 * ciphertext (base64) is stored in a JSON file (mode 0600).
 *
 * If the platform reports encryption unavailable (e.g. a headless Linux without a
 * keyring), it falls back to storing plaintext and marks the entry so a later
 * secured run can re-encrypt it. This keeps the app usable while being honest
 * about the downgrade.
 */
type Entry = { enc: boolean; value: string };

export class SafeStorageSecretStore implements SecretStore {
  private cache: Record<string, Entry> | null = null;

  constructor(private readonly filePath: string) {}

  async get(key: string): Promise<string | null> {
    const entry = (await this.read())[key];
    if (!entry) return null;
    if (!entry.enc) return entry.value;
    try {
      return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const map = { ...(await this.read()) };
    if (safeStorage.isEncryptionAvailable()) {
      map[key] = { enc: true, value: safeStorage.encryptString(value).toString('base64') };
    } else {
      map[key] = { enc: false, value };
    }
    await this.write(map);
  }

  async delete(key: string): Promise<void> {
    const map = { ...(await this.read()) };
    delete map[key];
    await this.write(map);
  }

  async has(key: string): Promise<boolean> {
    return Boolean((await this.read())[key]);
  }

  private async read(): Promise<Record<string, Entry>> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      this.cache = coerce(parsed);
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async write(map: Record<string, Entry>): Promise<void> {
    this.cache = map;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
  }
}

function coerce(value: unknown): Record<string, Entry> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, Entry> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v && typeof v === 'object' && typeof (v as Entry).value === 'string') {
      out[k] = { enc: Boolean((v as Entry).enc), value: (v as Entry).value };
    }
  }
  return out;
}
