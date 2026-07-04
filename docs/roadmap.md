# Deckord Roadmap

This roadmap tracks Deckord from initial scaffolding to a productized, Discord-approved
app. It is phase-oriented; each phase lists concrete deliverables and marks what is
**DONE** vs **TODO** against the current codebase.

For product context and how the pieces fit together, see the
[README](../README.md) and [architecture.md](./architecture.md). The Discord RPC
model is detailed in [discord-rpc.md](./discord-rpc.md); the device contract in
[adapter-api.md](./adapter-api.md).

---

## Current status

**Phase: MVP.** The pipeline runs **end-to-end today** against a built-in **mock**
voice channel, rendered on the **browser debug deck** over a loopback WebSocket:

```
Discord/mock → VoiceService → deck-core → renderer → deck-adapter → debug browser deck
```

- **Phases 0–3 are largely DONE.** Project setup, the provider-agnostic domain
  model and IPC wire contract, the mock voice provider, and the browser Debug Deck
  MVP all exist and are wired together in
  [`DeckordService`](../apps/deckord-service/src/DeckordService.ts).
- **Phase 4 (Discord RPC) — DONE, verified against a live client.** The IPC
  transport, RPC handshake/request/dispatch, voice-state normalization, the full
  interactive `AUTHORIZE` → token-exchange → refresh → `FileTokenStore` auth flow, the
  global `VOICE_CHANNEL_SELECT` + per-channel subscriptions, unsubscribe-on-switch,
  reconnect/backoff, and graceful fallback to mock all work against a real Discord
  desktop client — participants, speaking highlight, mute/deafen badges, and channel
  switching confirmed. Live verification (4.8) fixed one protocol detail: the mute/deaf
  flags are nested under `voice_state` (not top-level). Only optional **4.9**
  (speaking-event throttle) remains. A pre-obtained `DISCORD_ACCESS_TOKEN` fast path is
  kept for testing without the OAuth round-trip.
- **Phase 5 (renderer abstraction) — DONE.** Presentational enrichment (titles,
  subtitles, badges, accessibility labels), a deterministic identicon, real avatar
  download + on-disk caching (`AvatarCache`), and server-side PNG rasterization (the
  new `@deckord/image-renderer` package via `@napi-rs/canvas`) all exist. The browser
  deck still renders via CSS; the PNG path is for physical decks (Phase 7+).
- **Phase 6 (adapter system) — DONE.** The `IDeckAdapter` contract with capability
  negotiation (`DeckCapabilities` / `getCapabilities`), the change-diffing
  `DeckAdapterHost`, a `DeckAdapterRegistry` that selects an adapter at runtime, and
  the `DebugBrowserDeckAdapter`/`Factory` all exist. Runtime hot-plug monitoring is
  deferred to the physical adapters that need it.
- **Phase 7 (OpenDeck adapter) — code complete, pending live verification.** The
  `@deckord/adapter-opendeck` package, the Variant-B relay endpoint + plugin, and
  dynamic capability-driven layout all work against a simulated relay; verifying on a
  real OpenDeck host + device is what remains.
- **Phases 8–9 are future work** — the StreamDock / AJAZZ AKP05 PRO adapter and
  productization (installer, tray, auto-start, config UI, privacy policy, diagnostics,
  and Discord app approval).

### Near-term plan — finish Phases 4–5, then test on a real Discord client

We complete the remaining **Phase 4** and **Phase 5** items in order (checklists
below), then run the pipeline against a live Discord desktop client. Important scoping
note: the real-client test displays on the **browser debug deck**, so Phase 5's PNG
rasterization (which exists for *physical* decks, Phase 7+) is **not a blocker** for
that test. Strictly, only **Phase 4** is required for the real-client test; Phase 5
only improves on-screen rendering (real downloaded avatars). We still finish Phase 5
per plan.

Legend: **DONE** = implemented in the current codebase · **PARTIAL** = scaffolded but
incomplete · **TODO** = not started.

---

## Phase 0 — Project setup

**Goal:** a working monorepo with tooling, so every later phase has a place to live.

Deliverables:

