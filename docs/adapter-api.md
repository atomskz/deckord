# Deck Adapter API

This guide explains how to implement a new `IDeckAdapter` for Deckord: a
concrete driver for one class of deck (a browser debug view, an OpenDeck
device, a StreamDock/AJAZZ, an Elgato Stream Deck, …). It is aimed at anyone
adding support for a new physical or virtual deck.

The adapter is **the replaceable bottom layer**. Everything above it (Discord
voice, `deck-core`, `renderer`) is device-agnostic. Only the concrete adapter
knows how to paint buttons and read presses on a specific target.

Source of truth for the shapes and behavior described here:

- `packages/deck-adapter/src/IDeckAdapter.ts` — the contract
- `packages/deck-adapter/src/DeckAdapterHost.ts` — the driver (diffing)
- `packages/deck-adapter/src/DebugBrowserDeckAdapter.ts` — the reference adapter
- `packages/deck-adapter/src/types.ts` — `DeckWire` (debug transport only)
- `packages/shared/src/domain/deck.ts` — `RenderedDeckSlot`, `DeckLayoutSpec`, `DeckButtonEvent`, …
- `packages/renderer/src/renderSlot.ts` — `renderLayout` / `toRenderedSlot`
- `apps/deckord-service/src/DeckordService.ts` — the single wiring point
- `apps/deckord-service/src/server/WsServer.ts` — the debug `DeckWire` implementation

---

## 1. The pipeline

`DeckordService` owns the whole chain and is the only place that knows all the
parts exist:

```
VoiceService → SlotManager (deck-core) → renderer → DeckAdapterHost → adapter → device
```

- **`VoiceService`** emits `VoiceChannelState` (who is in the channel, their
  mute/deaf/speaking state).
- **`SlotManager`** (`deck-core`) turns that state into a **logical**
  `DeckLayout` — a grid of `DeckSlot`s with `kind`, `userId`, `visualState`,
  paging, but no presentational fields.
- **`renderer`** (`renderLayout`) enriches each slot in place with `title`,
  `subtitle`, `image`, `badges`, `accessibilityLabel`.
- **`DeckAdapterHost`** diffs the enriched layout against the previous one and
  calls `adapter.setSlot(...)` only for slots that changed.
- **The adapter** translates `RenderedDeckSlot` into device/transport calls and
  reports button presses back up.

Your adapter is responsible for exactly the last hop. Nothing else.

---

## 2. The contract: `IDeckAdapter`

From `packages/deck-adapter/src/IDeckAdapter.ts`:

```ts
export interface IDeckAdapter {
  readonly id: string;
  readonly name: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Physical/virtual capabilities of this deck (grid size, icon size, knobs). */
  getLayoutSpec(): DeckLayoutSpec;

  setSlot(slotIndex: number, slot: RenderedDeckSlot): Promise<void>;
  clearSlot(slotIndex: number): Promise<void>;
  clearAll(): Promise<void>;

  onButtonDown(handler: (event: DeckButtonEvent) => void): void;
  onButtonUp(handler: (event: DeckButtonEvent) => void): void;
}

export type DeckButtonHandler = (event: DeckButtonEvent) => void;
```

### `id` / `name`

- `id` — a short, stable machine identifier (`'debug-browser'`). It is exposed
  by the host as `DeckAdapterHost.adapterId`, and every `DeckButtonEvent` your
  adapter emits must stamp `deckId` with it.
- `name` — a human-readable label (`'Debug Browser Deck'`).

### `start()` / `stop()`

Lifecycle. `start()` should acquire the device/transport (open the USB device,
connect to the SDK, register button listeners); `stop()` releases it. Both are
`async`.

`DeckordService.start()` calls `host.start()` (which delegates to
`adapter.start()`) and `DeckordService.stop()` calls `host.stop()`. In the
debug adapter both are effectively no-ops because the WebSocket server's
lifecycle is owned separately by the service — a physical adapter will do real
work here.

### `getLayoutSpec(): DeckLayoutSpec`

Advertise the device's capabilities. From `packages/shared/src/domain/deck.ts`:

