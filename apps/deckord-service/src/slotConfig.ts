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
  const slotCount = Math.max(1, caps.slotCount);
  return {
    rows,
    columns,
    statusSlotIndex: slotCount - 1,
  };
}