- **DONE** — pnpm workspace monorepo (`pnpm-workspace.yaml`, root
  [`package.json`](../package.json) pinning `pnpm@10.13.1`, Node `>=20`).
- **DONE** — shared TypeScript config (`tsconfig.base.json` / `tsconfig.json`) and
  per-package `tsconfig.json` files.
- **DONE** — lint + format tooling: ESLint (`eslint.config.js`), Prettier
  (`.prettierrc.json`), and `lint` / `format` / `typecheck` scripts.
- **DONE** — test harness: Vitest (`vitest.config.ts`) with `test` / `test:watch`
  scripts.
- **DONE** — dev orchestration: `pnpm dev` runs the service and debug deck
  concurrently; `pnpm dev:service` / `pnpm dev:debug-deck` run them separately.
- **DONE** — `@deckord/shared` foundation: typed errors
  ([`errors.ts`](../packages/shared/src/errors.ts)), `Result`
  ([`result.ts`](../packages/shared/src/result.ts)), and a small logger
  ([`logger.ts`](../packages/shared/src/logger.ts)). No I/O.

---

## Phase 1 — Domain model & contracts

**Goal:** provider-agnostic domain types and a versioned wire protocol, so the
device and the voice source are the only replaceable parts.

Deliverables:

- **DONE** — voice domain types (`VoiceUser`, `VoiceChannelState`) in
  [`packages/shared/src/domain/voice.ts`](../packages/shared/src/domain/voice.ts).
- **DONE** — deck domain types (`DeckSlot`, `DeckLayout`, `DeckVisualState`,
  `DeckBadge`, `RenderedDeckSlot`, `DeckLayoutSpec`, `DeckButtonEvent`) in
  [`packages/shared/src/domain/deck.ts`](../packages/shared/src/domain/deck.ts).
- **DONE** — typed error codes (`DeckordErrorCode`) covering Discord, avatar,
  WebSocket, provider-fallback, and config conditions
  ([`errors.ts`](../packages/shared/src/errors.ts)).
- **DONE** — `@deckord/ipc-contract`: the local WebSocket wire protocol as Zod
  schemas plus `encode` / `decode*` codecs for every service ↔ UI message
  ([`schemas.ts`](../packages/ipc-contract/src/schemas.ts),
  [`codec` tested in `codec.test.ts`](../packages/ipc-contract/src/codec.test.ts)),
  a protocol version constant, and default host/port/path constants
  ([`messages.ts`](../packages/ipc-contract/src/messages.ts)).
- **DONE** — deck-core logic layer contracts: `SlotManagerConfig` /
  `DEFAULT_SLOT_CONFIG` (2×5 grid, status slot at index 9)
  ([`deck-core/src/types.ts`](../packages/deck-core/src/types.ts)).
- **DONE** — architecture docs: [architecture.md](./architecture.md),
  [discord-rpc.md](./discord-rpc.md), and [adapter-api.md](./adapter-api.md).

---

## Phase 2 — Mock voice provider

**Goal:** run the entire pipeline with no Discord client present, so all downstream
logic is developable and testable in CI.

Deliverables:

- **DONE** — `IVoiceProvider` interface and `ProviderStatus`
  ([`voice/types.ts`](../apps/deckord-service/src/voice/types.ts)).
- **DONE** — `MockVoiceProvider`
  ([`MockVoiceProvider.ts`](../apps/deckord-service/src/voice/MockVoiceProvider.ts)):
  seeds a fake "Mock Lounge" channel, drives speaking activity on a timer, and
  responds to debug commands (`start`/`stop`/`toggle_mute`/`toggle_deafen`/
  `add_user`/`remove_user`/`reset`, per
  [`MockCommandSchema`](../packages/ipc-contract/src/schemas.ts)).
- **DONE** — `VoiceService`
  ([`VoiceService.ts`](../apps/deckord-service/src/voice/VoiceService.ts)) owns the
  active provider and normalizes updates/status for the rest of the pipeline.
- **DONE** — provider selection: `DECKORD_PROVIDER` / `resolveInitialProvider`
  ([`config/index.ts`](../apps/deckord-service/src/config/index.ts)) defaults to
  mock unless a Discord client id + access token are present.
