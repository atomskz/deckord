import { describe, expect, it } from 'vitest';
import type { DeckLayout, DeckSlot, VoiceUser } from '@deckord/shared';
import { EMPTY_VISUAL_STATE } from '@deckord/shared';
import { renderLayout, renderSlot } from './renderSlot';
import { badgesForUser } from './badges';
import { DEFAULT_THEME } from './themes';
import type { RenderContext } from './types';

function makeUser(overrides: Partial<VoiceUser> = {}): VoiceUser {
  return {
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice',
    isSpeaking: false,
    selfMute: false,
    serverMute: false,
    selfDeaf: false,
    serverDeaf: false,
    suppress: false,
    ...overrides,
  };
}

function makeSlot(overrides: Partial<DeckSlot> = {}): DeckSlot {
  return {
    slotIndex: 0,
    kind: 'user',
    visualState: { ...EMPTY_VISUAL_STATE },
    ...overrides,
  };
}

function makeContext(users: VoiceUser[] = [], overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    users: new Map(users.map((u) => [u.userId, u])),
    theme: DEFAULT_THEME,
    ...overrides,
  };
}

function makeLayout(slots: DeckSlot[], overrides: Partial<DeckLayout> = {}): DeckLayout {
  return {
    rows: 1,
    columns: slots.length,
    slotCount: slots.length,
    page: 0,
    pageCount: 1,
    slots,
    ...overrides,
  };
}

describe('renderSlot / renderLayout', () => {
  describe('user slots', () => {
    it('enriches a user slot with title=displayName', () => {
      const user = makeUser({ userId: 'u1', displayName: 'Alice' });
      const slot = makeSlot({ kind: 'user', userId: 'u1' });
      const ctx = makeContext([user]);

      const rendered = renderSlot(slot, makeLayout([slot]), ctx);

      expect(rendered.kind).toBe('user');
      expect(rendered.title).toBe('Alice');
    });

    it('resolves the image from resolveAvatar when provided', () => {
      const user = makeUser({ userId: 'u1', avatarUrl: 'https://cdn/fallback.png' });
      const slot = makeSlot({ kind: 'user', userId: 'u1' });
      const ctx = makeContext([user], {
        resolveAvatar: () => 'data:image/png;base64,RESOLVED',
      });

      const rendered = renderSlot(slot, makeLayout([slot]), ctx);

      expect(rendered.image).toBe('data:image/png;base64,RESOLVED');
    });

    it('falls back to avatarUrl when resolveAvatar is not provided', () => {
      const user = makeUser({ userId: 'u1', avatarUrl: 'https://cdn/alice.png' });
      const slot = makeSlot({ kind: 'user', userId: 'u1' });
      const ctx = makeContext([user]);

      const rendered = renderSlot(slot, makeLayout([slot]), ctx);

      expect(rendered.image).toBe('https://cdn/alice.png');
    });

    it('renders a user slot with no known user as empty', () => {
      const slot = makeSlot({ kind: 'user', userId: 'ghost' });
      const ctx = makeContext([]);

      const rendered = renderSlot(slot, makeLayout([slot]), ctx);

      expect(rendered.kind).toBe('empty');
      expect(rendered.badges).toEqual([]);
    });
  });

  describe('badgesForUser', () => {
    it('yields a mute badge for selfMute', () => {
      const badges = badgesForUser(makeUser({ selfMute: true }));

      expect(badges).toContainEqual({ type: 'self-mute', label: 'M' });
    });

    it('does NOT yield a mute badge when the user is deafened', () => {
      const badges = badgesForUser(makeUser({ selfMute: true, selfDeaf: true }));

      expect(badges.some((b) => b.type === 'self-mute')).toBe(false);
    });

    it('yields a deaf badge when deafened', () => {
      const badges = badgesForUser(makeUser({ selfDeaf: true }));

      expect(badges).toContainEqual({ type: 'self-deaf', label: 'D' });
    });

    it('yields a suppress badge for suppress', () => {
      const badges = badgesForUser(makeUser({ suppress: true }));

      expect(badges).toContainEqual({ type: 'suppress', label: 'S' });
    });

    it('never yields a speaking badge, even when speaking', () => {
      const badges = badgesForUser(makeUser({ isSpeaking: true }));

      expect(badges.some((b) => b.type === 'speaking')).toBe(false);
      expect(badges).toEqual([]);
    });

    it('yields no badges for a plain user', () => {
      expect(badgesForUser(makeUser())).toEqual([]);
    });
  });

  describe('user slot badges', () => {
    it('surfaces badgesForUser on the rendered user slot', () => {
      const user = makeUser({ userId: 'u1', selfMute: true, suppress: true });
      const slot = makeSlot({ kind: 'user', userId: 'u1' });
      const ctx = makeContext([user]);

      const rendered = renderSlot(slot, makeLayout([slot]), ctx);

      expect(rendered.badges).toEqual(badgesForUser(user));
      expect(rendered.badges).toContainEqual({ type: 'self-mute', label: 'M' });
      expect(rendered.badges).toContainEqual({ type: 'suppress', label: 'S' });
    });
  });

  describe('status / page slots', () => {
    it('gives a page slot subtitle "1/2"', () => {
      const slot = makeSlot({ slotIndex: 0, kind: 'page' });
      const layout = makeLayout([slot], { page: 0, pageCount: 2 });
      const ctx = makeContext([]);

      const rendered = renderSlot(slot, layout, ctx);

      expect(rendered.kind).toBe('page');
      expect(rendered.subtitle).toBe('1/2');
    });
  });

  describe('empty slots', () => {
    it('leaves an empty slot empty', () => {
      const slot = makeSlot({ slotIndex: 3, kind: 'empty' });
      const ctx = makeContext([]);

      const rendered = renderSlot(slot, makeLayout([slot]), ctx);

      expect(rendered.kind).toBe('empty');
      expect(rendered.title).toBeUndefined();
      expect(rendered.subtitle).toBeUndefined();
      expect(rendered.image).toBeUndefined();
      expect(rendered.badges).toEqual([]);
    });
  });

  describe('renderLayout immutability', () => {
    it('returns a new layout object without mutating the input', () => {
      const user = makeUser({ userId: 'u1', displayName: 'Alice' });
      const inputSlot = makeSlot({ kind: 'user', userId: 'u1' });
      const layout = makeLayout([inputSlot], { page: 0, pageCount: 2 });
      const ctx = makeContext([user]);

      const snapshot = structuredClone(layout);
      const result = renderLayout(layout, ctx);

      // A new object is returned.
      expect(result).not.toBe(layout);
      expect(result.slots).not.toBe(layout.slots);
      expect(result.slots[0]).not.toBe(layout.slots[0]);

      // The rendered layout carries the enriched fields.
      expect(result.slots[0].title).toBe('Alice');

      // The input was not mutated.
      expect(layout).toEqual(snapshot);
      expect(inputSlot.title).toBeUndefined();
    });
  });
});
