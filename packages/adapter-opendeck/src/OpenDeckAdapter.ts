import type {
  DeckButtonHandler,
  DeckCapabilities,
  IDeckAdapter,
} from '@deckord/deck-adapter';
import { SlotImageRenderer, type AvatarInput } from '@deckord/image-renderer';
import type { RenderTheme } from '@deckord/renderer';
import type { DeckButtonEvent, DeckButtonEventKind, DeckLayoutSpec, RenderedDeckSlot } from '@deckord/shared';
import type { OpenDeckPluginTransport } from './OpenDeckPluginTransport';
import type { ElgatoController, ElgatoCoordinates, ElgatoDeviceInfo } from './protocol';

/** Resolves avatar bytes/path for a slot (backed by the service's AvatarCache). */
export type OpenDeckAvatarResolver = (slot: RenderedDeckSlot) => Promise<AvatarInput | undefined>;

export type OpenDeckAdapterOptions = {
  theme?: RenderTheme;
  /** Square key image size in px (default 96). Later derived from the device type. */
  iconSize?: number;
  resolveAvatar?: OpenDeckAvatarResolver;
};

type ContextInfo = { device: string; coordinates?: ElgatoCoordinates; controller: ElgatoController };

/**
 * Drives an OpenDeck / Elgato deck via the plugin protocol. The device is
 * whatever OpenDeck supports; layout is learned dynamically from `deviceDidConnect`
 * and `willAppear` (the keys the user assigned the Deckord action to). Slot i maps
 * to the i-th assigned keypad context, ordered by (row, column).
 */
export class OpenDeckAdapter implements IDeckAdapter {
  readonly id = 'opendeck';
  readonly name = 'OpenDeck';

  private readonly images: SlotImageRenderer;
  private readonly iconSize: number;
  private readonly resolveAvatar?: OpenDeckAvatarResolver;

  private readonly devices = new Map<string, ElgatoDeviceInfo>();
  private readonly contexts = new Map<string, ContextInfo>();
  private keypadOrder: string[] = []; // slotIndex → context
  private lastKnobCount = 0;
  /** Last image pushed per context, so we can re-paint on re-appearance. */
  private readonly lastImage = new Map<string, string>();

  private readonly downHandlers: DeckButtonHandler[] = [];
  private readonly upHandlers: DeckButtonHandler[] = [];
  private readonly capabilityHandlers: ((capabilities: DeckCapabilities) => void)[] = [];

  constructor(
    private readonly transport: OpenDeckPluginTransport,
    options: OpenDeckAdapterOptions = {},
  ) {
    this.iconSize = options.iconSize ?? 96;
    this.resolveAvatar = options.resolveAvatar;
    this.images = new SlotImageRenderer({ theme: options.theme, size: this.iconSize });

    transport.onDeviceConnect(({ device, info }) => {
      this.devices.set(device, info);
    });
    transport.onDeviceDisconnect((device) => {
      this.devices.delete(device);
      for (const [ctx, info] of this.contexts) {
        if (info.device === device) {
          this.contexts.delete(ctx);
          this.lastImage.delete(ctx);
        }
      }
      this.recompute();
    });
    transport.onWillAppear((a) => {
      this.contexts.set(a.context, { device: a.device, coordinates: a.coordinates, controller: a.controller });
      // Elgato/OpenDeck resets a key to the action's default icon whenever it
      // (re)appears — which also happens when the user edits the profile (adds any
      // widget), re-firing willAppear for every visible key. If the slot order is
      // unchanged that produces no capability change and thus no re-render, so the
      // keys would stay stuck on the placeholder. Re-push the last image we sent for
      // this context immediately so it survives a re-appearance.
      const cached = this.lastImage.get(a.context);
      if (cached) this.transport.setImage(a.context, cached);
      this.recompute();
    });
    transport.onWillDisappear((context) => {
      this.contexts.delete(context);
      this.lastImage.delete(context);
      this.recompute();
    });
    transport.onKeyDown((context) => this.emitButton('down', context));
    transport.onKeyUp((context) => this.emitButton('up', context));
  }