```ts
export type DeckLayoutSpec = {
  rows: number;
  columns: number;
  slotCount: number;
  hasKnobs?: boolean;
  iconSize?: { width: number; height: number };
};
```

For a physical deck, `slotCount`, `rows`, `columns`, and (importantly)
`iconSize` come from the hardware, not from `deck-core`'s defaults.

### `setSlot(slotIndex, slot: RenderedDeckSlot)`

Paint one button. Given a slot index and a fully rendered slot, push it to the
device/transport. This is the hot path — the host calls it once per changed
slot. See section 4 for the shape of `RenderedDeckSlot`.

### `clearSlot(slotIndex)` / `clearAll()`

Blank one button / all buttons. In the debug adapter `clearSlot` broadcasts an
`empty` slot and `clearAll` loops `0..slotCount-1` calling `clearSlot`. A
physical adapter would clear the key image (and title, where applicable).

Note: `DeckAdapterHost.apply()` never calls `clearSlot`/`clearAll` itself — it
only calls `setSlot`. Clearing happens through `DeckAdapterHost.reset()` (which
calls `clearAll()` and drops the diff cache), and internally an adapter may use
`clearSlot` from its own `clearAll`.

### `onButtonDown(handler)` / `onButtonUp(handler)`

Register press/release callbacks. When the device (or transport) reports a
press, build a `DeckButtonEvent` and invoke every registered handler. From
`packages/shared/src/domain/deck.ts`:

```ts
export type DeckButtonEvent = {
  kind: DeckButtonEventKind; // 'down' | 'up'
  slotIndex: number;
  deckId: string;
  timestamp: number;
};
```

Handlers are registered, not replaced — store them in an array and call all of
them (see the reference adapter). `DeckordService` registers exactly one down
handler today (`this.host.onButtonDown(...)`) and no up handler, but adapters
must support multiple.

---

## 3. How `DeckAdapterHost` drives the adapter (diffing)

`DeckAdapterHost` (`packages/deck-adapter/src/DeckAdapterHost.ts`) is the
generic driver. It is constructed with an adapter and a **slot mapper**:

```ts
export type SlotMapper = (slot: DeckSlot) => RenderedDeckSlot;

constructor(
  private readonly adapter: IDeckAdapter,
  private readonly toRendered: SlotMapper,
) {}
```

In `DeckordService` the mapper is `toRenderedSlot` from the renderer:

```ts
this.host = new DeckAdapterHost(adapter, toRenderedSlot);
```

The core method is `apply(layout: DeckLayout)`:

```ts
async apply(layout: DeckLayout): Promise<number[]> {
  const changed: number[] = [];
  for (const slot of layout.slots) {
    const rendered = this.toRendered(slot);
    const key = JSON.stringify(rendered);
    if (this.previous.get(slot.slotIndex) !== key) {
      await this.adapter.setSlot(slot.slotIndex, rendered);
      this.previous.set(slot.slotIndex, key);
      changed.push(slot.slotIndex);
    }
  }
  return changed;
}
```

What this buys your adapter:

- **Per-slot diffing.** The host keeps a `Map<number, string>` of the last
  `JSON.stringify(rendered)` per slot index. It only calls `setSlot` for slots
  whose serialized rendered form actually changed. This matters for slow
  physical decks (USB/SDK writes are expensive) and is harmless for the debug
  deck.
- **You never see full-layout logic.** Your adapter receives isolated
  `setSlot(index, slot)` calls; it does not reason about pages, users, or which
  slot is which. `DeckordService.refreshDeck` → `pushLayout` → `host.apply` is
  what feeds it.

`reset()` clears the diff cache and calls `adapter.clearAll()` — use it when you
need to force a full repaint (e.g. after a device reconnect).

Because diffing depends on `JSON.stringify(rendered)`, keep `toRenderedSlot`'s
output deterministic (stable key ordering, no timestamps). `imageDataUrl` being
`undefined` today (section 4) means physical-deck image bytes are not part of
the diff key yet — a future PNG renderer must supply a stable value there so
image-only changes are detected.

---

