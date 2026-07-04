/**
 * The Elgato Stream Deck / OpenDeck plugin protocol — only the subset Deckord
 * uses. Events flow host → plugin; commands flow plugin → host. In Variant B the
 * host-launched relay pipes these frames verbatim to/from the Deckord service, so
 * this module speaks the protocol without doing the host register handshake (the
 * relay does that).
 */

export type ElgatoController = 'Keypad' | 'Encoder';
export type ElgatoCoordinates = { column: number; row: number };

export type ElgatoDeviceInfo = {
  name?: string;
  type?: number;
  size?: { columns: number; rows: number };
};

export type ElgatoAppearance = {
  context: string;
  device: string;
  coordinates?: ElgatoCoordinates;
  controller: ElgatoController;
};

/** Inbound events (host → plugin), the subset we handle. */
export type ElgatoInboundEvent =
  | { event: 'deviceDidConnect'; device: string; deviceInfo: ElgatoDeviceInfo }
  | { event: 'deviceDidDisconnect'; device: string }
  | { event: 'willAppear'; context: string; device: string; coordinates?: ElgatoCoordinates; controller: ElgatoController }
  | { event: 'willDisappear'; context: string; device: string }
  | { event: 'keyDown'; context: string; device: string }
  | { event: 'keyUp'; context: string; device: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function coords(payload: unknown): ElgatoCoordinates | undefined {
  const p = asRecord(payload);
  const c = p ? asRecord(p.coordinates) : null;
  if (!c || typeof c.column !== 'number' || typeof c.row !== 'number') return undefined;
  return { column: c.column, row: c.row };
}

/** Parse a raw frame into a typed inbound event, or null if unrecognized. */
export function parseInboundEvent(raw: unknown): ElgatoInboundEvent | null {
  const f = asRecord(raw);
  if (!f || typeof f.event !== 'string') return null;
  const context = typeof f.context === 'string' ? f.context : '';
  const device = typeof f.device === 'string' ? f.device : '';

  switch (f.event) {
    case 'deviceDidConnect': {
      const info = asRecord(f.deviceInfo) ?? {};
      const size = asRecord(info.size);
      const deviceInfo: ElgatoDeviceInfo = {
        name: typeof info.name === 'string' ? info.name : undefined,
        type: typeof info.type === 'number' ? info.type : undefined,
        size:
          size && typeof size.columns === 'number' && typeof size.rows === 'number'
            ? { columns: size.columns, rows: size.rows }
            : undefined,
      };
      return device ? { event: 'deviceDidConnect', device, deviceInfo } : null;
    }
    case 'deviceDidDisconnect':
      return device ? { event: 'deviceDidDisconnect', device } : null;
    case 'willAppear':
    case 'willDisappear': {
      if (!context) return null;
      if (f.event === 'willDisappear') return { event: 'willDisappear', context, device };
      const payload = asRecord(f.payload);
      const controller: ElgatoController = payload?.controller === 'Encoder' ? 'Encoder' : 'Keypad';
      return { event: 'willAppear', context, device, coordinates: coords(f.payload), controller };
    }
    case 'keyDown':
    case 'keyUp':
      return context ? { event: f.event, context, device } : null;
    default:
      return null;
  }
}

// --- outbound commands (plugin → host) -------------------------------------

export function setImageCommand(context: string, imageDataUrl: string): unknown {
  return { event: 'setImage', context, payload: { image: imageDataUrl, target: 0 } };
}

export function setTitleCommand(context: string, title: string): unknown {
  return { event: 'setTitle', context, payload: { title, target: 0 } };
}

/** Clear a key's image (host renders the action's default). */
export function clearImageCommand(context: string): unknown {
  return { event: 'setImage', context, payload: { target: 0 } };
}
