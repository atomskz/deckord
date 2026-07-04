import { describe, expect, it } from 'vitest';
import type { DeckCapabilities } from '@deckord/deck-adapter';
import { slotConfigFromCapabilities } from './slotConfig';

const caps = (over: Partial<DeckCapabilities>): DeckCapabilities => ({
  rows: 2,
  columns: 5,
  slotCount: 10,
  imageFormats: ['css'],
  ...over,
});

describe('slotConfigFromCapabilities', () => {
  it('maps a 2×5 deck (last slot = status)', () => {
    expect(slotConfigFromCapabilities(caps({}))).toEqual({ rows: 2, columns: 5, statusSlotIndex: 9 });
  });

  it('maps a flat 1×N OpenDeck deck (N assigned keys)', () => {
    expect(slotConfigFromCapabilities(caps({ rows: 1, columns: 6, slotCount: 6 }))).toEqual({
      rows: 1,
      columns: 6,
      statusSlotIndex: 5,
    });
  });

  it('does not reserve a status slot on a 1-key deck (would leave 0 user slots)', () => {
    expect(slotConfigFromCapabilities(caps({ rows: 1, columns: 1, slotCount: 1 }))).toEqual({
      rows: 1,
      columns: 1,
      statusSlotIndex: -1,
    });
  });

  it('clamps degenerate values to a sane minimum (no status slot)', () => {
    expect(slotConfigFromCapabilities(caps({ rows: 0, columns: 0, slotCount: 0 }))).toEqual({
      rows: 1,
      columns: 1,
      statusSlotIndex: -1,
    });
  });
});
