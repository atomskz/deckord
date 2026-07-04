import type { DeckCapabilities } from '@deckord/deck-adapter';
import type { SlotManagerConfig } from '@deckord/deck-core';

/**
 * Derive deck-core's slot config from a device's capabilities, so the layout
 * follows the connected deck instead of a hardcoded grid. The last slot is
 * reserved for status/page. Adapters report `rows * columns === slotCount`
 * (the debug deck is 2×5; OpenDeck reports a flat 1×N of the assigned keys).
 */
export function slotConfigFromCapabilities(caps: DeckCapabilities): SlotManagerConfig {
  const columns = Math.max(1, caps.columns);
  const rows = Math.max(1, caps.rows);
  // Derive from rows*columns (what SlotManager itself uses for slotCount) rather than
  // caps.slotCount, to avoid an implicit invariant coupling. Reserve the last slot for
  // status/page — but not on a 1-slot deck (that would leave zero user slots), where
  // an out-of-range index tells SlotManager to skip the status slot.
  const total = rows * columns;
  return {
    rows,
    columns,
    statusSlotIndex: total >= 2 ? total - 1 : -1,
  };
}