## 4. `RenderedDeckSlot`: one shape, two kinds of deck

`toRenderedSlot` (`packages/renderer/src/renderSlot.ts`) maps an enriched
`DeckSlot` to the adapter-facing `RenderedDeckSlot`:

```ts
export function toRenderedSlot(slot: DeckSlot): RenderedDeckSlot {
  return {
    slotIndex: slot.slotIndex,
    kind: slot.kind,
    title: slot.title,
    subtitle: slot.subtitle,
    image: slot.image,
    imageDataUrl: undefined,
    badges: slot.badges ?? [],
    visualState: slot.visualState,
    accessibilityLabel: slot.accessibilityLabel,
  };
}
```

`RenderedDeckSlot` (`packages/shared/src/domain/deck.ts`):

```ts
export type RenderedDeckSlot = {
  slotIndex: number;
  kind: DeckSlotKind;          // 'user' | 'empty' | 'status' | 'page'
  title?: string;
  subtitle?: string;
  image?: string;              // URL / path — for CSS decks
  imageDataUrl?: string;       // rendered PNG bytes — for physical decks
  badges: DeckBadge[];
  visualState: DeckVisualState;
  accessibilityLabel?: string;
};
```

`RenderedDeckSlot` is deliberately a **superset** so that one `setSlot` contract
serves both families of deck:

- **CSS / debug decks** consume the semantic fields directly —
  `title`, `subtitle`, `image` (a URL or path), `badges`, and `visualState` —
  and do their own styling on the client. The `DebugBrowserDeckAdapter` sends
  these over the wire and the browser renders them with CSS.
- **Physical decks** cannot render CSS; they need finished pixels. They will
  read `imageDataUrl` — a base64 PNG rendered server-side — and upload it to the
  key. Devices that also have a text/title API (Elgato, some StreamDock modes)
  can additionally use `title`/`subtitle`.

Right now `toRenderedSlot` always sets `imageDataUrl: undefined`. Server-side
PNG generation (sharp/canvas) is a future phase; when it lands, a physical
adapter reads `imageDataUrl`, and the debug adapter keeps reading `image`.
Design your adapter to prefer `imageDataUrl` when present and fall back to
`image`/`title` only if the device supports them.

The supporting shapes an adapter may care about:

- `DeckSlotKind` = `'user' | 'empty' | 'status' | 'page'`.
- `DeckVisualState` = `{ speaking, muted, deafened, disconnected, selected }` —
  booleans a device can map to LED/border/tint if it wants; the debug deck
  passes them through for CSS styling.
- `DeckBadge` = `{ type, label }` where `label` is a short glyph/emoji intended
  for a CSS renderer. A physical deck typically ignores badges (they are baked
  into the PNG instead).

---

## 5. Worked example: `DebugBrowserDeckAdapter`

The reference implementation
(`packages/deck-adapter/src/DebugBrowserDeckAdapter.ts`) is a full adapter that
targets a **browser** over a WebSocket, not hardware. It shows the exact
translation pattern a physical adapter follows.

It talks to a **`DeckWire`** (`packages/deck-adapter/src/types.ts`) instead of a
device SDK:

```ts
export interface DeckWire {
  broadcast(message: ServiceToClientMessage): void;
  onButton(handler: (event: { kind: DeckButtonEventKind; slotIndex: number }) => void): void;
}
```

Keeping `DeckWire` narrow is what lets the `deck-adapter` package stay free of
any concrete transport dependency (`ws`, USB, …). The debug transport is
implemented by `WsServer` (`apps/deckord-service/src/server/WsServer.ts`), which
`implements DeckWire`: `broadcast` fans a message out to all connected browser
clients, and `onButton` is fed from decoded `button_down` / `button_up`
WebSocket messages.

### Construction and button input

```ts
constructor(
  private readonly wire: DeckWire,
  private readonly spec: DeckLayoutSpec,
) {
  this.wire.onButton(({ kind, slotIndex }) => {
    const event: DeckButtonEvent = {
      kind,
      slotIndex,
      deckId: this.id,          // stamped with 'debug-browser'
      timestamp: Date.now(),
    };
    const handlers = kind === 'down' ? this.downHandlers : this.upHandlers;
    for (const handler of handlers) handler(event);
  });
}
```

