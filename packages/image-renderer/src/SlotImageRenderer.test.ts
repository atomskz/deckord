import { describe, expect, it } from 'vitest';
import type { RenderedDeckSlot } from '@deckord/shared';
import { SlotImageRenderer } from './SlotImageRenderer';

const PNG_SIGNATURE = '89504e470d0a1a0a';

function slot(over: Partial<RenderedDeckSlot> = {}): RenderedDeckSlot {
  return {
    slotIndex: 0,
    kind: 'user',
    userId: 'u1',
    title: 'Nova',
    subtitle: '@nova',
    badges: [{ type: 'self-mute', label: 'M' }],
    visualState: { speaking: true, muted: true, deafened: false, disconnected: false, selected: false },
    ...over,
  };
}

describe('SlotImageRenderer', () => {
  const renderer = new SlotImageRenderer({ size: 96 });

  it('renders a user slot to a valid 96x96 PNG', async () => {
    const buffer = await renderer.renderToBuffer(slot());
    expect(buffer.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
    // PNG IHDR: width @ byte 16, height @ byte 20 (big-endian).
    expect(buffer.readUInt32BE(16)).toBe(96);
    expect(buffer.readUInt32BE(20)).toBe(96);
  });

  it('renders a status slot as a PNG data URL', async () => {
    const url = await renderer.renderToDataUrl(
      slot({ kind: 'status', title: 'General', subtitle: '3 in voice' }),
    );
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan(100);
  });

  it('renders empty and no-avatar (identicon) slots without throwing', async () => {
    const empty = await renderer.renderToBuffer(
      slot({
        kind: 'empty',
        badges: [],
        visualState: { speaking: false, muted: false, deafened: false, disconnected: false, selected: false },
      }),
    );
    expect(empty.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
  });

  it('honors a custom size', async () => {
    const buffer = await new SlotImageRenderer({ size: 72 }).renderToBuffer(slot());
    expect(buffer.readUInt32BE(16)).toBe(72);
  });
});
