import type { VoiceChannelState } from '@deckord/ipc-contract';
import type { ConnectionStatus } from '../services/DeckSocket';

type Props = {
  status: ConnectionStatus;
  voice: VoiceChannelState | null;
  onToggleSettings: () => void;
  settingsOpen: boolean;
};

export function StatusBar({ status, voice, onToggleSettings, settingsOpen }: Props) {
  return (
    <header className="status-bar">
      <div className="brand">
        <span className="brand-mark">◆</span> Deckord <span className="brand-sub">debug deck</span>
      </div>
      <div className="pills">
        <span className={`pill pill-conn pill-${status}`}>service: {status}</span>
        <span className="pill">
          provider: {voice?.provider ?? '—'}
        </span>
        <span className={`pill ${voice?.connected ? 'pill-ok' : 'pill-off'}`}>
          {voice?.connected ? `in ${voice.channelName ?? 'voice'}` : 'not in voice'}
        </span>
        <span className="pill">users: {voice?.users.length ?? 0}</span>
        <button
          type="button"
          className={`pill pill-button ${settingsOpen ? 'pill-ok' : ''}`}
          onClick={onToggleSettings}
          aria-pressed={settingsOpen}
        >
          {settingsOpen ? '✕ close' : '⚙ settings'}
        </button>
      </div>
    </header>
  );
}
