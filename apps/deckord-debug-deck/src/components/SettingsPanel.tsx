import { useEffect, useMemo, useState } from 'react';
import type {
  ClientToServiceMessage,
  ConfigPayload,
  DeckordSettings,
} from '@deckord/ipc-contract';

type Props = {
  config: ConfigPayload | null;
  send: (message: ClientToServiceMessage) => void;
  onClose: () => void;
};

type FormState = {
  appName: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  provider: 'auto' | 'mock' | 'discord-rpc';
  clientId: string;
  clientSecret: string;
  accessToken: string;
  redirectUri: string;
  wsHost: string;
  wsPort: string;
  wsToken: string;
  openDeck: boolean;
  openDeckPort: string;
  mockAutoStart: boolean;
  mockUsers: string;
  mockSpeakingMs: string;
};

function fromConfig(payload: ConfigPayload): FormState {
  const s = payload.settings;
  return {
    appName: s.appName ?? '',
    logLevel: s.logLevel ?? 'info',
    provider: s.provider ?? 'auto',
    clientId: s.discord?.clientId ?? '',
    clientSecret: '',
    accessToken: '',
    redirectUri: s.discord?.redirectUri ?? '',
    wsHost: s.ws?.host ?? '',
    wsPort: s.ws?.port != null ? String(s.ws.port) : '',
    wsToken: s.ws?.token ?? '',
    openDeck: s.openDeck?.enabled ?? false,
    openDeckPort: s.openDeck?.port != null ? String(s.openDeck.port) : '',
    mockAutoStart: s.mock?.autoStart ?? true,
    mockUsers: s.mock?.initialUsers != null ? String(s.mock.initialUsers) : '',
    mockSpeakingMs: s.mock?.speakingIntervalMs != null ? String(s.mock.speakingIntervalMs) : '',
  };
}

const numOrUndef = (value: string): number | undefined => {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) ? n : undefined;
};
const strOrUndef = (value: string): string | undefined => (value.trim() !== '' ? value : undefined);

function settingsFromForm(f: FormState): DeckordSettings {
  return {
    appName: strOrUndef(f.appName),
    logLevel: f.logLevel,
    provider: f.provider,
    // The OpenDeck toggle drives the active adapter as well as the relay endpoint.
    deckAdapter: f.openDeck ? 'opendeck' : 'debug-browser',
    discord: { clientId: f.clientId, redirectUri: strOrUndef(f.redirectUri) },
    ws: { host: strOrUndef(f.wsHost), port: numOrUndef(f.wsPort), token: strOrUndef(f.wsToken) },
    openDeck: { enabled: f.openDeck, port: numOrUndef(f.openDeckPort) },
    mock: {
      autoStart: f.mockAutoStart,
      initialUsers: numOrUndef(f.mockUsers),
      speakingIntervalMs: numOrUndef(f.mockSpeakingMs),
    },
  };
}

