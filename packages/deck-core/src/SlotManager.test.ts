import { describe, it, expect, beforeEach } from 'vitest';
import type { VoiceChannelState, VoiceUser } from '@deckord/shared';
import { SlotManager } from './SlotManager';
import { DEFAULT_SLOT_CONFIG } from './types';

/**
 * Test helpers. deck-core is pure, so we drive SlotManager entirely through
 * VoiceChannelState snapshots and inspect the resulting DeckLayout.
 */

function makeUser(id: string, overrides: Partial<VoiceUser> = {}): VoiceUser {
  return {
    userId: id,
    username: `user_${id}`,
    displayName: `User ${id}`,
    isSpeaking: false,
    selfMute: false,
    serverMute: false,
    selfDeaf: false,
    serverDeaf: false,
    suppress: false,
    ...overrides,
  };
}

function makeVoice(users: VoiceUser[]): VoiceChannelState {
  return {
    provider: 'mock',
    connected: true,
    channelId: 'chan-1',
    channelName: 'General',
    users,
    updatedAt: 1,
  };
}

function makeUsers(count: number): VoiceUser[] {
  return Array.from({ length: count }, (_, i) => makeUser(`u${i}`));
}

const STATUS_SLOT = DEFAULT_SLOT_CONFIG.statusSlotIndex; // 9
const USER_SLOT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

