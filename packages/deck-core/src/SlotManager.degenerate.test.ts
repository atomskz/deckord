import { describe, expect, it } from 'vitest';
import type { VoiceChannelState } from '@deckord/shared';
import { SlotManager } from './SlotManager';

const state = (n: number): VoiceChannelState => ({
  provider: 'mock',
  connected: true,
  channelId: 'c',
  channelName: 'C',
  users: Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    username: `u${i}`,
    displayName: `U${i}`,
    isSpeaking: false,
    selfMute: false,
    serverMute: false,
    selfDeaf: false,
    serverDeaf: false,
    suppress: false,
  })),
  updatedAt: 0,
});

describe('SlotManager degenerate configs', () => {
  it('does not throw with 0 user slots (a single status slot)', () => {
    const sm = new SlotManager({ rows: 1, columns: 1, statusSlotIndex: 0 });
    const layout = sm.computeLayout(state(3));
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0]!.kind).toBe('status');
    expect(layout.pageCount).toBe(1);
  });

  it('paginates with a single user slot', () => {
    const sm = new SlotManager({ rows: 1, columns: 2, statusSlotIndex: 1 });
    const layout = sm.computeLayout(state(3));
    expect(layout.slots).toHaveLength(2);
    expect(layout.slots[0]!.kind).toBe('user');
    expect(layout.slots[1]!.kind).toBe('page'); // 3 users, 1 user slot → paged
  });
});
