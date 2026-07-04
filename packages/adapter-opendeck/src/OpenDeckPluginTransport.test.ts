import { describe, expect, it } from 'vitest';
import { OpenDeckPluginTransport, type ElgatoLink } from './OpenDeckPluginTransport';
import { parseInboundEvent } from './protocol';

class FakeLink implements ElgatoLink {
  readonly sent: unknown[] = [];
  private frameHandler?: (frame: unknown) => void;
  private closeHandler?: () => void;
  send(frame: unknown): void {
    this.sent.push(frame);
  }
  onFrame(h: (frame: unknown) => void): void {
    this.frameHandler = h;
  }
  onClose(h: () => void): void {
    this.closeHandler = h;
  }
  feed(frame: unknown): void {
    this.frameHandler?.(frame);
  }
  fireClose(): void {
    this.closeHandler?.();
  }
}

describe('parseInboundEvent', () => {
  it('parses willAppear with coordinates + controller', () => {
    expect(
      parseInboundEvent({
        event: 'willAppear',
        context: 'ctx1',
        device: 'dev1',
        payload: { coordinates: { column: 2, row: 1 }, controller: 'Keypad' },
      }),
    ).toEqual({ event: 'willAppear', context: 'ctx1', device: 'dev1', coordinates: { column: 2, row: 1 }, controller: 'Keypad' });
  });

  it('parses deviceDidConnect size', () => {
    expect(
      parseInboundEvent({ event: 'deviceDidConnect', device: 'd', deviceInfo: { type: 7, size: { columns: 4, rows: 2 } } }),
    ).toMatchObject({ event: 'deviceDidConnect', device: 'd', deviceInfo: { type: 7, size: { columns: 4, rows: 2 } } });
  });

  it('returns null for unknown or malformed frames', () => {
    expect(parseInboundEvent({ event: 'somethingElse' })).toBeNull();
    expect(parseInboundEvent(null)).toBeNull();
    expect(parseInboundEvent({ event: 'keyDown' })).toBeNull(); // no context
  });
});

describe('OpenDeckPluginTransport', () => {
  it('dispatches inbound events to typed handlers', () => {
    const link = new FakeLink();
    const t = new OpenDeckPluginTransport(link);
    const seen: string[] = [];
    t.onDeviceConnect(({ device, info }) => seen.push(`connect:${device}:${info.size?.columns}x${info.size?.rows}`));
    t.onWillAppear((a) => seen.push(`appear:${a.context}:${a.controller}:${a.coordinates?.column},${a.coordinates?.row}`));
    t.onKeyDown((c) => seen.push(`down:${c}`));

    link.feed({ event: 'deviceDidConnect', device: 'd1', deviceInfo: { size: { columns: 4, rows: 2 } } });
    link.feed({ event: 'willAppear', context: 'k1', device: 'd1', payload: { coordinates: { column: 0, row: 0 }, controller: 'Keypad' } });
    link.feed({ event: 'keyDown', context: 'k1', device: 'd1' });
    link.feed({ event: 'noise' });

    expect(seen).toEqual(['connect:d1:4x2', 'appear:k1:Keypad:0,0', 'down:k1']);
  });

  it('sends setImage / setTitle / clearImage frames', () => {
    const link = new FakeLink();
    const t = new OpenDeckPluginTransport(link);
    t.setImage('k1', 'data:image/png;base64,AAA');
    t.setTitle('k1', 'Nova');
    t.clearImage('k1');
    expect(link.sent).toEqual([
      { event: 'setImage', context: 'k1', payload: { image: 'data:image/png;base64,AAA', target: 0 } },
      { event: 'setTitle', context: 'k1', payload: { title: 'Nova', target: 0 } },
      { event: 'setImage', context: 'k1', payload: { target: 0 } },
    ]);
  });

  it('forwards link close', () => {
    const link = new FakeLink();
    const t = new OpenDeckPluginTransport(link);
    let closed = false;
    t.onClose(() => (closed = true));
    link.fireClose();
    expect(closed).toBe(true);
  });
});
