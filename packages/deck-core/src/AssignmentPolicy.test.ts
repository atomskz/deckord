import { describe, it, expect } from 'vitest';
import type { VoiceUser } from '@deckord/shared';
import { StableOrderPolicy } from './AssignmentPolicy';

function makeUser(userId: string): VoiceUser {
  return {
    userId,
    username: `user-${userId}`,
    displayName: `Display ${userId}`,
    isSpeaking: false,
    selfMute: false,
    serverMute: false,
    selfDeaf: false,
    serverDeaf: false,
    suppress: false,
  };
}

function users(...ids: string[]): VoiceUser[] {
  return ids.map(makeUser);
}

describe('StableOrderPolicy', () => {
  it('appends newcomers in provider order on first reconcile', () => {
    const policy = new StableOrderPolicy();
    expect(policy.reconcile(users('a', 'b', 'c'))).toEqual(['a', 'b', 'c']);
  });

  it('appends only new users, preserving existing order', () => {
    const policy = new StableOrderPolicy();
    policy.reconcile(users('a', 'b'));

    // 'c' and 'd' are new; provider reports them after the known users.
    expect(policy.reconcile(users('a', 'b', 'c', 'd'))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('keeps established order even when the provider reorders known users', () => {
    const policy = new StableOrderPolicy();
    policy.reconcile(users('a', 'b', 'c'));

    // Provider now reports them in a different order; policy must not reshuffle.
    expect(policy.reconcile(users('c', 'a', 'b'))).toEqual(['a', 'b', 'c']);
  });

  it('drops departed users without reordering the remaining ones', () => {
    const policy = new StableOrderPolicy();
    policy.reconcile(users('a', 'b', 'c', 'd'));

    // 'b' leaves; a, c, d keep their relative order.
    expect(policy.reconcile(users('a', 'c', 'd'))).toEqual(['a', 'c', 'd']);
  });

  it('appends a re-added user at the end after removal', () => {
    const policy = new StableOrderPolicy();
    policy.reconcile(users('a', 'b', 'c'));

    // Remove 'a'.
    expect(policy.reconcile(users('b', 'c'))).toEqual(['b', 'c']);

    // Re-add 'a'; it goes to the end rather than reclaiming its old slot.
    expect(policy.reconcile(users('b', 'c', 'a'))).toEqual(['b', 'c', 'a']);
  });

  it('handles simultaneous departures and arrivals', () => {
    const policy = new StableOrderPolicy();
    policy.reconcile(users('a', 'b', 'c'));

    // 'b' leaves, 'd' and 'e' arrive.
    expect(policy.reconcile(users('a', 'c', 'd', 'e'))).toEqual([
      'a',
      'c',
      'd',
      'e',
    ]);
  });

  it('returns an empty list when there are no users', () => {
    const policy = new StableOrderPolicy();
    expect(policy.reconcile([])).toEqual([]);
  });

  it('drops all users when everyone leaves', () => {
    const policy = new StableOrderPolicy();
    policy.reconcile(users('a', 'b'));
    expect(policy.reconcile([])).toEqual([]);
  });

  it('returns a fresh copy each call (not a live reference to internal state)', () => {
    const policy = new StableOrderPolicy();
    const first = policy.reconcile(users('a', 'b'));
    first.push('mutated');

    // Mutating a returned array must not corrupt future reconciles.
    expect(policy.reconcile(users('a', 'b'))).toEqual(['a', 'b']);
  });

  it('reset() clears remembered order so users are re-appended fresh', () => {
    const policy = new StableOrderPolicy();
    policy.reconcile(users('a', 'b', 'c'));

    policy.reset();

    // After reset, provider order determines the appended order again.
    expect(policy.reconcile(users('c', 'a'))).toEqual(['c', 'a']);
  });
});
