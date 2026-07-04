import { describe, expect, it } from 'vitest';
import { normalizeVoiceState, type RawVoiceState } from './types';

const baseUser = { id: '42', username: 'nova', global_name: 'Nova', avatar: null };

describe('normalizeVoiceState', () => {
  it('reads the mute/deaf flags from the nested voice_state (real Discord shape)', () => {
    const raw: RawVoiceState = {
      nick: 'Nova',
      user: baseUser,
      voice_state: { mute: true, deaf: false, self_mute: true, self_deaf: false, suppress: true },
    };
    const u = normalizeVoiceState(raw);
    expect(u).toMatchObject({
      userId: '42',
      displayName: 'Nova',
      selfMute: true,
      serverMute: true,
      selfDeaf: false,
      serverDeaf: false,
      suppress: true,
    });
  });

  it('defaults every flag to a boolean false when voice_state is absent', () => {
    const raw: RawVoiceState = { user: baseUser };
    const u = normalizeVoiceState(raw);
    // The wire schema requires booleans — none of these may be undefined.
    for (const key of ['selfMute', 'serverMute', 'selfDeaf', 'serverDeaf', 'suppress'] as const) {
      expect(typeof u[key]).toBe('boolean');
      expect(u[key]).toBe(false);
    }
    expect(u.isSpeaking).toBe(false);
  });

  it('falls back to top-level legacy flags when present', () => {
    const raw: RawVoiceState = { user: baseUser, mute: true, deaf: true };
    const u = normalizeVoiceState(raw);
    expect(u.serverMute).toBe(true);
    expect(u.serverDeaf).toBe(true);
  });

  it('derives displayName from nick > global_name > username', () => {
    expect(normalizeVoiceState({ user: baseUser }).displayName).toBe('Nova');
    expect(normalizeVoiceState({ user: { id: '1', username: 'x' } }).displayName).toBe('x');
    expect(normalizeVoiceState({ nick: 'Nick', user: baseUser }).displayName).toBe('Nick');
  });

  it('carries the speaking flag through', () => {
    expect(normalizeVoiceState({ user: baseUser }, true).isSpeaking).toBe(true);
  });
});
