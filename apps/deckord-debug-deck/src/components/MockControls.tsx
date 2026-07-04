import type { MockCommand } from '@deckord/ipc-contract';

type Props = {
  onCommand: (command: MockCommand) => void;
  providerIsMock: boolean;
};

const CONTROLS: Array<{ command: MockCommand; label: string }> = [
  { command: 'start', label: 'Start mock' },
  { command: 'stop', label: 'Stop mock' },
  { command: 'random_speaking', label: 'Random speaking' },
  { command: 'toggle_mute', label: 'Toggle mute' },
  { command: 'toggle_deafen', label: 'Toggle deafen' },
  { command: 'add_user', label: 'Add user' },
  { command: 'remove_user', label: 'Remove user' },
  { command: 'reset', label: 'Reset channel' },
];

export function MockControls({ onCommand, providerIsMock }: Props) {
  return (
    <section className="panel">
      <h2>Mock controls</h2>
      {!providerIsMock && (
        <p className="hint">Active provider is not the mock — these commands are ignored.</p>
      )}
      <div className="control-grid">
        {CONTROLS.map(({ command, label }) => (
          <button
            key={command}
            type="button"
            className="control-button"
            onClick={() => onCommand(command)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
