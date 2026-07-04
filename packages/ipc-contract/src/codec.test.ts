import { describe, it, expect } from 'vitest';
import {
  encode,
  decodeClientMessage,
  decodeServiceMessage,
} from './index';
import type {
  ClientToServiceMessage,
  ServiceToClientMessage,
} from './messages';
import { EMPTY_VISUAL_STATE, type DeckLayout, type DeckSlot, type VoiceChannelState } from '@deckord/shared';

const voice: VoiceChannelState = {
  provider: 'mock',
  connected: true,
  channelId: 'chan-1',
  channelName: 'General',
  guildId: 'guild-1',
  guildName: 'Test Guild',
  users: [
    {
      userId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      isSpeaking: true,
      selfMute: false,
      serverMute: false,
      selfDeaf: false,
      serverDeaf: false,
      suppress: false,
    },
  ],
  updatedAt: 1_720_000_000_000,
};

const slot: DeckSlot = {
  slotIndex: 0,
  kind: 'user',
  userId: 'u1',
  title: 'Alice',
  subtitle: 'speaking',
  visualState: { ...EMPTY_VISUAL_STATE, speaking: true },
  badges: [{ type: 'speaking', label: '🔊' }],
  accessibilityLabel: 'Alice, speaking',
};

const deck: DeckLayout = {
  rows: 2,
  columns: 3,
  slotCount: 6,
  page: 0,
  pageCount: 1,
  slots: [slot],
};

describe('encode/decodeServiceMessage', () => {
  it('round-trips a snapshot', () => {
    const message: ServiceToClientMessage = {
      type: 'snapshot',
      payload: { voice, deck },
    };
    const result = decodeServiceMessage(encode(message));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(message);
  });

  it('round-trips a slot_update', () => {
    const message: ServiceToClientMessage = {
      type: 'slot_update',
      payload: { slotIndex: 0, slot },
    };
    const result = decodeServiceMessage(encode(message));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(message);
  });
});

describe('encode/decodeClientMessage', () => {
  it('round-trips a button_down', () => {
    const message: ClientToServiceMessage = {
      type: 'button_down',
      payload: { slotIndex: 2 },
    };
    const result = decodeClientMessage(encode(message));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(message);
  });

  it('round-trips a mock_command', () => {
    const message: ClientToServiceMessage = {
      type: 'mock_command',
      payload: { command: 'toggle_mute', userId: 'u1' },
    };
    const result = decodeClientMessage(encode(message));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual(message);
  });
});

describe('decode error handling', () => {
  it('returns err with code IPC_MESSAGE_INVALID for invalid JSON', () => {
    const result = decodeClientMessage('{ not valid json');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.code).toBe('IPC_MESSAGE_INVALID');
  });

  it('returns err with code IPC_MESSAGE_INVALID for invalid service-message JSON', () => {
    const result = decodeServiceMessage('not json at all');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.code).toBe('IPC_MESSAGE_INVALID');
  });

  it('returns err for a structurally-wrong client message (unknown type)', () => {
    const result = decodeClientMessage(JSON.stringify({ type: 'bogus', payload: {} }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.code).toBe('IPC_MESSAGE_INVALID');
  });

  it('returns err for a structurally-wrong service message (unknown type)', () => {
    const result = decodeServiceMessage(JSON.stringify({ type: 'bogus', payload: {} }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.code).toBe('IPC_MESSAGE_INVALID');
  });

  it('returns err for a well-typed message with a malformed payload', () => {
    const result = decodeClientMessage(
      JSON.stringify({ type: 'button_down', payload: { slotIndex: 'nope' } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected err');
    expect(result.error.code).toBe('IPC_MESSAGE_INVALID');
  });
});
