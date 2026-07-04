# OpenDeck adapter — design decision

Status: **decided (architecture), not yet implemented.** This is the design record
for the OpenDeck / Elgato Stream Deck integration (roadmap Phase 7). Nothing here is
built yet; it captures the decisions so they are not lost.

## Decision: Variant B — two processes

Deckord stays a **standalone long-running service (daemon / future tray app)** that
owns the Discord connection and the whole pipeline. The OpenDeck integration is a
**thin, host-launched relay plugin**; all adapter logic lives in
`@deckord/adapter-opendeck` inside the service.

### Why B (and not "Deckord runs as the plugin", Variant A)

The Discord RPC connection is stateful and long-lived (auth once, hold the IPC pipe,
token, subscriptions, reconnect). It must not be owned by OpenDeck's lifecycle.

- **A** (OpenDeck launches the whole Deckord service as the plugin): closing OpenDeck
  kills Discord + token session + the browser deck; a plugin restart re-auths Discord;
  multiple hosts would each spawn a competing Deckord/Discord connection; incompatible
  with a standalone tray app (Phase 9).
- **B**: one Deckord daemon owns Discord **persistently** and drives **all outputs at
  once** (browser debug deck + OpenDeck + a future direct-HID AKP05). The plugin is a
  dumb relay whose crash/restart never touches the Discord session.

A is only useful as a throwaway "does it light up on hardware" test. B is the product.

## Topology

```
Discord client ─IPC─▶ ┌──────── deckord-service (daemon / tray) ────────┐
                      │ discord-rpc → VoiceService → deck-core →         │
                      │ renderer → DeckAdapterRegistry ─┬─ DebugBrowserAdapter ─WS─▶ browser
                      │                                 ├─ OpenDeckAdapter ─(Deckord WS)─▶ [bridge] ─Elgato WS─▶ OpenDeck host ─▶ hardware
                      │                                 └─ StreamDockAdapter ─USB HID─▶ AKP05 (direct, later)
                      └─────────────────────────────────────────────────┘
```

The **bridge** is the only host-launched piece. It holds two connections and pipes
between them; it contains no Deckord logic:

```
bridge (the .sdPlugin CodePath):   OpenDeck Elgato WS  ⟷  Deckord WS
```

`OpenDeckAdapter` speaks the Elgato protocol; the bridge relays raw Elgato frames, so
the bridge is a ~pure byte-pipe. The bridge connects to Deckord's WS as **just another
client**, exactly like the browser debug deck connects via `DeckWire` — browser and
OpenDeck are both "output clients" of the one service.

## What "the plugin" physically is

A folder installed into OpenDeck's plugins dir:

```
deckord.sdPlugin/
  manifest.json     # Name, UUID, CodePath (the bridge entry), Actions, icons
  <bridge entry>    # e.g. a Node script; the CodePath OpenDeck launches
  pi/…              # Property Inspector HTML
  icons/…
```

Lifecycle: OpenDeck reads the manifest, **spawns CodePath** as a child process with
`-port <hostWsPort> -pluginUUID <uuid> -registerEvent register -info <base64>`. The
process opens `ws://127.0.0.1:<port>` to OpenDeck, sends `{event:'register',uuid}`, then
relays. (Elgato requires the plugin to be host-launched + registered — you cannot
connect from outside unregistered, which is why the relay is unavoidable in B.)

The bridge does not have to be native — for Deckord it is a Node process.

## `@deckord/adapter-opendeck` (in the service)

```
packages/adapter-opendeck/
  src/
    OpenDeckAdapter.ts        # implements IDeckAdapter over the Elgato protocol
    OpenDeckPluginTransport.ts# Elgato-protocol codec over the (relayed) WS
    OpenDeckFactory.ts        # DeckAdapterFactory; isSupported() = bridge connected
    index.ts
```

- `setSlot(i, rendered)` → resolve the i-th assigned key's `context` → rasterize via
  `@deckord/image-renderer` `SlotImageRenderer.renderToDataUrl` at `iconSize`
  (avatar bytes from `AvatarCache.localPath`) → `setImage(context, pngDataUrl)`.
- `keyDown/keyUp` (by `context`) → `onButtonDown/Up(DeckButtonEvent)`.
- `DeckAdapterHost` diffing already ensures only changed keys are re-sent.
- Deps: `@deckord/deck-adapter`, `@deckord/shared`, `@deckord/image-renderer`, `ws`.

