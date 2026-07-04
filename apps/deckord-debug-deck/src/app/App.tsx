import { useCallback } from 'react';
import type { MockCommand } from '@deckord/ipc-contract';
import { DeckGrid } from '../components/DeckGrid';
import { EventLog } from '../components/EventLog';
import { MockControls } from '../components/MockControls';
import { StatusBar } from '../components/StatusBar';
import { VoicePanel } from '../components/VoicePanel';
import { useDeckConnection } from './useDeckConnection';

export function App() {
  const { status, voice, deck, log, send } = useDeckConnection();

  const onDown = useCallback(
    (slotIndex: number) => send({ type: 'button_down', payload: { slotIndex } }),
    [send],
  );
  const onUp = useCallback(
    (slotIndex: number) => send({ type: 'button_up', payload: { slotIndex } }),
    [send],
  );
  const onCommand = useCallback(
    (command: MockCommand) => send({ type: 'mock_command', payload: { command } }),
    [send],
  );

  return (
    <div className="app">
      <StatusBar status={status} voice={voice} />
      <main className="layout">
        <div className="deck-stage">
          <DeckGrid deck={deck} onDown={onDown} onUp={onUp} />
          <p className="deck-hint">
            Tap a user to select / pin &nbsp;•&nbsp; tap the last slot to change page
          </p>
        </div>
        <aside className="sidebar">
          <VoicePanel voice={voice} />
          <MockControls onCommand={onCommand} providerIsMock={voice?.provider === 'mock'} />
          <EventLog log={log} />
        </aside>
      </main>
    </div>
  );
}
