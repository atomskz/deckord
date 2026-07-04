import { describe, expect, it } from 'vitest';
import type { DeckButtonEvent, RenderedDeckSlot } from '@deckord/shared';
import type { DeckCapabilities } from '@deckord/deck-adapter';
import { OpenDeckAdapter } from './OpenDeckAdapter';
import { OpenDeckPluginTransport, type ElgatoLink } from './OpenDeckPluginTransport';

class FakeLink implements ElgatoLink {
  readonly sent: Array<{ event: string; context: string; payload?: { image?: string } }> = [];
  private frameHandler?: (frame: unknown) => void;
  send(frame: unknown): void {
    this.sent.push(frame as { event: string; context: string; payload?: { image?: string } });
  }
  onFrame(h: (frame: unknown) => void): void {
    this.frameHandler = h;
  }
  onClose(): void {
    /* not used here */
  }
  feed(frame: unknown): void {
    this.frameHandler?.(frame);
  }
}

function userSlot(index: number, title: string): RenderedDeckSlot {
  return {
    slotIndex: index,
    kind: 'user',
    userId: `u${index}`,
    title,
    badges: [],
    visualState: { speaking: false, muted: false, deafened: false, disconnected: false, selected: false },
  };
}

function appear(context: string, column: number, row: number, controller: 'Keypad' | 'Encoder' = 'Keypad') {
  return { event: 'willAppear', context, device: 'd1', payload: { coordinates: { column, row }, controller } };
}

describe('OpenDeckAdapter', () => {
  function setup() {
    const link = new FakeLink();
    const adapter = new OpenDeckAdapter(new OpenDeckPluginTransport(link), { iconSize: 72 });
    const caps: DeckCapabilities[] = [];
    adapter.onCapabilitiesChanged((c) => caps.push(c));
    return { link, adapter, caps };
  }

  it('builds capabilities from assigned keypad contexts, ordered by (row,column)', () => {
    const { link, adapter, caps } = setup();
    link.feed({ event: 'deviceDidConnect', device: 'd1', deviceInfo: { size: { columns: 4, rows: 2 } } });
    link.feed(appear('b', 1, 0)); // row0 col1
    link.feed(appear('a', 0, 0)); // row0 col0  -> should sort before b
    link.feed(appear('e', 0, 1, 'Encoder')); // encoder, not a slot

    const c = adapter.getCapabilities();
    expect(c.slotCount).toBe(2);
    expect(c.knobCount).toBe(1);
    expect(c.imageFormats).toEqual(['png']);
    // fires for each keypad change (b, then a) AND for the encoder (knobCount 0->1)
    expect(caps.length).toBe(3);
    expect(caps.at(-1)?.slotCount).toBe(2);
    expect(caps.at(-1)?.knobCount).toBe(1);
  });

  it('setSlot renders a PNG and sends setImage to the ordered context', async () => {
    const { link, adapter } = setup();
    link.feed(appear('a', 0, 0));
    link.feed(appear('b', 1, 0));

    await adapter.setSlot(0, userSlot(0, 'Nova'));
    const img = link.sent.find((f) => f.event === 'setImage');
    expect(img?.context).toBe('a'); // slot 0 -> first ordered context
    expect(img?.payload?.image?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('maps key presses back to slot indices', () => {
    const { link, adapter } = setup();
    link.feed(appear('a', 0, 0));
    link.feed(appear('b', 1, 0));
    const events: DeckButtonEvent[] = [];
    adapter.onButtonDown((e) => events.push(e));

    link.feed({ event: 'keyDown', context: 'b', device: 'd1' });

    expect(events).toHaveLength(1);
    expect(events[0]!.slotIndex).toBe(1);
    expect(events[0]!.deckId).toBe('opendeck');
  });

  it('recomputes capabilities when a key is unassigned', () => {
    const { link, adapter, caps } = setup();
    link.feed(appear('a', 0, 0));
    link.feed(appear('b', 1, 0));
    link.feed({ event: 'willDisappear', context: 'a', device: 'd1' });
    expect(adapter.getCapabilities().slotCount).toBe(1);
    expect(caps.at(-1)?.slotCount).toBe(1);
  });
});