The adapter subscribes to the wire's raw `{ kind, slotIndex }` events, wraps
each into a full `DeckButtonEvent` (adding `deckId` and `timestamp`), and
dispatches to the correct handler list.

### Lifecycle

```ts
async start(): Promise<void> {
  /* Wire lifecycle is owned by the service's WebSocket server. */
}
async stop(): Promise<void> { /* no-op */ }
```

The WebSocket server is started/stopped by `DeckordService`, so the adapter's
own lifecycle is empty here. A physical adapter would open/close the device
instead.

### Painting

```ts
async setSlot(slotIndex: number, slot: RenderedDeckSlot): Promise<void> {
  this.wire.broadcast({
    type: 'slot_update',
    payload: { slotIndex, slot: renderedToDeckSlot(slot) },
  });
}

async clearSlot(slotIndex: number): Promise<void> {
  this.wire.broadcast({
    type: 'slot_update',
    payload: { slotIndex, slot: emptyDeckSlot(slotIndex) },
  });
}

async clearAll(): Promise<void> {
  for (let i = 0; i < this.spec.slotCount; i++) {
    await this.clearSlot(i);
  }
}
```

`renderedToDeckSlot` narrows the `RenderedDeckSlot` back to the `DeckSlot` the
browser client expects (dropping `imageDataUrl`, keeping `image`/`title`/etc.),
and `emptyDeckSlot` produces a blanked `kind: 'empty'` slot with
`EMPTY_VISUAL_STATE`. The whole adapter is a pure translator: **no Discord
logic, no assignment logic** — see the invariant below.

---

## 6. The invariant: adapters are dumb translators

This is the rule that keeps the architecture swappable, stated in both
`IDeckAdapter.ts` and `DebugBrowserDeckAdapter.ts`:

> An adapter contains **ZERO Discord logic** and **ZERO deck-assignment logic**.
> It only translates the generic adapter contract into wire/device calls, and
> translates device presses back into `DeckButtonEvent`s.

Concretely, an adapter must **not**:

- know anything about Discord, voice, users, mute/deaf semantics;
- decide *which* user/page goes in *which* slot (that is `deck-core`/`SlotManager`);
- interpret what a button press *means* (that is `DeckordService.handleButton`,
  which reads `slot.kind` and calls `slots.nextPage()` / `slots.toggleSelected()`).

An adapter's entire world is: `RenderedDeckSlot` in via `setSlot`,
`DeckButtonEvent` out via the handlers. `deck-core` must never depend on a
concrete adapter, and an adapter must never reach back into Discord or slot
assignment. If you find yourself importing anything from the voice or deck-core
layers, you are doing it wrong.

---

## 7. Implementing a new adapter — the recipe

1. Create a class in `packages/deck-adapter/src/` implementing `IDeckAdapter`.
2. Set `id` (stable) and `name` (human). Stamp `deckId: this.id` on every event.
3. In `start()`, acquire the device/SDK and register its native press/release
   callbacks; in `stop()`, release everything.
4. Implement `getLayoutSpec()` from the real hardware (`rows`, `columns`,
   `slotCount`, `iconSize`, `hasKnobs`).
5. Implement `setSlot`: prefer `slot.imageDataUrl` (upload PNG) when present;
   otherwise fall back to `slot.title`/`slot.image` if the device supports text.
6. Implement `clearSlot`/`clearAll` to blank keys.
7. Maintain `downHandlers` / `upHandlers` arrays; call all of them on each event.
8. Export it from `packages/deck-adapter/src/index.ts`.
9. Wire it in `DeckordService` (section 8) — the single wiring point.

Below are device-specific notes. These describe the intended mapping; the SDK
calls named are the shape to aim for.

### 7a. OpenDeck

OpenDeck exposes an Elgato-plugin-style event model. Map its lifecycle events to
this contract:

- `willAppear` (a key becomes visible for your action/coordinates) → record the
  key's coordinates and map them to a Deckord `slotIndex`. Keep a
  `coordinates ↔ slotIndex` table; you'll need it both directions.
