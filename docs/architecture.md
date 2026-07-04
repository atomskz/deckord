# Deckord Architecture

Deckord shows the participants of a Discord voice channel on a macro deck — a
virtual "debug deck" in the browser today, and physical LCD-button decks (OpenDeck,
StreamDock/AJAZZ, Elgato) in later phases. This document describes the actual code
as it stands: the package layering, the bidirectional data flow, the type model and
its deliberate reconciliation, the WebSocket protocol, provider selection with
graceful fallback, the adapter diffing, and error handling.

The system is a pnpm monorepo (`pnpm-workspace.yaml` globs `apps/*` and
`packages/*`). Everything is ESM TypeScript. The service is `deckord-service`
(Node, run with `tsx`); the UI is `deckord-debug-deck` (React + Vite).

## The pipeline in one line

The orchestrator (`DeckordService`) owns this pipeline and is the only place that
knows all the parts exist:

```
VoiceService → SlotManager (deck-core) → renderer → DeckAdapterHost → WsServer → browser
```

Swapping the debug adapter for a physical one is a change in `DeckordService` and
nowhere else.

## Package layering

Layers are listed top (application) to bottom (foundation). Dependency direction is
strictly downward: a package may only depend on packages below it. `@deckord/shared`
depends on nothing. Nothing depends on the concrete adapter or on Discord except the
service.

| Package / app | Layer | Responsibility | Depends on |
| --- | --- | --- | --- |
| `deckord-service` (`apps/deckord-service`) | Application (Node) | The orchestrator. Wires VoiceService → SlotManager → renderer → DeckAdapterHost → WsServer, handles debug button presses and mock commands, loads config, configures logging. | `deck-adapter`, `deck-core`, `discord-rpc`, `ipc-contract`, `renderer`, `shared`, `ws` |
| `deckord-debug-deck` (`apps/deckord-debug-deck`) | Application (browser) | React UI that renders the deck grid, voice panel, mock controls, status bar, and event log. Talks to the service over WebSocket. | `ipc-contract`, `react`, `react-dom` |
| `@deckord/deck-adapter` | Adapter | The replaceable bottom layer of the device pipeline. `IDeckAdapter` contract, `DeckAdapterHost` (diffing driver), `DebugBrowserDeckAdapter` (WebSocket-backed), `DeckWire` transport seam. Contains zero Discord and zero deck-assignment logic. | `ipc-contract`, `shared` |
| `@deckord/discord-rpc` | Provider (source) | Real Discord IPC transport (`discord-ipc-0..9` named pipe / unix socket), RPC handshake + request/response correlation + event dispatch, voice-state normalization, OAuth token store. AUTHORIZE flow is a skeleton. | `shared` |
| `@deckord/renderer` | Enrichment | Turns a logical `DeckLayout` into a presentational one: titles, subtitle, avatar image, badges, accessibility labels. Themes and `toRenderedSlot` adapter mapping. Pure. | `shared` |
| `@deckord/deck-core` | Domain (logic) | Pure logical layout: stable slot assignment (`AssignmentPolicy`/`StableOrderPolicy`), pagination (`PageManager`), and `SlotManager` which turns a `VoiceChannelState` into a logical `DeckLayout`. No I/O, no timers, no Discord, no adapters. | `shared` |
| `@deckord/ipc-contract` | Contract (wire) | The WebSocket trust boundary. Zod schemas for every wire message, `encode` / `decodeClientMessage` / `decodeServiceMessage`, protocol version + defaults, and compile-time drift guards that assert the schemas stay in sync with `@deckord/shared`. | `shared`, `zod` |
| `@deckord/shared` | Foundation | Provider-agnostic domain types (`VoiceUser`, `VoiceChannelState`, `DeckSlot`, `DeckLayout`, `RenderedDeckSlot`, …), the `DeckordErrorCode` surface + `DeckordError`, the `Result` type, and the structured `Logger`. Browser-safe (no direct `process` access). | — |

Key seams that keep the layers decoupled:

