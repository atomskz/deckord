import { describe, expect, it } from 'vitest';
import type { ServiceToClientMessage } from '@deckord/ipc-contract';
import type { DeckButtonEvent, DeckButtonEventKind, RenderedDeckSlot } from '@deckord/shared';
import { DebugBrowserDeckAdapter } from './DebugBrowserDeckAdapter';
import type { DeckCapabilities, DeckWire } from './types';

class FakeWire implements DeckWire {
  readonly messages: ServiceToClientMessage[] = [];
  private handler?: (event: { kind: DeckButtonEventKind; slotIndex: number }) => void;
  broadcast(message: ServiceToClientMessage): void {
    this.messages.push(message);
  }
  onButton(handler: (event: { kind: DeckButtonEventKind; slotIndex: number }) => void): void {
    this.handler = handler;
  }
  press(kind: DeckButtonEventKind, slotIndex: number): void {
    this.handler?.({ kind, slotIndex });
  }
}

const capabilities: DeckCapabilities = {
  rows: 2,
  columns: 5,
  slotCount: 10,
  imageFormats: ['css'],
  hasTextApi: true,
};

function userSlot(): RenderedDeckSlot {
  return {
    slotIndex: 0,
    kind: 'user',
    userId: 'u1',
    title: 'Nova',
    badges: [],
    visualState: { speaking: true, muted: false, deafened: false, disconnected: false, selected: false },
  };
}

describe('DebugBrowserDeckAdapter', () => {
  it('reports its capabilities and layout spec', () => {
    const adapter = new DebugBrowserDeckAdapter(new FakeWire(), capabilities);
    expect(adapter.getCapabilities()).toEqual(capabilities);
    expect(adapter.getLayoutSpec().slotCount).toBe(10);
    expect(adapter.getCapabilities().imageFormats).toContain('css');
  });

  it('broadcasts a slot_update on setSlot, preserving userId', async () => {
    const wire = new FakeWire();
    const adapter = new DebugBrowserDeckAdapter(wire, capabilities);
    await adapter.setSlot(0, userSlot());
    expect(wire.messages).toHaveLength(1);
    const msg = wire.messages[0]!;
    expect(msg.type).toBe('slot_update');
    if (msg.type === 'slot_update') {
      expect(msg.payload.slotIndex).toBe(0);
      expect(msg.payload.slot.userId).toBe('u1');
      expect(msg.payload.slot.visualState.speaking).toBe(true);
    }
  });

  it('clearAll broadcasts one empty slot_update per slot', async () => {
    const wire = new FakeWire();
    const adapter = new DebugBrowserDeckAdapter(wire, capabilities);
    await adapter.clearAll();
    expect(wire.messages).toHaveLength(10);
    expect(wire.messages.every((m) => m.type === 'slot_update')).toBe(true);
  });

  it('forwards wire button presses to the registered handlers', () => {
    const wire = new FakeWire();
    const adapter = new DebugBrowserDeckAdapter(wire, capabilities);
    const down: DeckButtonEvent[] = [];
    const up: DeckButtonEvent[] = [];
    adapter.onButtonDown((e) => down.push(e));
    adapter.onButtonUp((e) => up.push(e));

    wire.press('down', 3);
    wire.press('up', 3);

    expect(down).toHaveLength(1);
    expect(down[0]!.slotIndex).toBe(3);
    expect(down[0]!.deckId).toBe('debug-browser');
    expect(up).toHaveLength(1);
    expect(up[0]!.kind).toBe('up');
  });
});