- **DONE** — mock configuration knobs: `DECKORD_MOCK_AUTOSTART`,
  `DECKORD_MOCK_USERS`, `DECKORD_MOCK_SPEAKING_MS`.

---

## Phase 3 — Debug Browser Deck MVP

**Goal:** paint the deck into a browser window over a loopback WebSocket and read
virtual button presses, so the full pipeline is visible and interactive.

Deliverables:

- **DONE** — `SlotManager` + `AssignmentPolicy` + `PageManager` in
  [`@deckord/deck-core`](../packages/deck-core): stable slot ordering, pagination,
  and a reserved status/page slot, all pure (no I/O, no timers). Unit-tested
  ([`SlotManager.test.ts`](../packages/deck-core/src/SlotManager.test.ts),
  [`AssignmentPolicy.test.ts`](../packages/deck-core/src/AssignmentPolicy.test.ts),
  [`PageManager.test.ts`](../packages/deck-core/src/PageManager.test.ts)).
- **DONE** — renderer enrichment
  ([`renderLayout` / `renderSlot`](../packages/renderer/src/renderSlot.ts),
  [`badges.ts`](../packages/renderer/src/badges.ts),
  [`themes.ts`](../packages/renderer/src/themes.ts)): titles, subtitles, badges,
  accessibility labels, avatar-source resolution. Unit-tested
  ([`renderSlot.test.ts`](../packages/renderer/src/renderSlot.test.ts)).
- **DONE** — `DeckAdapterHost`
  ([`DeckAdapterHost.ts`](../packages/deck-adapter/src/DeckAdapterHost.ts)): diffs
  layouts and pushes only changed slots to the adapter.
- **DONE** — `DebugBrowserDeckAdapter`
  ([`DebugBrowserDeckAdapter.ts`](../packages/deck-adapter/src/DebugBrowserDeckAdapter.ts)):
  a first-class `IDeckAdapter` that translates slot writes into wire messages and
  virtual presses back — zero Discord logic, zero assignment logic.
- **DONE** — service transport: `WsServer`
  ([`WsServer.ts`](../apps/deckord-service/src/server/WsServer.ts)) binds a loopback
  WebSocket (`ws://127.0.0.1:8787/deck` by default) with an optional shared-token
  (`DECKORD_WS_TOKEN`), sends a full snapshot on connect, then live updates.
- **DONE** — browser debug deck app
  ([`apps/deckord-debug-deck`](../apps/deckord-debug-deck), Vite + React):
  button grid ([`DeckGrid`](../apps/deckord-debug-deck/src/components/DeckGrid.tsx) /
  [`DeckButton`](../apps/deckord-debug-deck/src/components/DeckButton.tsx)), voice
  panel, mock controls, event log, status bar, and auto-reconnecting socket
  ([`DeckSocket.ts`](../apps/deckord-debug-deck/src/services/DeckSocket.ts)).
- **DONE** — end-to-end wiring + debug interactions in
  [`DeckordService`](../apps/deckord-service/src/DeckordService.ts): press a user
  slot to select/pin, press the status/page slot to change page (debug-only; no
  Discord writes).

---

## Phase 4 — Discord RPC prototype

**Goal:** consume real Discord voice presence over the local RPC IPC pipe, with a
graceful fallback to mock when Discord is unavailable.

Deliverables:

- **DONE** — Discord IPC transport
  ([`DiscordIpcTransport.ts`](../packages/discord-rpc/src/DiscordIpcTransport.ts)):
  connects to the local `discord-ipc-{0..9}` pipe/socket.
- **DONE** — RPC client
  ([`DiscordRpcClient.ts`](../packages/discord-rpc/src/DiscordRpcClient.ts)):
  handshake, request/response correlation (nonce + timeout), ping/pong, and
  subscription dispatch for `VOICE_STATE_*` and `SPEAKING_START/STOP`.
- **DONE** — voice-state normalization + avatar URL derivation
  (`normalizeVoiceState`, `discordAvatarUrl`) and the read-only `MVP_SCOPES`
  (`identify`, `rpc`, `rpc.voice.read`; never `rpc.voice.write`) in
  [`discord-rpc/src/types.ts`](../packages/discord-rpc/src/types.ts).
