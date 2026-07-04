import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IPC_PROTOCOL_VERSION, type DiagnosticsPayload, type StatusLevel } from '@deckord/ipc-contract';
import type { VoiceChannelState } from '@deckord/shared';
import type { DeckordConfig } from '../config/index';
import { settingsFromConfig } from '../config/settings';

export type DiagnosticEvent = { level: StatusLevel; message: string; code?: string };

/** A small ring buffer of recent status events, included in diagnostics bundles. */
export class EventRing {
  private readonly events: DiagnosticEvent[] = [];
  constructor(private readonly max = 50) {}
  push(event: DiagnosticEvent): void {
    this.events.push(event);
    if (this.events.length > this.max) this.events.shift();
  }
  list(): DiagnosticEvent[] {
    return [...this.events];
  }
}

export type DiagnosticsInput = {
  config: DeckordConfig;
  activeProvider: 'discord-rpc' | 'mock';
  voice: VoiceChannelState;
  deck: { adapter: string; rows: number; columns: number; slotCount: number };
  hasClientSecret: boolean;
  hasToken: boolean;
  events: DiagnosticEvent[];
  now: number;
};

/** Assemble a REDACTED diagnostics bundle (no secret values leave the service). */
export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsPayload {
  const settings = settingsFromConfig(input.config);
  // The WS token is a shared secret — mark its presence but never emit its value.
  if (settings.ws?.token) settings.ws = { ...settings.ws, token: '***' };

  return {
    generatedAt: input.now,
    appName: input.config.appName,
    protocolVersion: IPC_PROTOCOL_VERSION,
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    dataDir: input.config.dataDir,
    provider: {
      preference: input.config.provider,
      active: input.activeProvider,
      connected: input.voice.connected,
      channelName: input.voice.channelName,
      users: input.voice.users.length,
    },
    deck: input.deck,
    settings,
    secrets: { hasClientSecret: input.hasClientSecret, hasToken: input.hasToken },
    recentEvents: input.events,
  };
}

/** Write the bundle to `<dataDir>/diagnostics.json` and return the path. */
export async function exportDiagnostics(dataDir: string, payload: DiagnosticsPayload): Promise<string> {
  const file = path.join(dataDir, 'diagnostics.json');
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return file;
}