## How device layout / capabilities reach Deckord (dynamic)

The connected device is whatever OpenDeck supports (varying key counts, encoders,
touchscreen). Info arrives as a **stream of Elgato events**, relayed to
`OpenDeckAdapter`:

- **`-info.devices`** at launch — initial device list.
- **`deviceDidConnect` / `deviceDidDisconnect`** — `deviceInfo.size {columns, rows}` +
  numeric `type` (model → icon size, whether it has encoders). `size` is the **keypad**
  grid only; encoders are separate.
- **`willAppear` / `willDisappear`** — which keys/encoders the user assigned the
  Deckord action to: `context`, `coordinates {column,row}`, `controller` =
  `"Keypad"` | `"Encoder"`.

The adapter aggregates these into two live maps and computes `DeckCapabilities`
(Phase 6a):

```
devices:  Map<deviceId, { size, type }>
contexts: Map<context,  { device, coords, controller }>

getCapabilities() → DeckCapabilities {
  rows, columns,                      // from the target device's size
  slotCount:  <# assigned Keypad contexts>,   // Elgato: you own only placed keys
  knobCount:  <# assigned Encoder contexts>,
  iconSize,                           // from device type
  imageFormats: ['png'],  hasTextApi: true,
}
```

Slot order = assigned contexts sorted by `(row, column)`. `slotCount` is the number of
keys the user placed the action on, **not** the whole device.

### Two required wiring additions (Phase 7)

1. **Configure `SlotManager` from capabilities**, not the hardcoded `DEFAULT_SLOT_CONFIG`
   (2×5). After selecting the adapter:
   `new SlotManager({ rows: caps.rows, columns: caps.columns, statusSlotIndex: caps.slotCount - 1 })`.
2. **`IDeckAdapter.onCapabilitiesChanged(cb)`** — because hot-plug and key
   re-assignment change capabilities at runtime, the adapter must signal changes, and
   `DeckordService` rebuilds the `SlotManager` + re-renders. This is exactly the
   **hot-plug seam** deferred in Phase 6.

## GUI model (what the user sees in OpenDeck)

- **Actions sidebar**: a **"Deckord"** category with actions — `Voice Slot` (a
  participant slot) and `Status / Page`.
- The user **drags actions onto keys** → each fires `willAppear`. The Deckord layout is
  wherever the user placed them; unplaced keys are free for other plugins.
- **Keys** show the live rasterized PNG (avatar/identicon + name + speaking glow +
  mute/deafen badges); the status key shows channel name / `Page 1/2`. The host mirrors
  these images in the on-screen device grid too.
- **Property Inspector** (HTML we ship): Deckord service connection status + optional
  role dropdown (`Participant` / `Status-Page`). **No Discord config here** — that lives
  in the service / tray (Phase 9).
- **Encoders / touchscreen** (Stream Deck +): reported via `knobCount`, currently
  **unused** (Deckord is keys-only); `dialRotate/dialPress/touchTap` are future.
- **Onboarding**: dragging onto N keys is tedious → optionally ship a **preset profile**
  the user imports to pre-place the actions.

## Open items to settle when implementing (Phase 7)

- Deckord-side transport for the relay: does the bridge connect to the existing
  `WsServer` (port 8787) with a client-type discriminator, or a dedicated port? Decide
  the envelope (raw Elgato frames vs a small wrapper).
- Add `onCapabilitiesChanged` to `IDeckAdapter` + wire `SlotManager` rebuild.
- `manifest.json` action definitions + Property Inspector HTML + icons.
- Elgato device `type` → `iconSize` / encoder-count table.
- Preset profile for onboarding.
- Bridge reconnect behavior when the Deckord service is not yet running.

## Relationship to the AJAZZ AKP05 PRO adapter

`@deckord/adapter-streamdock` (AKP05 direct) is a **different transport** (USB HID, no
host, no contexts): fixed capabilities (10 keys), address keys by index, upload image
bytes over HID. Both implement the same `IDeckAdapter`; everything above `setSlot`
(Discord → deck-core → renderer → diff → PNG) is identical. The same physical AKP05
could be driven either through OpenDeck (this adapter) or directly (that adapter); the
registry picks via `isSupported()` + `DECKORD_DECK_ADAPTER`.