- **DONE** — `DiscordVoiceProvider`
  ([`DiscordVoiceProvider.ts`](../apps/deckord-service/src/voice/DiscordVoiceProvider.ts)):
  authenticates via `DiscordAuthenticator`, subscribes to the global channel-select
  plus per-channel voice/speaking events, tracks the user set, merges speaking events,
  and reconnects on drop.
- **DONE** — graceful fallback: if the Discord provider can't start (not running,
  no token, no selected channel, handshake failure), `VoiceService` logs a
  `PROVIDER_SWITCHED_TO_MOCK` status and continues on mock, unchanged upstream.
- **DONE** — token store interface + implementations (`TokenStore`,
  `FileTokenStore` (plaintext `0600` JSON — MVP), `MemoryTokenStore`) in
  [`DiscordAuth.ts`](../packages/discord-rpc/src/DiscordAuth.ts).

Auth + subscription work — **DONE and verified against a live Discord client**
(4.1–4.8 DONE; only optional 4.9 remains):

- **DONE (4.1)** — `authorize()` on `DiscordRpcClient`: sends `AUTHORIZE`
  (`{client_id, scopes, prompt}`) with a long timeout and returns the OAuth `code`
  directly over the RPC channel (no browser redirect listener).
- **DONE (4.2)** — real `exchangeCodeForToken` + `refreshAccessToken` + `isTokenValid`
  in [`DiscordAuth.ts`](../packages/discord-rpc/src/DiscordAuth.ts)
  (`POST https://discord.com/api/oauth2/token`).
- **DONE (4.3)** — `DiscordAuthenticator`
  ([`DiscordAuthenticator.ts`](../packages/discord-rpc/src/DiscordAuthenticator.ts))
  orchestrates: explicit `accessToken` (fast path) → valid stored token → refresh →
  interactive `AUTHORIZE` → exchange → persist to `FileTokenStore`. Wired through
  `DiscordVoiceProvider` (token path from `DECKORD_TOKEN_PATH` / `~/.deckord`).
- **DONE (4.4)** — token refresh (`grant_type=refresh_token`) before expiry, save-back
  through the store.
- **DONE (4.5)** — global `VOICE_CHANNEL_SELECT` subscription so joining/leaving/
  switching a channel is detected (the channel-select handler is now live).
- **DONE (4.6)** — `unsubscribeVoiceChannel(prevId)` (RPC `UNSUBSCRIBE`) on channel
  switch, so stale per-channel subscriptions are dropped.
- **DONE (4.7)** — reconnection/backoff in `DiscordVoiceProvider` (rebuilds the client
  and re-auths from the stored token; capped exponential backoff).
- **PARTIAL — the seam for a pre-obtained token** (`DISCORD_ACCESS_TOKEN`) is kept as a
  documented fast path in `DiscordAuthenticator`, so testing without the full OAuth
  round-trip stays possible.
- **DONE (4.8)** — live protocol-verification pass against a running Discord client:
  participants, speaking highlight, mute/deafen badges, and channel switching all
  confirmed working. Fixed the one mismatch found — the mute/deaf flags are nested
  under `voice_state`, so `normalizeVoiceState` now reads them there (with a top-level
  legacy fallback) and defaults every flag to a boolean.
- **TODO (4.9, optional)** — throttle/coalesce high-frequency `SPEAKING_*` events.
- **TODO** — OS-secured token storage (deferred to Phase 9).

**Definition of done (first real-client test):** with the Discord desktop client
running, the user in a voice channel, and a registered app (owner/tester), Deckord
authorizes once, shows the channel's real participants on the debug deck, highlights
whoever is speaking, badges mute/deafen, and persists the token across restarts.

**External prerequisites** (see [discord-rpc.md](./discord-rpc.md)): a Discord
application (`client_id` + `client_secret`), a registered redirect URI, and the
owner/tester allow-list for the whitelist-only `rpc` scope.

---

## Phase 5 — Renderer abstraction

