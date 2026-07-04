import type { DeckSlot } from '@deckord/ipc-contract';

type Props = {
  slot: DeckSlot;
  onDown: (slotIndex: number) => void;
  onUp: (slotIndex: number) => void;
};

const BADGE_TITLES: Record<string, string> = {
  'self-mute': 'Self muted',
  'server-mute': 'Server muted',
  'self-deaf': 'Self deafened',
  'server-deaf': 'Server deafened',
  suppress: 'Suppressed',
  page: 'Page',
};

export function DeckButton({ slot, onDown, onUp }: Props) {
  const vs = slot.visualState;
  const classes = [
    'deck-button',
    `kind-${slot.kind}`,
    vs.speaking ? 'is-speaking' : '',
    vs.muted ? 'is-muted' : '',
    vs.deafened ? 'is-deafened' : '',
    vs.selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      onPointerDown={() => onDown(slot.slotIndex)}
      onPointerUp={() => onUp(slot.slotIndex)}
      aria-label={slot.accessibilityLabel ?? slot.title ?? `Slot ${slot.slotIndex + 1}`}
    >
      {slot.kind === 'user' ? <UserFace slot={slot} /> : <StatusFace slot={slot} />}
      {slot.badges && slot.badges.length > 0 && (
        <div className="badges">
          {slot.badges.map((badge) => (
            <span
              key={badge.type}
              className={`badge badge-${badge.type}`}
              title={BADGE_TITLES[badge.type] ?? badge.type}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function UserFace({ slot }: { slot: DeckSlot }) {
  return (
    <>
      <div className="avatar" style={{ background: colorFor(slot.userId ?? slot.title ?? '') }}>
        {slot.image ? (
          <img src={slot.image} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="initials">{initialsOf(slot.title ?? '?')}</span>
        )}
      </div>
      <div className="labels">
        <span className="title">{slot.title ?? 'Unknown'}</span>
        {slot.subtitle && <span className="subtitle">{slot.subtitle}</span>}
      </div>
    </>
  );
}

function StatusFace({ slot }: { slot: DeckSlot }) {
  if (slot.kind === 'empty') {
    return <div className="empty-face">·</div>;
  }
  return (
    <div className="status-face">
      <span className="title">{slot.title ?? 'Deckord'}</span>
      {slot.subtitle && <span className="subtitle">{slot.subtitle}</span>}
    </div>
  );
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffff;
  const hue = hash % 360;
  return `hsl(${hue}, 45%, 38%)`;
}