  async start(): Promise<void> {
    /* The relay/WS lifecycle is owned by the service. */
  }
  async stop(): Promise<void> {
    /* no-op */
  }

  getLayoutSpec(): DeckLayoutSpec {
    return this.getCapabilities();
  }

  getCapabilities(): DeckCapabilities {
    const slotCount = this.keypadOrder.length;
    const knobCount = [...this.contexts.values()].filter((c) => c.controller === 'Encoder').length;
    // A flat 1×N logical grid of the assigned keys (physical coordinates are internal).
    return {
      rows: 1,
      columns: Math.max(1, slotCount),
      slotCount,
      iconSize: { width: this.iconSize, height: this.iconSize },
      imageFormats: ['png'],
      knobCount: knobCount || undefined,
      hasTextApi: true,
    };
  }

  onCapabilitiesChanged(handler: (capabilities: DeckCapabilities) => void): void {
    this.capabilityHandlers.push(handler);
  }

  async setSlot(slotIndex: number, slot: RenderedDeckSlot): Promise<void> {
    const context = this.keypadOrder[slotIndex];
    if (!context) return; // no key assigned at this index
    try {
      const avatar = this.resolveAvatar ? await this.resolveAvatar(slot) : undefined;
      const dataUrl = await this.images.renderToDataUrl(slot, avatar);
      this.transport.setImage(context, dataUrl);
      this.lastImage.set(context, dataUrl);
    } catch {
      // A per-slot avatar/rasterize failure must not abort the host's batch (it
      // awaits setSlot for every changed slot); skip this key, repaint next update.
    }
  }

  async clearSlot(slotIndex: number): Promise<void> {
    const context = this.keypadOrder[slotIndex];
    if (context) {
      this.transport.clearImage(context);
      this.lastImage.delete(context);
    }
  }

  async clearAll(): Promise<void> {
    for (const context of this.keypadOrder) {
      this.transport.clearImage(context);
      this.lastImage.delete(context);
    }
  }

  onButtonDown(handler: DeckButtonHandler): void {
    this.downHandlers.push(handler);
  }
  onButtonUp(handler: DeckButtonHandler): void {
    this.upHandlers.push(handler);
  }

  // --- internal ------------------------------------------------------------

  private emitButton(kind: DeckButtonEventKind, context: string): void {
    const slotIndex = this.keypadOrder.indexOf(context);
    if (slotIndex < 0) return;
    const event: DeckButtonEvent = { kind, slotIndex, deckId: this.id, timestamp: Date.now() };
    const handlers = kind === 'down' ? this.downHandlers : this.upHandlers;
    for (const handler of handlers) handler(event);
  }

  /** Recompute the slot order from the assigned keypad contexts; fire on change. */
  private recompute(): void {
    const order = [...this.contexts.entries()]
      .filter(([, info]) => info.controller === 'Keypad')
      // Sort by (row, column); break ties deterministically by context id so the
      // order is stable even if the host re-emits willAppear in a different order.
      .sort(([ctxA, a], [ctxB, b]) => byCoordinates(a, b) || (ctxA < ctxB ? -1 : ctxA > ctxB ? 1 : 0))
      .map(([context]) => context);
    const knobCount = [...this.contexts.values()].filter((c) => c.controller === 'Encoder').length;

    const orderChanged =
      order.length !== this.keypadOrder.length || order.some((c, i) => c !== this.keypadOrder[i]);
    const knobChanged = knobCount !== this.lastKnobCount;
    this.keypadOrder = order;
    this.lastKnobCount = knobCount;
    if (orderChanged || knobChanged) {
      const capabilities = this.getCapabilities();
      for (const handler of this.capabilityHandlers) handler(capabilities);
    }
  }
}

function byCoordinates(a: ContextInfo, b: ContextInfo): number {
  const rowDiff = (a.coordinates?.row ?? 0) - (b.coordinates?.row ?? 0);
  if (rowDiff !== 0) return rowDiff;
  return (a.coordinates?.column ?? 0) - (b.coordinates?.column ?? 0);
}
