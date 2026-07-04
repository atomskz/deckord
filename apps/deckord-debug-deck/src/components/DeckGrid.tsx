import type { DeckLayout } from '@deckord/ipc-contract';
import { DeckButton } from './DeckButton';

type Props = {
  deck: DeckLayout | null;
  onDown: (slotIndex: number) => void;
  onUp: (slotIndex: number) => void;
};

export function DeckGrid({ deck, onDown, onUp }: Props) {
  if (!deck) {
    return <div className="deck-grid deck-grid--empty">Waiting for service…</div>;
  }

  return (
    <div
      className="deck-grid"
      style={{ gridTemplateColumns: `repeat(${deck.columns}, 1fr)` }}
    >
      {deck.slots.map((slot) => (
        <DeckButton key={slot.slotIndex} slot={slot} onDown={onDown} onUp={onUp} />
      ))}
    </div>
  );
}
