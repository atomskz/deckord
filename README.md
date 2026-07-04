# Deckord

Show the participants of your **Discord voice channel** on a macro deck — a grid of
labeled, tappable buttons — one button per person, lit up when they speak and
badged when they mute or deafen.

The macro deck can be **virtual** (the browser-based *debug deck* that ships today)
or, eventually, a **physical device** (Elgato Stream Deck, OpenDeck, StreamDock /
AJAZZ, …). Deckord is built so the device is the only replaceable part: everything
above it — reading Discord voice state, assigning people to slots, paginating,
rendering labels and badges — is device-agnostic.

> Status: **MVP+.** The end-to-end pipeline runs against the built-in **mock** voice
> channel and against a **real Discord client** — RPC transport, interactive OAuth
> (`AUTHORIZE` → token-exchange → refresh), and voice subscriptions, all verified live
> — rendered on the **browser debug deck**. Avatar caching and server-side PNG
> rendering (for future physical decks) are done. The **physical-device adapters**
> themselves are the main thing not implemented yet.
> See [MVP status](#mvp-status--not-yet-implemented).

---

## Why a debug deck exists

A physical macro deck is slow to iterate against: you need the hardware, a device
SDK, and a real Discord session in a real voice channel just to see whether a label
or a badge looks right. That makes the interesting logic — slot assignment,
pagination, speaking/mute rendering, reconnection — painful to develop and
impossible to test in CI.

The **debug deck** removes all of that. It is a first-class
[`IDeckAdapter`](packages/deck-adapter/src/IDeckAdapter.ts) implementation
([`DebugBrowserDeckAdapter`](packages/deck-adapter/src/DebugBrowserDeckAdapter.ts))
that paints the deck into a browser window over a local WebSocket and sends virtual
button presses back. Combined with the **mock voice provider**
([`MockVoiceProvider`](apps/deckord-service/src/voice/MockVoiceProvider.ts)), the
*entire* system runs with **no Discord client and no hardware present**. You develop
and test the whole pipeline in the browser; swapping in a physical adapter later is
a change in one place ([`DeckordService`](apps/deckord-service/src/DeckordService.ts))
and nowhere else.

---

## Architecture overview

Deckord is a pnpm monorepo. The service process owns the pipeline; the debug deck is
a separate browser app that talks to it over a loopback WebSocket.

```
                       ┌──────────────────────────────────────────────────────────────┐
                       │                    deckord-service (Node)                    │
                       │                                                              │
  Discord desktop      │   ┌───────────────┐                                          │
  client (RPC over     │   │ DiscordVoice  │ ─┐                                       │
  local IPC pipe)  ────┼──▶│   Provider    │  │  graceful fallback                    │
                       │   └───────────────┘  ├──▶ VoiceService ──▶ deck-core ──▶ ... │
                       │   ┌───────────────┐  │   (normalized       (SlotManager:     │
  (no Discord? use     │   │  MockVoice    │ ─┘    VoiceChannel      order + pages +  │
   the built-in mock)  │   │   Provider    │       State)           status slot)      │
                       │   └───────────────┘                            │             │
                       │                                                 ▼            │
                       │                        renderer ──▶ DeckAdapterHost ──▶      │
                       │                    (titles, badges,   (diffs slots,          │
                       │                     avatar, a11y)      pushes changes)       │
                       │                                            │                 │
                       │                              DebugBrowserDeckAdapter         │
                       │                              (an IDeckAdapter — REPLACEABLE) │
                       │                                            │                 │
                       │                                        WsServer              │
                       │                              (loopback WebSocket, optional   │
                       └──────────────────────────────── shared token) ───────────────┘
                                                            │        ▲
                                       slot/voice/status ▼  │        │ ▲ button + mock commands
                                                            ▼        │
                       ┌──────────────────────────────────────────────────────────────┐
                       │              deckord-debug-deck (browser / React)            │
                       │        renders the button grid, sends virtual presses,       │
                       │             drives the mock via debug controls               │
                       └──────────────────────────────────────────────────────────────┘
```

Pipeline in one line
(from [`DeckordService`](apps/deckord-service/src/DeckordService.ts)):

```
Discord/mock → VoiceService → deck-core → renderer → deck-adapter → debug browser deck
```

The **adapter is the replaceable bottom layer.** `deck-core` must never depend on a
concrete adapter, and an adapter must never contain Discord logic. Because the
debug adapter and any future physical adapter both implement the same
[`IDeckAdapter`](packages/deck-adapter/src/IDeckAdapter.ts) contract, replacing the
browser deck with hardware means constructing a different adapter in
[`DeckordService`](apps/deckord-service/src/DeckordService.ts) — nothing upstream
changes.

### Packages and apps

| Workspace | Path | What it does |
|-----------|------|--------------|
| `@deckord/shared` | [packages/shared](packages/shared) | Provider-agnostic domain types (`VoiceUser`, `VoiceChannelState`, `DeckSlot`, `DeckLayout`), typed errors, `Result`, and a small logger. No I/O. |
| `@deckord/ipc-contract` | [packages/ipc-contract](packages/ipc-contract) | The local WebSocket wire protocol: Zod schemas + `encode` / `decode*` for every message that crosses the service ↔ UI boundary. Also holds the default host/port/path constants. |
| `@deckord/discord-rpc` | [packages/discord-rpc](packages/discord-rpc) | Discord IPC transport, RPC handshake/request/dispatch, voice-state normalization, the interactive OAuth `AUTHORIZE` → token-exchange → refresh flow ([`DiscordAuthenticator`](packages/discord-rpc/src/DiscordAuthenticator.ts)), and a token store. Pending live verification against a real client. |
| `@deckord/deck-core` | [packages/deck-core](packages/deck-core) | Pure logic: turn a `VoiceChannelState` into a logical `DeckLayout` with stable slot ordering ([`AssignmentPolicy`](packages/deck-core/src/AssignmentPolicy.ts)), pagination ([`PageManager`](packages/deck-core/src/PageManager.ts)), and a reserved status/page slot ([`SlotManager`](packages/deck-core/src/SlotManager.ts)). No I/O, no timers. |
| `@deckord/renderer` | [packages/renderer](packages/renderer) | Enrich a logical layout with presentational fields: titles, subtitles, avatar source, status badges, accessibility labels, and a deterministic identicon. Browser-safe (no native deps). |
| `@deckord/image-renderer` | [packages/image-renderer](packages/image-renderer) | Node-only PNG rasterizer (`SlotImageRenderer`, backed by `@napi-rs/canvas`) that turns a rendered slot into button pixels for **physical** decks. The browser deck renders via CSS instead. |
| `@deckord/deck-adapter` | [packages/deck-adapter](packages/deck-adapter) | The replaceable device layer: the [`IDeckAdapter`](packages/deck-adapter/src/IDeckAdapter.ts) contract, a change-diffing [`DeckAdapterHost`](packages/deck-adapter/src/DeckAdapterHost.ts), and the MVP [`DebugBrowserDeckAdapter`](packages/deck-adapter/src/DebugBrowserDeckAdapter.ts). |
| `deckord-service` | [apps/deckord-service](apps/deckord-service) | The Node orchestrator: config, logging, voice providers + fallback, avatar resolver, WebSocket server, and the pipeline wiring in [`DeckordService`](apps/deckord-service/src/DeckordService.ts). |
| `deckord-debug-deck` | [apps/deckord-debug-deck](apps/deckord-debug-deck) | The Vite + React browser deck: renders the button grid, sends virtual presses, and exposes mock controls. |

---

## MVP status — not yet implemented

The pipeline is complete end-to-end in both mock mode and against a real Discord
client, rendered on the **browser debug deck**. The following are still absent:

- **Physical deck adapters.** Only [`DebugBrowserDeckAdapter`](packages/deck-adapter/src/DebugBrowserDeckAdapter.ts)
  exists. Elgato / OpenDeck / StreamDock adapters are future work behind the same
  [`IDeckAdapter`](packages/deck-adapter/src/IDeckAdapter.ts) interface.
- **Discord writes.** The RPC scopes are read-only; button presses drive debug-only
  behavior (page switching, local selection) and never mute/move anyone in Discord.

Typed error codes for these conditions live in
[`packages/shared/src/errors.ts`](packages/shared/src/errors.ts).

---

## Prerequisites

- **Node.js `>=20`** (see `engines` in [package.json](package.json)).
- **pnpm** — this repo pins `pnpm@10.13.1` via the `packageManager` field. The
  simplest way to get the right version is Corepack (bundled with Node):

  ```bash
  corepack enable
  ```

  Corepack will then use the pinned pnpm automatically inside this repo.

No Discord client and no hardware are required to run in the default mock mode.

---

## Install

```bash
pnpm install
```

## Run

Start the service and the debug deck together:

```bash
pnpm dev
```

This runs both processes concurrently:

- the **service** (`tsx watch`), which opens the WebSocket API on
  `ws://127.0.0.1:8787/deck`, and
- the **debug deck** (Vite dev server).

Then open the debug deck in your browser:

```
http://127.0.0.1:5173
```

The browser app auto-connects to the WebSocket at `ws://127.0.0.1:8787/deck` and
auto-reconnects if the service isn't up yet. On connect it receives a full snapshot
and then live updates.

You can also run the two halves separately:

```bash
pnpm dev:service      # just the Node service
pnpm dev:debug-deck   # just the browser deck
```

### Mock mode is the default

With no Discord environment variables set, the service resolves to the **mock voice
provider** ([`resolveInitialProvider`](apps/deckord-service/src/config/index.ts)). It
seeds a fake voice channel ("Mock Lounge") and, by default, drives speaking activity
on a timer so the deck lights up on its own. The debug UI's **mock controls** let you
add/remove users, toggle mute/deafen, trigger random speaking, start/stop the
simulation, and reset the channel — see the command list in
[`MockCommandSchema`](packages/ipc-contract/src/schemas.ts).

---

## Pointing at real Discord

The full Discord RPC path is implemented (transport, interactive `AUTHORIZE` →
token-exchange → refresh, subscriptions). See
[docs/discord-rpc.md](docs/discord-rpc.md) for the app-registration and testing walkthrough.

Interactive flow — register a Discord app (client id + secret + redirect URI), add
yourself under **App Testers** (the `rpc` scope is whitelist-only), run the Discord
desktop client, then:

```bash
export DISCORD_CLIENT_ID=your_application_client_id
export DISCORD_CLIENT_SECRET=your_application_client_secret
# DECKORD_PROVIDER defaults to `auto`, which already picks Discord RPC when a
# client id + secret are present. Set DECKORD_PROVIDER=discord-rpc to force it.
pnpm dev:service   # approve the consent prompt in Discord once; the token is cached
```

Fast path for testing without the OAuth round-trip — supply a **pre-obtained** token:

```bash
export DISCORD_CLIENT_ID=your_application_client_id
export DISCORD_ACCESS_TOKEN=a_token_with_the_scopes_below
pnpm dev
```

Requirements and behavior:

- **Scopes** (read-only, from [`MVP_SCOPES`](packages/discord-rpc/src/types.ts)):
  `identify`, `rpc`, `rpc.voice.read`. Deckord never requests `rpc.voice.write`.
- The Discord **desktop client must be running** and joined to a voice channel; the
  transport connects to its local `discord-ipc-{0..9}` pipe/socket.
- **Graceful fallback.** If the Discord provider can't start — Discord not running,
  no token, no selected voice channel, handshake failure — the service logs a warning
  status (`PROVIDER_SWITCHED_TO_MOCK`) and continues on the **mock** provider, so the
  rest of the system keeps running unchanged. See
  [`VoiceService`](apps/deckord-service/src/voice/VoiceService.ts).
- Provider selection is controlled by `DECKORD_PROVIDER`. In `auto` (the default),
  Discord RPC is attempted only when **both** `DISCORD_CLIENT_ID` and
  `DISCORD_ACCESS_TOKEN` are present; otherwise mock.

---

## Environment variables

All are optional; the defaults produce a working mock-mode setup on loopback.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DECKORD_PROVIDER` | `auto` | Provider preference: `auto`, `mock`, or `discord-rpc`. Under `auto`, Discord RPC is used only when `DISCORD_CLIENT_ID` **and** (`DISCORD_ACCESS_TOKEN` **or** `DISCORD_CLIENT_SECRET`) are present. |
| `DECKORD_WS_HOST` | `127.0.0.1` | WebSocket bind host (loopback by default). |
| `DECKORD_WS_PORT` | `8787` | WebSocket port. |
| `DECKORD_WS_PATH` | `/deck` | WebSocket path. |
| `DECKORD_WS_TOKEN` | *(none)* | Optional shared secret. When set, clients must connect with `?token=…`; connections without it are rejected. When unset, the service logs a warning that the API is unauthenticated. |
| `DECKORD_MOCK_AUTOSTART` | `true` | Whether the mock starts its speaking loop automatically (`1`/`true` to enable). |
| `DECKORD_MOCK_USERS` | `5` | Number of fake users the mock channel seeds. |
| `DECKORD_MOCK_SPEAKING_MS` | `1600` | Interval (ms) of the mock speaking loop. |
| `DECKORD_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, or `error`. |
| `DECKORD_APP_NAME` | `Deckord` | Display/app name used in logs and the status slot. |
| `DISCORD_CLIENT_ID` | *(none)* | Discord application client id (required for RPC); sent in the handshake. |
| `DISCORD_ACCESS_TOKEN` | *(none)* | Pre-obtained OAuth access token — the "fast path" that skips the interactive `AUTHORIZE` flow. |
| `DISCORD_CLIENT_SECRET` | *(none)* | Enables the interactive OAuth `AUTHORIZE` exchange and token refresh. Trusted local service only — never ship it to a browser client. |
| `DISCORD_REDIRECT_URI` | `http://127.0.0.1/callback` | Redirect URI used in the OAuth token exchange; must match one registered on the Discord application. |
| `DECKORD_TOKEN_PATH` | `~/.deckord/discord-token.json` | Where the OAuth token JSON is persisted (plaintext, mode `0600` in the MVP). Defaults to `{DECKORD_DATA_DIR}/discord-token.json`. |
| `DECKORD_DATA_DIR` | `~/.deckord` | Base data directory; used to derive the default `DECKORD_TOKEN_PATH`. |

The debug deck (browser) reads two optional Vite env vars, defaulting to loopback
(see [`DeckSocket.ts`](apps/deckord-debug-deck/src/services/DeckSocket.ts)):
`VITE_WS_URL` (default `ws://127.0.0.1:8787/deck`) and `VITE_WS_TOKEN` (appended as
`?token=…` to match `DECKORD_WS_TOKEN`).

---

## Development commands

Run from the repo root ([package.json](package.json)):

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies. |
| `pnpm dev` | Run the service **and** the debug deck concurrently. |
| `pnpm dev:service` | Run only the Node service (`tsx watch`). |
| `pnpm dev:debug-deck` | Run only the browser debug deck (Vite). |
| `pnpm test` | Run the test suite once (Vitest). |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm lint` | Lint the workspace (ESLint); `pnpm lint:fix` to autofix. |
| `pnpm build` | Build all packages (`pnpm -r run build`). |
| `pnpm typecheck` | Type-check all packages (`pnpm -r run typecheck`). |
| `pnpm format` | Format with Prettier; `pnpm format:check` to check only. |

---

## Privacy & security

Deckord is intentionally conservative about what it touches:

- **No user token / not a self-bot / no client modification.** Deckord talks to the
  official Discord **RPC** interface over the local IPC pipe. It is not a user-token
  bot, and it does not modify or inject into the Discord client.
- **No message reading.** The requested scopes are read-only voice scopes
  (`identify`, `rpc`, `rpc.voice.read`) — see
  [`MVP_SCOPES`](packages/discord-rpc/src/types.ts). Deckord never requests
  `rpc.voice.write` and performs **no writes** to Discord.
- **Minimal data.** Only voice presence and per-user state is consumed: who is in the
  channel, whether they are speaking, and their mute/deafen/suppress flags, plus a
  **display name** and an **avatar hash / URL**. See
  [`VoiceUser`](packages/shared/src/domain/voice.ts).
- **Data stays local.** State never leaves your machine. The service exposes only a
  **loopback** WebSocket (`127.0.0.1` by default) consumed by the local debug deck.
- **Loopback-only transport, optional shared token.** The WebSocket binds to
  loopback. Set `DECKORD_WS_TOKEN` (and the matching `VITE_WS_TOKEN`) to require a
  shared secret before exposing the API anywhere beyond localhost; without a token
  the service warns that the API is unauthenticated. See
  [`WsServer`](apps/deckord-service/src/server/WsServer.ts).
- **Token storage caveat (MVP).** The file-backed token store in
  [`DiscordAuth.ts`](packages/discord-rpc/src/DiscordAuth.ts) writes plaintext JSON
  (mode `0600`); an OS-secured store is future work. The client secret, if ever used,
  belongs only on the trusted local component and must never be shipped to a browser.