- `IVoiceProvider` (in the service's `voice/types.ts`) — the mock and Discord
  providers both implement it, so nothing downstream knows the source of the data.
  This is the seam that makes graceful fallback to mock possible.
- `IDeckAdapter` (`deck-adapter`) — the debug adapter and future physical adapters
  both implement it, so the orchestrator is device-agnostic.
- `DeckWire` (`deck-adapter`) — the narrow transport (broadcast + button events)
  the debug adapter needs. `WsServer` implements it, keeping `deck-adapter` free of
  any concrete transport dependency (`ws`, USB, …).

## Data flow

There are two directions. Both cross the WebSocket boundary defined by
`@deckord/ipc-contract`.

### Downstream: voice → deck render → browser

1. A provider (`MockVoiceProvider` or `DiscordVoiceProvider`) produces a normalized
   `VoiceChannelState` and emits it via its `onUpdate` handler.
   - The mock provider emits on a timer (`speakingIntervalMs`, default 1600 ms) and
     on every command.
   - The Discord provider maintains a `Map<userId, VoiceUser>`, applies
     `VOICE_STATE_CREATE/UPDATE/DELETE` and merges separate `SPEAKING_START/STOP`
     events onto it, then emits a fresh snapshot.
2. `VoiceService.use()` subscribes to the active provider's `onUpdate`, stores the
   latest state, and re-emits to its own `onUpdate` handlers.
3. `DeckordService.refreshDeck(state)` runs the pipeline:
   - `SlotManager.computeLayout(state)` → a **logical** `DeckLayout` (deck-core).
   - `renderLayout(logical, renderContext)` → a **rendered** `DeckLayout` (renderer),
     stored as `this.renderedLayout`.
   - `DeckAdapterHost.apply(rendered)` → diffs against the last pushed layout and, for
     each changed slot, calls `adapter.setSlot(slotIndex, RenderedDeckSlot)`.
   - Separately, `refreshDeck` also broadcasts the raw `voice_update` to all clients.
4. `DebugBrowserDeckAdapter.setSlot` converts the `RenderedDeckSlot` back to a wire
   `DeckSlot` and calls `wire.broadcast({ type: 'slot_update', … })`.
5. `WsServer.broadcast` `encode`s the message and sends it to every open client.
6. In the browser, `DeckSocket.onmessage` validates the frame with
   `decodeServiceMessage`, `useDeckConnection` applies `slot_update` by replacing the
   one slot in its `deck` state, and `DeckGrid` / `DeckButton` re-render.

On a fresh client connection the service instead sends one `snapshot` (full `voice`
+ full rendered `deck`) via `sendSnapshot`, triggered by the client's `hello`.

### Upstream: button / mock command → service

1. In the browser, `DeckButton` fires `onPointerDown` / `onPointerUp`; `App` sends
   `button_down` / `button_up`, and `MockControls` sends `mock_command`. `DeckSocket.send`
   `encode`s them.
2. `WsServer.handleMessage` runs `decodeClientMessage` (rejecting invalid frames with a
   warning), then `route` dispatches by `type`:
   - `hello` → build a `WsClient` and call the connect handlers (→ `sendSnapshot`).
   - `button_down` / `button_up` → call the `DeckWire` button handlers with
     `{ kind, slotIndex }`.
   - `mock_command` → call the mock-command handlers with `(command, userId?)`.
3. For a button, `DebugBrowserDeckAdapter`'s `wire.onButton` handler wraps it into a
   `DeckButtonEvent` (`kind`, `slotIndex`, `deckId`, `timestamp`) and fans out to the
   registered `onButtonDown` / `onButtonUp` handlers. Only **down** is handled by the
   service.
4. `DeckordService.handleButton(event)` looks up the slot in `this.renderedLayout`:
   - `page` or `status` slot → `SlotManager.nextPage()`, push the new layout, emit an
     info status.
   - `user` slot with a `userId` → `SlotManager.toggleSelected(userId)`, push, emit an
     info status naming the user.
   These recompute the layout from the last voice state and flow back downstream via
   `pushLayout` (render + diff + broadcast). No Discord writes ever happen in the MVP.
5. For a mock command, `DeckordService.handleMockCommand` calls
   `VoiceService.command(command, userId)` → `provider.command(...)`. The mock provider
   mutates its user set / speaking loop and `emit()`s a new state, which re-enters the
   downstream flow. The Discord provider logs and ignores the command.

## Type model and the deliberate reconciliation

There are four related slot/layout representations. The split is intentional: pure
logic, presentational enrichment, an adapter-facing superset, and a validated wire
shape. All canonical shapes live in `@deckord/shared` (`domain/deck.ts`,
`domain/voice.ts`).

### Voice domain (source of truth for participants)

- `VoiceUser` — provider-agnostic participant: `userId`, `username`, `displayName`,
  optional avatar (`avatarHash` / `avatarUrl` / `avatarLocalPath`), `isSpeaking`, and
  the mute/deaf/suppress booleans (`selfMute`, `serverMute`, `selfDeaf`, `serverDeaf`,
  `suppress`), optional `volume`.
- `VoiceChannelState` — `provider` (`'discord-rpc' | 'mock'`), `connected`, channel /
  guild identifiers and names, `users: VoiceUser[]`, `updatedAt`.
- Helpers `isUserMuted` / `isUserDeafened` collapse self/server flags. Both the mock
  and Discord providers emit exactly these shapes (via `normalizeVoiceState` in
  `discord-rpc`), so nothing downstream knows where the data came from.

### The four deck representations

1. **Logical `DeckSlot` / `DeckLayout` — emitted by deck-core.**
   `SlotManager.computeLayout` produces a `DeckLayout` (`rows`, `columns`, `slotCount`,
   `page`, `pageCount`, `slots`). Each `DeckSlot` carries only logical fields:
   `slotIndex`, `kind` (`'user' | 'empty' | 'status' | 'page'`), optional `userId`, and
   `visualState` (`speaking`, `muted`, `deafened`, `disconnected`, `selected`). The
   presentational fields (`title`, `subtitle`, `image`, `badges`, `accessibilityLabel`)
   are deliberately left empty here — deck-core is pure and does no presentation.

2. **Enriched `DeckSlot` — filled by the renderer.**
   `renderLayout` returns a **new** layout (inputs are not mutated) whose slots have the
   presentational fields populated per `kind`:
   - `user`: `title = displayName`, `subtitle = @username` (only if it differs),
     `image` from the avatar resolver, `badges` from `badgesForUser`,
     `accessibilityLabel` from `accessibilityLabelForUser`. If the user is no longer
     present the slot degrades to `kind: 'empty'`.
   - `page`: title `"Page"`, subtitle `"<n>/<count>"`, a single `page` badge.
   - `status`: title = channel name (or app name), subtitle `"<n> in voice"`.
   - `empty`: presentational fields cleared, `badges: []`.
   The type is still `DeckSlot` — enrichment happens **in place** in the type sense
   (same shape, more fields set). Speaking is intentionally not a badge; it is carried
   by `visualState.speaking` and rendered as a glow.

3. **`RenderedDeckSlot` — the adapter-facing superset.**
   `toRenderedSlot` maps an enriched `DeckSlot` to `RenderedDeckSlot`, the shape
   `IDeckAdapter.setSlot` consumes. It is a superset so one adapter contract serves both
   CSS decks (use `image`) and physical decks (Phase 7+, use `imageDataUrl`). It makes
   `badges` non-optional (`badges: []` default) and adds `imageDataUrl`, currently left
   `undefined` (Phase 5 will add server-side PNG generation). It drops `userId` — the
   adapter does not need identity, only what to paint.

4. **Wire `DeckSlot` / `DeckLayout` — carried by ipc-contract.**
   The WebSocket messages carry the plain `DeckSlot` / `DeckLayout` shapes (not
   `RenderedDeckSlot`). `DebugBrowserDeckAdapter.setSlot` therefore converts the
   `RenderedDeckSlot` it is handed **back** to a `DeckSlot` (`renderedToDeckSlot`) before
   broadcasting, and its `clearSlot` emits an `emptyDeckSlot`. The browser consumes
   `DeckSlot` / `DeckLayout` directly.

### The drift guard

`ipc-contract/schemas.ts` defines Zod schemas that mirror the hand-written
`@deckord/shared` types, and ends with compile-time asserts
(`_CheckVoiceUser`, `_CheckVoiceState`, `_CheckDeckSlot`, `_CheckDeckLayout`) using a
bidirectional-`extends` type. If someone edits a shared type or a schema but not the
other, `tsc` fails. The schemas are the runtime trust boundary; these guards are the
compile-time one.

## WebSocket message protocol

Defined in `@deckord/ipc-contract`. Both directions are `discriminatedUnion('type', …)`
Zod schemas; every inbound frame is validated (`decodeClientMessage` on the service,
`decodeServiceMessage` in the browser), and a JSON/validation failure yields a
`DeckordError('IPC_MESSAGE_INVALID', …)` instead of a throw. Constants:
`IPC_PROTOCOL_VERSION = 1`, `DEFAULT_WS_HOST = '127.0.0.1'`, `DEFAULT_WS_PORT = 8787`,
`DEFAULT_WS_PATH = '/deck'`.

### ServiceToClientMessage (service → debug UI)

| `type` | `payload` | When |
| --- | --- | --- |
| `snapshot` | `{ voice: VoiceChannelState, deck: DeckLayout }` | Sent once to a client after its `hello`; full initial state. |
| `slot_update` | `{ slotIndex: number, slot: DeckSlot }` | One slot changed (the normal downstream path via the adapter host diff). |
| `voice_update` | `VoiceChannelState` | Full voice state pushed alongside each `refreshDeck`. |
| `deck_update` | `DeckLayout` | Full deck layout (schema exists and the UI handles it; the current service pushes per-slot `slot_update`s instead). |
| `status` | `{ level: 'info' \| 'warning' \| 'error', message: string, code?: string }` | Provider status and debug-action feedback. Rendered in the event log. |

### ClientToServiceMessage (debug UI → service)

| `type` | `payload` | Effect |
| --- | --- | --- |
| `hello` | `{ client: 'debug-deck', version: string }` | Handshake; triggers `sendSnapshot`. `version` is `"0.1.0/<IPC_PROTOCOL_VERSION>"`. |
| `button_down` | `{ slotIndex: number }` | Handled: page slot → next page; user slot → toggle selection. |
| `button_up` | `{ slotIndex: number }` | Routed to `onButtonUp` handlers; the MVP service does not act on it. |
| `mock_command` | `{ command: MockCommand, userId?: string }` | Forwarded to the active provider (mock acts, Discord ignores). |

`MockCommand` is the enum
`start | stop | random_speaking | toggle_mute | toggle_deafen | add_user | remove_user | reset`.

### Transport details

`WsServer` binds to loopback (`host`/`port`/`path` from config) and implements
`DeckWire`. If a `token` is configured, connections must supply `?token=<token>` in the
URL (`authorize`), otherwise they are closed with code `1008`; with no token it logs a
loud debug-only warning. The browser `DeckSocket` auto-reconnects every 1500 ms (the
service may not be up when the page loads), sends `hello` on open, and drops any frame
that fails schema validation. `resolveWsUrl` builds the URL from `VITE_WS_URL` /
`VITE_WS_TOKEN` with a loopback default.

## Provider selection and graceful fallback to mock

Two functions in `config/index.ts` plus `VoiceService.start()` implement this.

**Preference** comes from `DECKORD_PROVIDER` and is one of `auto` (default) | `mock` |
`discord-rpc`.

**`resolveInitialProvider(config)`** decides what to try first:
- `mock` → `mock`.
- `discord-rpc` → `discord-rpc`.
- `auto` → `discord-rpc` only if **both** `discord.clientId` and
  `discord.accessToken` are present; otherwise `mock`. (The MVP has no interactive
  AUTHORIZE flow, so `auto` will not attempt Discord without a pre-obtained token.)

**`VoiceService.start()`**:
1. If the resolved provider is `discord-rpc`, call `tryStartDiscord()`.
2. `tryStartDiscord()` constructs a `DiscordVoiceProvider` and `await use(provider)`.
   `use` wires the provider's `onUpdate` / `onStatus`, calls `provider.start()`, and
   caches the initial state.
3. If `provider.start()` throws (Discord not running, IPC pipe missing, no access
   token, auth failure — all typed `DeckordError`s), the error is normalized with
   `toDeckordError`, the failed provider is stopped, and a **`warning`** status is
   emitted with `code: 'PROVIDER_SWITCHED_TO_MOCK'` and the message
   `"Discord RPC unavailable (<code>). Falling back to mock provider."`. It returns
   `false`.
4. On `false` (or when `mock` was resolved from the start), `VoiceService` starts a
   `MockVoiceProvider`. The rest of the system runs unchanged because both providers
   emit the same `VoiceChannelState`.

`DiscordVoiceProvider.start()` calls `client.connect()`, which walks `discord-ipc-0..9`
(throwing `DISCORD_IPC_NOT_FOUND` if none accept), does the handshake, and — because no
AUTHORIZE flow exists — throws `DISCORD_AUTH_REQUIRED` unless an `accessToken` was
supplied. Any of these failures is what routes the service into the mock fallback.

## DeckAdapterHost diffing

`DeckAdapterHost` drives an `IDeckAdapter` from full `DeckLayout`s while pushing only
the slots that actually changed — important for slow physical decks, harmless for the
debug deck.

- It holds `previous: Map<slotIndex, string>` of the last pushed rendered slot per
  index.
- `apply(layout)`: for each slot, `toRendered(slot)` (the service passes
  `toRenderedSlot`), then `key = JSON.stringify(rendered)`. If the stored key differs
  (or is absent), it awaits `adapter.setSlot(slotIndex, rendered)`, updates the map, and
  records the index. It returns the list of changed indices.
- `reset()` clears the map and calls `adapter.clearAll()`; `start` / `stop` /
  `onButtonDown` / `onButtonUp` delegate to the adapter.

Because the key is the serialized `RenderedDeckSlot`, any change to title, subtitle,
image, badges, or visual state re-pushes exactly that one slot; unchanged slots are
skipped. `DebugBrowserDeckAdapter.setSlot` turns each pushed slot into a `slot_update`
broadcast, so the browser receives one message per genuinely changed button.

## Error handling

Every recoverable condition maps to a stable `DeckordErrorCode` (in
`@deckord/shared/errors.ts`) so logs and the debug UI can react without string-matching.
`DeckordError` carries the `code`; `toDeckordError` normalizes any thrown value;
`toPayload()` yields `{ code, message }`. Note that provider **status** messages
(`ProviderStatus.code`) reuse some of these codes as free-form strings on the wire even
though status is not itself a `DeckordError`.

| Code | Meaning | Where it surfaces |
| --- | --- | --- |
| `DISCORD_NOT_RUNNING` | IPC transport asked to send while not connected. | `DiscordIpcTransport.send` throws it. Caught by `VoiceService.tryStartDiscord` → mock fallback. |
| `DISCORD_IPC_NOT_FOUND` | No `discord-ipc-0..9` pipe accepted the connection (Discord desktop not running). | `DiscordIpcTransport.connect` throws it; propagates through `DiscordRpcClient.connect` / provider `start()` → mock fallback. |
| `DISCORD_AUTH_REQUIRED` | Handshake succeeded but no access token (no AUTHORIZE flow in the MVP). | `DiscordRpcClient.connect` throws it after handshake → mock fallback. |
| `DISCORD_AUTH_FAILED` | RPC `ERROR` frame on a correlated request, or the unimplemented OAuth token exchange. | `DiscordRpcClient.handleFrame` rejects the pending request with it; `exchangeCodeForToken` throws it. |
| `DISCORD_SCOPES_UNAVAILABLE` | Reserved for missing/insufficient RPC scopes. | Declared in the error surface; not yet thrown in the MVP. |
| `NO_SELECTED_VOICE_CHANNEL` | Connected to Discord but no voice channel is selected, or the user left. | `DiscordVoiceProvider.loadSelectedChannel` / `onChannelSelect` emit it as a `warning` / `info` **status** (`code`), broadcast as a `status` message. |
| `AVATAR_DOWNLOAD_FAILED` | Avatar fetch/cache failure (Phase 5). | Declared; the MVP `AvatarCache` only returns existing URLs and does not throw it yet. |
| `WEBSOCKET_DISCONNECTED` | Discord RPC socket closed / pending RPC requests aborted on close. | `DiscordVoiceProvider` emits it as a `warning` status on `client.onClose`; `DiscordRpcClient.close` rejects in-flight requests with it. |
| `DEBUG_UI_DISCONNECTED` | A debug deck client dropped. | Declared in the error surface; client disconnects are currently just logged by `WsServer` (`ws.on('close')`). |
| `PROVIDER_SWITCHED_TO_MOCK` | Preferred provider failed to start; system fell back to mock. | `VoiceService.tryStartDiscord` emits it as a `warning` status `code`; the browser logs it in the event log. |
| `IPC_MESSAGE_INVALID` | Inbound wire frame is not valid JSON or fails Zod validation. | `ipc-contract` `parseJson` / `decodeClientMessage` / `decodeServiceMessage` return it in an `Err`. `WsServer.handleMessage` logs and drops the frame; `DeckSocket.onmessage` silently ignores invalid frames. |
| `CONFIG_INVALID` | Invalid configuration. | Declared; `loadConfig` currently coerces/falls back to defaults rather than throwing. |
| `UNKNOWN` | Fallback for unclassified failures. | Default of `toDeckordError`; used for RPC request timeouts in `DiscordRpcClient.request`. |

Non-`DeckordError` failure handling worth noting: `WsServer` logs (does not crash on)
per-client socket errors; `DeckSocket` auto-reconnects on close; and `main.ts` wraps
startup so any fatal error logs `[FATAL]` and exits with code 1, while `SIGINT`/`SIGTERM`
trigger a graceful `service.stop()`.