**Goal:** a device-agnostic presentation layer that serves both CSS decks (which
use an image URL) and physical decks (which need rasterized button images).

Deliverables:

- **DONE** — presentational enrichment pass (`renderLayout` / `renderSlot`):
  titles, subtitles, badges, visual state, accessibility labels
  ([`renderSlot.ts`](../packages/renderer/src/renderSlot.ts)).
- **DONE** — badge logic (`badgesForUser`, `accessibilityLabelForUser`) covering
  self/server mute, self/server deaf, suppress, speaking, and page badges
  ([`badges.ts`](../packages/renderer/src/badges.ts),
  [`domain/deck.ts`](../packages/shared/src/domain/deck.ts)).
- **DONE** — theming primitives and `DEFAULT_THEME`
  ([`themes.ts`](../packages/renderer/src/themes.ts)).
- **DONE** — `RenderContext` + `AvatarResolver` seam so avatar sourcing is
  injectable ([`renderer/src/types.ts`](../packages/renderer/src/types.ts)).
- **DONE** — `toRenderedSlot`: maps an enriched `DeckSlot` to the adapter-facing
  `RenderedDeckSlot` (CSS decks use `image`).
Phase 5 is **DONE**:

- **DONE (5.1)** — avatar download + on-disk cache:
  [`AvatarCache`](../apps/deckord-service/src/avatars/AvatarCache.ts) `prefetch`
  downloads the Discord CDN avatar, caches it under `DECKORD_AVATAR_DIR`
  (`~/.deckord/avatars` by default), de-dupes by user + avatar hash, and never
  retries after a failure (logs `AVATAR_DOWNLOAD_FAILED`). `localPath` exposes the
  cached file to the image-renderer; `resolve` still returns the URL for the browser.
  The orchestrator warms the cache on every voice update.
- **DONE (5.2)** — deterministic identicon in
  [`identicon.ts`](../packages/renderer/src/identicon.ts): `identiconDataUrl` (SVG data
  URL, browser-safe) plus shared `initialsOf` / `colorForSeed` reused by the canvas
  renderer.
- **DONE (5.3)** — server-side PNG rasterization in the new
  [`@deckord/image-renderer`](../packages/image-renderer) package (`SlotImageRenderer`,
  backed by `@napi-rs/canvas` — prebuilt binaries for Windows + Linux + macOS). It
  composes avatar/identicon + title + subtitle + badges into a PNG buffer / data URL.
  **Only physical decks (Phase 7+) consume this** — the browser deck renders via CSS.
- **DONE (5.4)** — per-state styling in the canvas renderer, driven by the shared
  `@deckord/renderer` theme: speaking green border, selected border, mute/deafen dim +
  colored badges, distinct empty / status-slot rendering.

---

## Phase 6 — Adapter system

**Goal:** a stable, narrow device contract plus the machinery to drive any deck
from layouts, so hardware is the only replaceable part.

Deliverables:

- **DONE** — `IDeckAdapter` contract
  ([`IDeckAdapter.ts`](../packages/deck-adapter/src/IDeckAdapter.ts)):
  `start`/`stop`, `getLayoutSpec`, `setSlot`/`clearSlot`/`clearAll`, and
  `onButtonDown`/`onButtonUp`. Deck-core never depends on a concrete adapter, and an
  adapter never contains Discord logic.
- **DONE** — narrow `DeckWire` transport seam
  ([`deck-adapter/src/types.ts`](../packages/deck-adapter/src/types.ts)) so the
  package stays free of any concrete transport (`ws`, USB, …).
- **DONE** — `DeckAdapterHost` change-diffing driver (Phase 3), which matters more
  for slow physical decks than for the debug deck.
- **DONE** — one concrete adapter (`DebugBrowserDeckAdapter`) proving the contract.
- **DONE** — single-swap wiring: the concrete adapter is constructed in exactly one
  place ([`DeckordService`](../apps/deckord-service/src/DeckordService.ts)); nothing
  upstream changes when it is replaced.
- **DONE** — capability negotiation: `DeckCapabilities` (extends `DeckLayoutSpec`
  with `imageFormats` `'css'`/`'png'`, `knobCount`, `supportsBrightness`,
  `hasTextApi`) and `IDeckAdapter.getCapabilities()`.
