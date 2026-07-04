/**
 * Deck-domain types. `deck-core` produces the logical layout; `renderer` fills
 * the presentational fields (title/subtitle/image/badges) in place. The wire
 * (see @deckord/ipc-contract) carries these shapes directly.
 */

export type DeckSlotKind = 'user' | 'empty' | 'status' | 'page';

export type DeckVisualState = {
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  disconnected: boolean;
  selected: boolean;
};

export type DeckBadgeType =
  | 'self-mute'
  | 'server-mute'
  | 'self-deaf'
  | 'server-deaf'
  | 'suppress'
  | 'speaking'
  | 'page';

export type DeckBadge = {
  type: DeckBadgeType;
  /** Short glyph/text used by the CSS renderer (e.g. an emoji or 1–2 chars). */
  label: string;
};

export type DeckSlot = {
  slotIndex: number;
  kind: DeckSlotKind;
  userId?: string;
  title?: string;
  subtitle?: string;

  visualState: DeckVisualState;

  // Presentational fields — populated by the renderer, empty when emitted by deck-core.
  image?: string;
  badges?: DeckBadge[];
  accessibilityLabel?: string;
};

export type DeckLayout = {
  rows: number;
  columns: number;
  slotCount: number;
  /** 0-based index of the currently shown page. */
  page: number;
  pageCount: number;
  slots: DeckSlot[];
};

/**
 * Adapter-facing rendered slot. A superset of the minimal spec type so one
 * `IDeckAdapter.setSlot` contract serves both CSS decks (debug, uses `image`)
 * and physical decks (Phase 7+, uses `imageDataUrl`).
 */
export type RenderedDeckSlot = {
  slotIndex: number;
  kind: DeckSlotKind;
  userId?: string;
  title?: string;
  subtitle?: string;
  image?: string;
  imageDataUrl?: string;
  badges: DeckBadge[];
  visualState: DeckVisualState;
  accessibilityLabel?: string;
};

/** Physical/virtual capabilities a concrete deck device advertises. */
export type DeckLayoutSpec = {
  rows: number;
  columns: number;
  slotCount: number;
  hasKnobs?: boolean;
  iconSize?: { width: number; height: number };
};

export type DeckButtonEventKind = 'down' | 'up';

export type DeckButtonEvent = {
  kind: DeckButtonEventKind;
  slotIndex: number;
  deckId: string;
  timestamp: number;
};

export const EMPTY_VISUAL_STATE: DeckVisualState = {
  speaking: false,
  muted: false,
  deafened: false,
  disconnected: false,
  selected: false,
};