- `willDisappear` → drop that mapping so you stop painting a key that's no longer
  shown (e.g. the user navigated away).
- On `setSlot(slotIndex, slot)`, look up the key for that `slotIndex` and:
  - `setImage(context, imageDataUrl)` — use the rendered PNG once available;
    until then you can render `title`/`badges` yourself or show a placeholder.
  - `setTitle(context, slot.title)` if you also want native text.
- `keyDown` / `keyUp` events → translate the key's coordinates back to
  `slotIndex`, build a `DeckButtonEvent`, and dispatch to the handler lists.
- `getLayoutSpec()` from the connected device's grid and icon size.

### 7b. StreamDock / AJAZZ AKP05 PRO (10 LCD keys)

A fixed-grid LCD deck (the AKP05 PRO has 10 LCD keys):

- `getLayoutSpec()` returns the fixed grid and `slotCount: 10` with the device's
  key resolution as `iconSize`. Map `slotIndex 0..9` to physical keys once, in
  reading order.
- `setSlot`: these keys are pure LCD, so they need pixels — upload
  `slot.imageDataUrl` (the future server-rendered PNG). Do not rely on
  `slot.image` URLs; the device can't fetch them.
- `clearSlot`/`clearAll`: push a blank/black image to the key(s).
- Register the SDK's key-press callbacks, translate the device key number to
  `slotIndex`, and emit `DeckButtonEvent`s.

### 7c. Elgato (Stream Deck)

Via the Elgato SDK (or `@elgato-stream-deck/node`-style library):

- `getLayoutSpec()` from the connected model (e.g. 3×5 = 15 keys, or Mini/XL),
  including the model's `iconSize`.
- `setSlot`: `fillKeyBuffer` / `fillImage` with the PNG from `slot.imageDataUrl`.
  Elgato keys are image-only; use `title` only if you're compositing text into
  the image yourself.
- `clearSlot` → `clearKey(index)`; `clearAll` → `clearPanel()`.
- Subscribe to `down` / `up` key events, map key index → `slotIndex`, and emit
  `DeckButtonEvent`s stamped with `deckId`/`timestamp`.

For all three, remember the host already diffs — you receive `setSlot` only for
changed slots, so you don't need your own change detection.

---

## 8. The single wiring point: `DeckordService`

Choosing the adapter is a change **here and nowhere else**
(`apps/deckord-service/src/DeckordService.ts`, constructor):

```ts
const spec: DeckLayoutSpec = {
  rows: DEFAULT_SLOT_CONFIG.rows,
  columns: DEFAULT_SLOT_CONFIG.columns,
  slotCount: DEFAULT_SLOT_CONFIG.rows * DEFAULT_SLOT_CONFIG.columns,
};
const adapter = new DebugBrowserDeckAdapter(this.ws, spec);
this.host = new DeckAdapterHost(adapter, toRenderedSlot);
```

To swap in your adapter, construct it here instead of `DebugBrowserDeckAdapter`
and pass it to `DeckAdapterHost` with the same `toRenderedSlot` mapper. For a
physical deck the `spec` should come from the device (`adapter.getLayoutSpec()`)
rather than from `DEFAULT_SLOT_CONFIG`, and you would not pass `this.ws` (the
debug `DeckWire`) — a physical adapter takes its device handle instead.

Everything downstream is already generic and needs no changes:

- `DeckordService.start()` calls `this.host.start()`, registers
  `this.host.onButtonDown((event) => this.handleButton(event))`, and starts the
  voice pipeline.
- `refreshDeck` → `pushLayout` → `renderLayout(...)` → `this.host.apply(rendered)`
  feeds every layout update through the diffing host into your `setSlot`.
- `handleButton` interprets presses (`nextPage`, `toggleSelected`) — that logic
  stays in the service, never in your adapter.
- `DeckordService.stop()` calls `this.host.stop()` → your `stop()`.

That is the whole integration surface: implement `IDeckAdapter`, export it, and
construct it in the `DeckordService` constructor.