- **DONE** — adapter registry / selection: `DeckAdapterRegistry` +
  `DeckAdapterFactory` pick an adapter at runtime — the preferred one
  (`DECKORD_DECK_ADAPTER`) if supported, else the first supported factory; the
  `DebugBrowserDeckFactory` is always available. `DeckordService` selects at start
  instead of hardcoding. Foundation for multiple decks / hot-plug (a factory's
  `isSupported()` probes for its hardware).
- **TODO** — runtime hot-plug monitoring (re-select when a device connects/
  disconnects) is left to the physical adapters that need it (Phase 7/8).

---

## Phase 7 — OpenDeck adapter

**Goal:** the first physical-device adapter, targeting OpenDeck-compatible hardware,
behind the same `IDeckAdapter` contract.

**Architecture decided** (see [docs/adapters/opendeck.md](./adapters/opendeck.md)):
**Variant B — two processes.** Deckord stays a standalone daemon that owns Discord;
OpenDeck integration is a thin host-launched **relay plugin** (`deckord.sdPlugin`),
with all Elgato-protocol logic in `@deckord/adapter-opendeck` inside the service.
Device layout/capabilities arrive as Elgato events (`-info` / `deviceDidConnect` /
`willAppear`) → aggregated into `DeckCapabilities`; needs `onCapabilitiesChanged` +
configuring `SlotManager` from capabilities (dynamic / hot-plug).

Deliverables — **code complete, pending verification on a real OpenDeck + device**:

- **DONE** — dynamic capabilities: `IDeckAdapter.onCapabilitiesChanged` + the service
  configures/rebuilds `SlotManager` from `getCapabilities()` (`slotConfigFromCapabilities`).
- **DONE** — `@deckord/adapter-opendeck`: the Elgato protocol
  (`protocol.ts`, `OpenDeckPluginTransport`), and `OpenDeckAdapter` implementing
  `IDeckAdapter` — learns layout from `deviceDidConnect`/`willAppear`, maps slot→context
  by (row,column), reports `DeckCapabilities`, rasterizes via `@deckord/image-renderer`
  and sends `setImage`, and maps key presses to `DeckButtonEvent`s.
- **DONE** — `OpenDeckFactory` registered in the service (Variant B) with an
  `OpenDeckWsLink` loopback relay endpoint + avatar resolver; opted in with
  `DECKORD_DECK_ADAPTER=opendeck` / `DECKORD_OPENDECK=1`.
- **DONE** — the `io.github.atomskz.deckord.sdPlugin` (manifest + `relay.mjs` dumb pipe
  + placeholder icons).
- **DONE** — verified end-to-end with a simulated relay: `willAppear` → capability
  reconfiguration (1→2→3 slots) → `setImage` PNG frames per context.
- **TODO (7.x)** — verify on a real OpenDeck host + a Stream Deck-compatible device;
  package `relay.mjs` for host launch (Node runtime / executable); real icons;
  Property Inspector; clear stale `willAppear` state on relay reconnect.

---

## Phase 8 — StreamDock / AJAZZ adapter (AKP05 PRO)

**Goal:** support StreamDock / AJAZZ hardware, specifically the **AKP05 PRO**
(**10 LCD keys**), behind the same `IDeckAdapter` contract.

> **Status: DEFERRED.** The AKP05 PRO already works through **OpenDeck** (Phase 7),
> so a direct USB-HID adapter is not on the critical path. This phase remains a
> future optimization (lower latency, no OpenDeck dependency) rather than a blocker.
> See [distribution](distribution.md) and [adapters/opendeck.md](adapters/opendeck.md).

Deliverables (all **TODO**, deferred):

- **TODO** — `StreamDockAdapter` implementing `IDeckAdapter` for the AKP05 PRO.
- **TODO** — 10-LCD-key layout spec (this maps cleanly onto the current
  `DEFAULT_SLOT_CONFIG` 2×5 = 10-slot grid, with the last slot reserved for status/page).
