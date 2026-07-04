/**
 * deck-core configuration. deck-core is intentionally pure: it turns a
 * VoiceChannelState plus some UI state (current page, selection) into a logical
 * DeckLayout. It has no I/O, no timers, and no knowledge of adapters or Discord.
 */

export type SlotManagerConfig = {
  rows: number;
  columns: number;
  /**
   * Slot index reserved for the status / page indicator. All other slots are
   * available for users. Defaults to the last slot.
   */
  statusSlotIndex: number;
};

export const DEFAULT_SLOT_CONFIG: SlotManagerConfig = {
  rows: 2,
  columns: 5,
  statusSlotIndex: 9,
};