describe('SlotManager', () => {
  let sm: SlotManager;

  beforeEach(() => {
    sm = new SlotManager();
  });

  describe('slot geometry', () => {
    it('produces 10 slots with the last slot (index 9) reserved for status/page', () => {
      const layout = sm.computeLayout(makeVoice(makeUsers(3)));

      expect(layout.slotCount).toBe(10);
      expect(layout.slots).toHaveLength(10);
      expect(layout.rows).toBe(2);
      expect(layout.columns).toBe(5);

      const statusSlot = layout.slots[STATUS_SLOT];
      expect(statusSlot.slotIndex).toBe(9);
      // With <=9 users there is a single page, so the kind is "status".
      expect(statusSlot.kind).toBe('status');
      expect(statusSlot.userId).toBeUndefined();
    });

    it('exposes 9 user slots per page (total minus the status slot)', () => {
      expect(sm.userSlotsPerPage).toBe(9);
      expect(sm.slotCount).toBe(10);
    });
  });

  describe('stable JOIN order', () => {
    it('places the first 9 users into user slots in JOIN order', () => {
      const users = makeUsers(9);
      const layout = sm.computeLayout(makeVoice(users));

      USER_SLOT_INDICES.forEach((slotIndex, position) => {
        const slot = layout.slots[slotIndex];
        expect(slot.kind).toBe('user');
        expect(slot.userId).toBe(users[position].userId);
        expect(slot.slotIndex).toBe(slotIndex);
      });
    });

    it('appends a newcomer to the next slot without disturbing existing users', () => {
      const initial = makeUsers(3); // u0, u1, u2
      sm.computeLayout(makeVoice(initial));

      // Provider reports the newcomer FIRST, but stable order must keep u0..u2
      // where they were and append u3 after them.
      const withNewcomer = [makeUser('u3'), ...initial];
      const layout = sm.computeLayout(makeVoice(withNewcomer));

      expect(layout.slots[0].userId).toBe('u0');
      expect(layout.slots[1].userId).toBe('u1');
      expect(layout.slots[2].userId).toBe('u2');
      expect(layout.slots[3].userId).toBe('u3');
    });
  });

  describe('a user leaving does not reorder remaining users', () => {
    it('keeps trailing users in their original slots when a middle user leaves', () => {
      const users = makeUsers(5); // u0..u4 in slots 0..4
      sm.computeLayout(makeVoice(users));

      // u2 leaves. u3 and u4 must NOT slide down into u2's place — they keep
      // their relative order, so the ordered list becomes [u0, u1, u3, u4].
      const remaining = users.filter((u) => u.userId !== 'u2');
      const layout = sm.computeLayout(makeVoice(remaining));

      expect(layout.slots[0].userId).toBe('u0');
      expect(layout.slots[1].userId).toBe('u1');
      expect(layout.slots[2].userId).toBe('u3');
      expect(layout.slots[3].userId).toBe('u4');
      expect(layout.slots[4].kind).toBe('empty');
      expect(layout.slots[4].userId).toBeUndefined();
    });

    it('does not resurrect the old ordering if the departed user reappears', () => {
      const users = makeUsers(3); // u0, u1, u2
      sm.computeLayout(makeVoice(users));

      // u1 leaves.
      sm.computeLayout(makeVoice([makeUser('u0'), makeUser('u2')]));

      // u1 rejoins — it is now a newcomer and appends after u2.
      const layout = sm.computeLayout(makeVoice([makeUser('u0'), makeUser('u2'), makeUser('u1')]));

      expect(layout.slots[0].userId).toBe('u0');
      expect(layout.slots[1].userId).toBe('u2');
      expect(layout.slots[2].userId).toBe('u1');
    });
  });

  describe('speaking / mute changes never move a user to a different slot', () => {
    it('keeps every user at the same slot index across state churn', () => {
      const users = makeUsers(6);
      const first = sm.computeLayout(makeVoice(users));

      const slotOfUser = new Map<string, number>();
      for (const slot of first.slots) {
        if (slot.userId) slotOfUser.set(slot.userId, slot.slotIndex);
      }

      // Flip speaking/mute/deafen on various users; provider re-reports them in
      // a totally different order.
      const churned = [
        makeUser('u5', { isSpeaking: true }),
        makeUser('u0', { selfMute: true }),
        makeUser('u3', { serverDeaf: true }),
        makeUser('u1'),
        makeUser('u4', { isSpeaking: true }),
        makeUser('u2', { serverMute: true }),
      ];
      const second = sm.computeLayout(makeVoice(churned));

      for (const slot of second.slots) {
        if (!slot.userId) continue;
        expect(slot.slotIndex).toBe(slotOfUser.get(slot.userId));
      }
    });
  });

  describe('pagination', () => {
    it('produces pageCount > 1 and a "page" status slot when more than 9 users are present', () => {
      const layout = sm.computeLayout(makeVoice(makeUsers(10)));

      expect(layout.pageCount).toBe(2);
      expect(layout.slots[STATUS_SLOT].kind).toBe('page');
    });

    it('shows the first 9 users on page 0 and the overflow on page 1', () => {
      const users = makeUsers(11); // u0..u10
      const page0 = sm.computeLayout(makeVoice(users));

      expect(page0.page).toBe(0);
      USER_SLOT_INDICES.forEach((slotIndex, position) => {
        expect(page0.slots[slotIndex].userId).toBe(`u${position}`);
      });

      const page1 = sm.nextPage();
      expect(page1.page).toBe(1);
      // Positions 9 and 10 (u9, u10) land in the first two user slots.
      expect(page1.slots[0].userId).toBe('u9');
      expect(page1.slots[1].userId).toBe('u10');
      // Remaining user slots are empty on the last page.
      expect(page1.slots[2].kind).toBe('empty');
      expect(page1.slots[8].kind).toBe('empty');
      // Status slot still shows "page" because pageCount > 1.
      expect(page1.slots[STATUS_SLOT].kind).toBe('page');
    });

    it('cycles pages with nextPage() and wraps back to page 0', () => {
      sm.computeLayout(makeVoice(makeUsers(10))); // 2 pages

      expect(sm.currentPage).toBe(0);
      expect(sm.nextPage().page).toBe(1);
      // Wrap around back to the first page.
      expect(sm.nextPage().page).toBe(0);
      expect(sm.currentPage).toBe(0);
    });
  });

  describe('toggleSelected', () => {
    it('flips visualState.selected and persists it across recompute', () => {
      const users = makeUsers(2);
      const before = sm.computeLayout(makeVoice(users));
      expect(before.slots[0].visualState.selected).toBe(false);
      expect(sm.isSelected('u0')).toBe(false);

      const afterSelect = sm.toggleSelected('u0');
      expect(afterSelect.slots[0].visualState.selected).toBe(true);
      expect(afterSelect.slots[1].visualState.selected).toBe(false);
      expect(sm.isSelected('u0')).toBe(true);

      // Selection survives an unrelated recompute (e.g. a speaking update).
      const recomputed = sm.computeLayout(makeVoice([makeUser('u0', { isSpeaking: true }), makeUser('u1')]));
      expect(recomputed.slots[0].visualState.selected).toBe(true);

      // Toggling again clears it.
      const afterDeselect = sm.toggleSelected('u0');
      expect(afterDeselect.slots[0].visualState.selected).toBe(false);
      expect(sm.isSelected('u0')).toBe(false);
    });
  });

  describe('empty slots', () => {
    it('marks unused user slots as empty when fewer than 9 users are present', () => {
      const users = makeUsers(3);
      const layout = sm.computeLayout(makeVoice(users));

      // Slots 0..2 are users.
      for (let i = 0; i < 3; i++) {
        expect(layout.slots[i].kind).toBe('user');
      }
      // Slots 3..8 are empty user slots.
      for (let i = 3; i < 9; i++) {
        const slot = layout.slots[i];
        expect(slot.kind).toBe('empty');
        expect(slot.userId).toBeUndefined();
        expect(slot.slotIndex).toBe(i);
        expect(slot.visualState).toEqual({
          speaking: false,
          muted: false,
          deafened: false,
          disconnected: false,
          selected: false,
        });
      }
      // Single page => status slot.
      expect(layout.slots[STATUS_SLOT].kind).toBe('status');
      expect(layout.pageCount).toBe(1);
    });

    it('renders all user slots empty when there are zero users', () => {
      const layout = sm.computeLayout(makeVoice([]));

      for (const slotIndex of USER_SLOT_INDICES) {
        expect(layout.slots[slotIndex].kind).toBe('empty');
      }
      expect(layout.pageCount).toBe(1);
      expect(layout.slots[STATUS_SLOT].kind).toBe('status');
    });
  });

  describe('visualState mapping', () => {
    it('maps isSpeaking, mute (self/server) and deafen (self/server) correctly', () => {
      const users: VoiceUser[] = [
        makeUser('speaking', { isSpeaking: true }),
        makeUser('selfMuted', { selfMute: true }),
        makeUser('serverMuted', { serverMute: true }),
        makeUser('selfDeaf', { selfDeaf: true }),
        makeUser('serverDeaf', { serverDeaf: true }),
        makeUser('plain'),
      ];
      const layout = sm.computeLayout(makeVoice(users));

      expect(layout.slots[0].visualState).toMatchObject({ speaking: true, muted: false, deafened: false });
      expect(layout.slots[1].visualState).toMatchObject({ speaking: false, muted: true, deafened: false });
      expect(layout.slots[2].visualState).toMatchObject({ speaking: false, muted: true, deafened: false });
      expect(layout.slots[3].visualState).toMatchObject({ speaking: false, muted: false, deafened: true });
      expect(layout.slots[4].visualState).toMatchObject({ speaking: false, muted: false, deafened: true });
      expect(layout.slots[5].visualState).toMatchObject({ speaking: false, muted: false, deafened: false });

      // disconnected is always false for a present user; selected defaults false.
      for (let i = 0; i < 6; i++) {
        expect(layout.slots[i].visualState.disconnected).toBe(false);
        expect(layout.slots[i].visualState.selected).toBe(false);
      }
    });

    it('reflects combined mute+deafen flags on a single user', () => {
      const layout = sm.computeLayout(
        makeVoice([makeUser('busy', { isSpeaking: true, selfMute: true, selfDeaf: true })]),
      );

      expect(layout.slots[0].visualState).toMatchObject({
        speaking: true,
        muted: true,
        deafened: true,
        disconnected: false,
      });
    });
  });
});