- **TODO** — device protocol/transport integration (USB HID / vendor SDK) via the
  `DeckWire`-style seam so `@deckord/deck-adapter` stays transport-agnostic.
- **TODO** — LCD image encoding for the AKP05 PRO key faces (consumes Phase 5
  rasterized images).
- **TODO** — button/knob event mapping to `DeckButtonEvent`.
- **TODO** — device discovery, reconnect, and brightness/sleep handling.
- **TODO** — hardware verification for the AKP05 PRO specifically.

---

## Phase 9 — Productization

**Goal:** ship Deckord as an installable, self-contained desktop product with a real
Discord app approval.

Deliverables grouped by area. Statuses reflect that some Phase 4 plumbing (the
interactive `AUTHORIZE` → token exchange in `DiscordAuthenticator`) already exists
and only needs a productized entry point.

**Configuration & bring-your-own Discord app**

- **DONE** — **Persisted settings store**: a `settings.json` in the data dir layered
  over the env defaults in
  ([`config/index.ts`](../apps/deckord-service/src/config/index.ts)), so config
  survives restarts and is edited from the UI instead of environment variables.
- **DONE** — **Bring-your-own Discord app**: the user supplies their own `client_id`
  / `client_secret`. Until the public Deckord app has Discord RPC approval, every
  user registers their own application; credentials are entered in the UI, persisted
  (secret secured), and drive the existing `AUTHORIZE` flow.
- **DONE** — **Config transport**: a WebSocket get/set-config protocol so the UI
  reads and writes settings live. Provider / credential / port changes are applied
  by a service restart ("restart to apply").
- **DONE** — **Config UI**: a settings screen (Discord credentials + Connect,
  provider choice, WS host/port/token, OpenDeck toggle, mock knobs, log level, app
  name) replacing environment variables.
- **TODO** — **First-run onboarding**: a guided first launch (enter credentials →
  connect Discord → done) instead of a blank screen.

**Security**

- **DONE** — **OS-secured secret storage**: the Discord token AND the user-supplied
  `client_secret` go through a `SecretStore` interface with a file (`0600`) fallback
  for the headless service and an Electron `safeStorage` implementation (Windows
  DPAPI / macOS Keychain / libsecret) in the desktop shell. Replaces
  `FileTokenStore`'s plaintext JSON.
- **DONE** — **Productize the `AUTHORIZE` flow**: the plumbing exists
  (`DiscordAuthenticator` → `client.authorize` → token exchange); a "Connect Discord"
  action triggers a restart into the Discord provider and surfaces progress/errors,
  so end users log in interactively without a pre-obtained `DISCORD_ACCESS_TOKEN`.
- **DONE** — **Privacy policy**: a shipped privacy policy consistent with the
  README's privacy stance (loopback-only, read-only scopes, no message reading, data
  stays local).

**Diagnostics**

- **DONE** — **Diagnostics view + export**: surface the typed error codes
  ([`errors.ts`](../packages/shared/src/errors.ts)) and provider/connection status,
  and export a redacted diagnostics bundle for support.

**Packaging & distribution (Electron)**

- **DONE (scaffold)** — **Electron shell**: an `apps/deckord-desktop` Electron app
  that runs the service in-process, shows the config UI in a window, and owns the
  tray. Framework decision: Electron for the MVP (see [distribution](distribution.md)).
- **DONE (scaffold)** — **System tray**: background tray with connect/disconnect,
  status, open settings, and quit; single-instance lock.
- **DONE (scaffold)** — **Auto-start**: launch on login (`setLoginItemSettings`).
- **DONE (scaffold)** — **Installer**: electron-builder config for Windows/macOS/Linux
  (bundling the service + UI instead of dev-mode Vite + `tsx watch`).
- **TODO** — **Code signing & notarization**: Windows Authenticode + macOS
  notarization so installers aren't flagged.
- **TODO** — **Auto-update** *(optional / later)*: an update channel for shipped builds.

**Discord distribution**

- **TODO** — **Discord approval**: register/verify the public Deckord application and
  obtain approval for the read-only voice scopes, so users no longer need their own
  `client_id` (bring-your-own remains the fallback / power-user path).