export function SettingsPanel({ config, send, onClose }: Props) {
  const [form, setForm] = useState<FormState | null>(null);

  // Ask for the current config on mount (the service also pushes it on connect).
  useEffect(() => {
    send({ type: 'get_config' });
  }, [send]);

  // Seed the form from the first config we receive; don't clobber in-progress edits.
  useEffect(() => {
    if (config && !form) setForm(fromConfig(config));
  }, [config, form]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const secretsFromForm = useMemo(
    () => (f: FormState) => {
      const secrets: { clientSecret?: string; accessToken?: string } = {};
      if (f.clientSecret) secrets.clientSecret = f.clientSecret;
      if (f.accessToken) secrets.accessToken = f.accessToken;
      return Object.keys(secrets).length ? secrets : undefined;
    },
    [],
  );

  if (!config || !form) {
    return (
      <section className="settings">
        <p className="hint">Waiting for the service…</p>
      </section>
    );
  }

  const save = () =>
    send({ type: 'set_config', payload: { settings: settingsFromForm(form), secrets: secretsFromForm(form) } });

  const connect = () => {
    save();
    send({ type: 'connect_discord' });
  };

  const disconnect = () => send({ type: 'set_config', payload: { secrets: { clearToken: true } } });
  const clearSecret = () => {
    set('clientSecret', '');
    send({ type: 'set_config', payload: { secrets: { clientSecret: '' } } });
  };

  return (
    <section className="settings">
      <header className="settings-head">
        <h2>Settings</h2>
        <button type="button" className="control-button" onClick={onClose}>
          ← Back to deck
        </button>
      </header>

      {config.runtime.restartRequired && (
        <div className="settings-banner">
          Saved. <strong>Restart to apply</strong> the changes to the running service.
          <button type="button" className="control-button" onClick={() => send({ type: 'restart_service' })}>
            Restart now
          </button>
        </div>
      )}

      <div className="settings-status">
        <span className={`pill ${config.runtime.provider === 'discord-rpc' ? 'pill-ok' : ''}`}>
          provider: {config.runtime.provider}
        </span>
        <span className="pill">token: {config.secrets.hasToken ? 'stored' : 'none'}</span>
        <span className="pill">data: {config.runtime.dataDir}</span>
      </div>

      <fieldset className="settings-group">
        <legend>Discord application (bring your own)</legend>
        <p className="hint">
          Until the public Deckord app is approved by Discord, register your own application at
          discord.com/developers, then paste its credentials here. Read-only voice scopes only.
        </p>
        <label>
          Client ID
          <input value={form.clientId} onChange={(e) => set('clientId', e.target.value)} placeholder="application id" />
        </label>
        <label>
          Client secret
          <input
            type="password"
            value={form.clientSecret}
            onChange={(e) => set('clientSecret', e.target.value)}
            placeholder={config.secrets.hasClientSecret ? '•••• stored — leave blank to keep' : 'not set'}
          />
        </label>
        <label>
          Redirect URI (optional)
          <input value={form.redirectUri} onChange={(e) => set('redirectUri', e.target.value)} placeholder="http://127.0.0.1/callback" />
        </label>
        <details>
          <summary>Advanced: paste a pre-obtained access token</summary>
          <label>
            Access token
            <input
              type="password"
              value={form.accessToken}
              onChange={(e) => set('accessToken', e.target.value)}
              placeholder={config.secrets.hasToken ? 'stored — leave blank to keep' : 'optional'}
            />
          </label>
        </details>
        <div className="settings-actions">
          <button type="button" className="control-button primary" onClick={connect}>
            Connect Discord
          </button>
          <button type="button" className="control-button" onClick={disconnect} disabled={!config.secrets.hasToken}>
            Disconnect
          </button>
          <button type="button" className="control-button" onClick={clearSecret} disabled={!config.secrets.hasClientSecret}>
            Clear secret
          </button>
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>General</legend>
        <label>
          Provider
          <select value={form.provider} onChange={(e) => set('provider', e.target.value as FormState['provider'])}>
            <option value="auto">auto (Discord if configured, else mock)</option>
            <option value="discord-rpc">discord-rpc</option>
            <option value="mock">mock</option>
          </select>
        </label>
        <label>
          Log level
          <select value={form.logLevel} onChange={(e) => set('logLevel', e.target.value as FormState['logLevel'])}>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </label>
        <label>
          App name
          <input value={form.appName} onChange={(e) => set('appName', e.target.value)} placeholder="Deckord" />
        </label>
      </fieldset>

      <fieldset className="settings-group">
        <legend>WebSocket API</legend>
        <label>
          Host
          <input value={form.wsHost} onChange={(e) => set('wsHost', e.target.value)} placeholder="127.0.0.1" />
        </label>
        <label>
          Port
          <input value={form.wsPort} onChange={(e) => set('wsPort', e.target.value)} placeholder="8787" inputMode="numeric" />
        </label>
        <label>
          Token (shared secret)
          <input value={form.wsToken} onChange={(e) => set('wsToken', e.target.value)} placeholder="none" />
        </label>
        <p className="hint">Changing the host/port requires reconnecting this UI to the new endpoint.</p>
      </fieldset>

      <fieldset className="settings-group">
        <legend>OpenDeck</legend>
        <label className="settings-checkbox">
          <input type="checkbox" checked={form.openDeck} onChange={(e) => set('openDeck', e.target.checked)} />
          Use the OpenDeck relay adapter (physical deck)
        </label>
        <label>
          Relay port
          <input value={form.openDeckPort} onChange={(e) => set('openDeckPort', e.target.value)} placeholder="8788" inputMode="numeric" />
        </label>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Mock provider</legend>
        <label className="settings-checkbox">
          <input type="checkbox" checked={form.mockAutoStart} onChange={(e) => set('mockAutoStart', e.target.checked)} />
          Auto-start the mock channel
        </label>
        <label>
          Initial users
          <input value={form.mockUsers} onChange={(e) => set('mockUsers', e.target.value)} placeholder="5" inputMode="numeric" />
        </label>
        <label>
          Speaking interval (ms)
          <input value={form.mockSpeakingMs} onChange={(e) => set('mockSpeakingMs', e.target.value)} placeholder="1600" inputMode="numeric" />
        </label>
      </fieldset>

      <div className="settings-actions sticky">
        <button type="button" className="control-button primary" onClick={save}>
          Save settings
        </button>
        <button type="button" className="control-button" onClick={() => setForm(fromConfig(config))}>
          Reset
        </button>
        <button type="button" className="control-button" onClick={() => send({ type: 'restart_service' })}>
          Restart service
        </button>
      </div>
    </section>
  );
}
