import {
  clearImageCommand,
  parseInboundEvent,
  setImageCommand,
  setTitleCommand,
  type ElgatoAppearance,
  type ElgatoDeviceInfo,
} from './protocol';

/**
 * The wire the transport talks over — a WebSocket to the relay in Variant B.
 * Injected so this package stays free of any concrete transport (`ws`) and is
 * unit-testable with a fake link.
 */
export interface ElgatoLink {
  send(frame: unknown): void;
  onFrame(handler: (frame: unknown) => void): void;
  onClose(handler: () => void): void;
}

type Handler<T> = (value: T) => void;

/**
 * Speaks the Elgato plugin protocol: turns inbound frames into typed callbacks
 * and sends typed commands. It does NOT do the host register handshake — in
 * Variant B the relay owns that; here we only exchange events/commands.
 */
export class OpenDeckPluginTransport {
  private readonly deviceConnect: Handler<{ device: string; info: ElgatoDeviceInfo }>[] = [];
  private readonly deviceDisconnect: Handler<string>[] = [];
  private readonly appear: Handler<ElgatoAppearance>[] = [];
  private readonly disappear: Handler<string>[] = [];
  private readonly keyDown: Handler<string>[] = [];
  private readonly keyUp: Handler<string>[] = [];
  private readonly close: Handler<void>[] = [];

  constructor(private readonly link: ElgatoLink) {
    this.link.onFrame((frame) => this.dispatch(frame));
    this.link.onClose(() => this.close.forEach((h) => h()));
  }

  onDeviceConnect(h: Handler<{ device: string; info: ElgatoDeviceInfo }>): void {
    this.deviceConnect.push(h);
  }
  onDeviceDisconnect(h: Handler<string>): void {
    this.deviceDisconnect.push(h);
  }
  onWillAppear(h: Handler<ElgatoAppearance>): void {
    this.appear.push(h);
  }
  onWillDisappear(h: Handler<string>): void {
    this.disappear.push(h);
  }
  onKeyDown(h: Handler<string>): void {
    this.keyDown.push(h);
  }
  onKeyUp(h: Handler<string>): void {
    this.keyUp.push(h);
  }
  onClose(h: Handler<void>): void {
    this.close.push(h);
  }

  setImage(context: string, imageDataUrl: string): void {
    this.link.send(setImageCommand(context, imageDataUrl));
  }
  setTitle(context: string, title: string): void {
    this.link.send(setTitleCommand(context, title));
  }
  clearImage(context: string): void {
    this.link.send(clearImageCommand(context));
  }

  private dispatch(frame: unknown): void {
    const event = parseInboundEvent(frame);
    if (!event) return;
    switch (event.event) {
      case 'info':
        for (const d of event.devices) {
          this.deviceConnect.forEach((h) => h({ device: d.id, info: d.info }));
        }
        break;
      case 'deviceDidConnect':
        this.deviceConnect.forEach((h) => h({ device: event.device, info: event.deviceInfo }));
        break;
      case 'deviceDidDisconnect':
        this.deviceDisconnect.forEach((h) => h(event.device));
        break;
      case 'willAppear':
        this.appear.forEach((h) =>
          h({ context: event.context, device: event.device, coordinates: event.coordinates, controller: event.controller }),
        );
        break;
      case 'willDisappear':
        this.disappear.forEach((h) => h(event.context));
        break;
      case 'keyDown':
        this.keyDown.forEach((h) => h(event.context));
        break;
      case 'keyUp':
        this.keyUp.forEach((h) => h(event.context));
        break;
    }
  }
}
