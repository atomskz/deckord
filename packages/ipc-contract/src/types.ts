/**
 * Convenience re-exports so consumers can pull the wire vocabulary from a single
 * package without also depending on @deckord/shared directly for these shapes.
 */
export type {
  VoiceUser,
  VoiceChannelState,
  VoiceProviderKind,
  DeckSlot,
  DeckSlotKind,
  DeckLayout,
  DeckBadge,
  DeckBadgeType,
  DeckVisualState,
  RenderedDeckSlot,
} from '@deckord/shared';
