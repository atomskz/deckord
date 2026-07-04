# Discord RPC Integration

How Deckord observes Discord voice activity through Discord's **local RPC/IPC
interface**. This document describes the actual implementation in
`packages/discord-rpc` and its consumer,
`apps/deckord-service/src/voice/DiscordVoiceProvider.ts`.

- Package: `@deckord/discord-rpc` (`packages/discord-rpc/src/`)
  - `DiscordIpcTransport.ts` — low-level named-pipe / unix-socket transport
  - `DiscordRpcClient.ts` — handshake, `AUTHORIZE`, request/response correlation, event dispatch
  - `DiscordAuth.ts` — token store + OAuth authorization-code / refresh token exchange
  - `DiscordAuthenticator.ts` — orchestrates token acquisition (fast-path / stored / refresh / interactive)
  - `types.ts` — opcodes, command/event names, scopes, raw payloads, normalization
  - `index.ts` — barrel export
- Consumer: `apps/deckord-service/src/voice/DiscordVoiceProvider.ts`
- Config: `apps/deckord-service/src/config/index.ts`

---

## 1. Allowed approach and hard constraints

Deckord integrates with Discord **only** through the officially supported, local
RPC/IPC surface exposed by the Discord desktop client. The following constraints
are non-negotiable and are reflected directly in the code:

- **Local RPC/IPC only.** The only connection Deckord opens to observe voice is
  the local `discord-ipc-{0..9}` named pipe (Windows) or unix domain socket.
  There is no network call to Discord's gateway or REST API from this package.
  The one remote endpoint, `https://discord.com/api/oauth2/token`, is used
  **only** to exchange/refresh an OAuth token on the trusted local service (see
  §6/§7) — it never touches the gateway or reads message content.
- **OAuth2 / RPC authorization.** Authorization uses the standard OAuth2
  `AUTHORIZE` → code → token → `AUTHENTICATE` model over RPC. The consent dialog
  is shown *inside* the Discord desktop client; there is **no browser redirect
  listener**.
- **NO user token.** Deckord never reads, requests, or stores a Discord user
  account token.
- **NO self-bot.** No user account is automated or driven programmatically.
- **NO client modification.** The Discord client is not patched, injected into,
  or otherwise altered.
- **NO DOM parsing.** Nothing scrapes or reads the Discord UI/DOM.
- **No BetterDiscord / Vencord dependency.** No client mod is required or used.
- **`rpc.voice.write` is intentionally NOT requested.** Deckord only *observes*
  voice state; it never mutes, moves, or otherwise mutates anyone.

The transport, handshake, request/response correlation, event dispatch, the
interactive OAuth `AUTHORIZE` → token-exchange flow, and token refresh are all
**implemented and working**. When Discord isn't reachable or authorization
cannot be completed, the service falls back to the mock provider (see §9).

---

## 2. IPC transport

Implemented in `DiscordIpcTransport.ts`.

### Endpoint discovery

`connect()` tries `discord-ipc-0` through `discord-ipc-9` in order and uses the
first socket that accepts the connection. The path is platform-specific
(`ipcPath(id)`):

- **Windows:** `\\?\pipe\discord-ipc-{id}` (named pipe)
- **Unix (Linux/macOS):** `{base}/discord-ipc-{id}`, where `base` is the first
  of `XDG_RUNTIME_DIR`, `TMPDIR`, `TMP`, `TEMP`, or `os.tmpdir()`.

If none of `0..9` connect, it throws `DeckordError('DISCORD_IPC_NOT_FOUND', …)`.

### Frame format

Every message — in both directions — is framed as:

```
[ int32 op (little-endian) ][ int32 length (little-endian) ][ utf8 JSON body ]
```

- `op` is one of the `RpcOpcode` values (see below).
- `length` is the byte length of the UTF-8 JSON body.
- The body is `JSON.stringify(payload)` encoded as UTF-8.

`send(op, payload)` builds an 8-byte header (`writeInt32LE(op, 0)`,
`writeInt32LE(body.length, 4)`) and writes `header + body`. Sending before a
socket exists throws `DeckordError('DISCORD_NOT_RUNNING', …)`.

Incoming bytes are accumulated in a read buffer and de-framed in `onData`: while
at least 8 bytes are buffered, it reads `op` and `len`. A **frame-length guard**
(`MAX_FRAME_BYTES = 16 MiB`) rejects a negative or oversized `len` — treated as a
desynced stream: the error is reported to error handlers, the buffer is cleared,
and the socket is closed. Otherwise it waits until `8 + len` bytes are available,
slices out the JSON body, `JSON.parse`s it, and dispatches `(op, data)` to
message handlers. Malformed JSON is reported to error handlers and skipped (the
frame is consumed, the loop continues).

The transport exposes `onMessage`, `onClose`, and `onError` handler
registration, plus `close()` which destroys the socket.

### Opcodes (`RpcOpcode` in `types.ts`)

| Name        | Value | Direction / use                                     |
|-------------|-------|-----------------------------------------------------|
| `Handshake` | `0`   | Client → Discord, initial handshake frame           |
| `Frame`     | `1`   | Command frames and dispatched events (both ways)    |
| `Close`     | `2`   | Close                                                |
| `Ping`      | `3`   | Discord → client keepalive                          |
| `Pong`      | `4`   | Client → Discord, echoed in reply to a `Ping`       |

`DiscordRpcClient.handleFrame` answers any inbound `Ping` by immediately sending
the same payload back with opcode `Pong`.

---

## 3. Connection lifecycle

The end-to-end flow spans `DiscordRpcClient` (handshake, `AUTHORIZE`,
`AUTHENTICATE`), `DiscordAuthenticator.acquire()` (token acquisition, §7), and
`DiscordVoiceProvider` (channel read + subscribe + reconnect).

1. **Connect the socket.** `state = 'connecting'`; `transport.connect()` opens
   the first available `discord-ipc-*` pipe.
2. **Handshake — and *only* the handshake.** `state = 'handshaking'`; send
   opcode `Handshake` with `{ v: 1, client_id: config.clientId }`. The client
   awaits a frame whose `evt` is `READY`, which resolves the handshake.
   `connect()` deliberately does **not** authenticate.
3. **Acquire a token.** The provider calls
   `DiscordAuthenticator.acquire(client)`, which returns an access token by the
   cheapest available means — explicit token → valid stored token → refresh →
   interactive `AUTHORIZE`. See §7 for the full decision tree. The interactive
   path issues the `AUTHORIZE` command (`state` stays `handshaking` at this
   point) and waits up to **120 s** for the user to approve the in-client consent
   dialog, which returns an authorization `code` on the RPC channel; the code is
   then exchanged for tokens.
4. **Authenticate.** `state = 'authenticating'`; `authenticate(token)` sends the
   `AUTHENTICATE` command with `{ access_token }`. On success `state = 'ready'`.
5. **Subscribe globally.** The provider subscribes to the **global**
   `VOICE_CHANNEL_SELECT` event (no `channel_id`) so it is notified whenever the
   user joins, leaves, or switches a voice channel.
6. **Read the selected voice channel.** The provider calls
   `getSelectedVoiceChannel()`, which issues `GET_SELECTED_VOICE_CHANNEL`. The
   result (or `null`) becomes the current channel; its `voice_states` seed the
   initial user map (via `normalizeVoiceState`).
7. **Subscribe per channel.** If a channel is selected,
   `subscribeVoiceChannel(channelId)` fires five `SUBSCRIBE` requests in parallel
   (see §4), each scoped to `{ channel_id }`, to receive live voice-state and
   speaking events.

### Channel switch

When the global `VOICE_CHANNEL_SELECT` event fires, the provider reloads the
selected channel. If the channel changed (or the user left), it first
**`UNSUBSCRIBE`s the old channel's** five per-channel events
(`unsubscribeVoiceChannel(oldId)`), then, if a new channel is selected,
**`SUBSCRIBE`s the new channel**. The tracked `subscribedChannelId` guards
against redundant re-subscription.

### Reconnect / backoff

If the transport closes after a successful start (e.g. the Discord client
restarts), the provider does **not** fall back to mock — it rebuilds the client
and retries `connect → acquire → authenticate → subscribe` with **capped
exponential backoff**: `min(30 s, 1 s × 2^min(attempt, 5))`. A failed reconnect
reschedules another attempt. `stop()` cancels any pending reconnect,
unsubscribes the current channel, and closes the transport.

### Request/response correlation

Every command frame carries a `nonce` (`randomUUID()`). `request(cmd, args, evt,
timeoutMs)` stores a pending resolver keyed by that nonce with a configurable
timeout (**default 10 s**; the interactive `AUTHORIZE` uses **120 s** because it
waits on the user). `handleFrame` matches an inbound frame's `nonce` back to the
pending request, resolving with `frame.data` — or, if the frame's `evt` is
`ERROR`, rejecting with `DeckordError('DISCORD_AUTH_FAILED', …)`. On timeout the
pending entry is dropped and the request rejects.

---

## 4. Commands and events

Command and event name constants live in `types.ts` as `RPC_COMMANDS` and
`RPC_EVENTS`.

### Commands (`RPC_COMMANDS`)

| Command                      | Status in code                                                                     |
|------------------------------|------------------------------------------------------------------------------------|
| `AUTHORIZE`                  | **Issued** by `authorize()` during the interactive flow (120 s timeout); returns a `code`. |
| `AUTHENTICATE`               | Issued by `authenticate()` after a token is acquired, with `{ access_token }`.     |
| `GET_SELECTED_VOICE_CHANNEL` | Issued by `getSelectedVoiceChannel()`.                                             |
| `GET_CHANNEL`                | Declared constant; **not** issued by the current code.                             |
| `SUBSCRIBE`                  | Issued by `subscribe()` / `subscribeVoiceChannel()` (carries `evt` + args).        |
| `UNSUBSCRIBE`                | **Issued** by `unsubscribe()` / `unsubscribeVoiceChannel()` on channel switch / stop. |

### Events (`RPC_EVENTS`)

| Event                  | Handling                                                                 |
|------------------------|--------------------------------------------------------------------------|
| `READY`                | Resolves the handshake.                                                   |
| `ERROR`                | On a nonce'd response → rejects that request with `DISCORD_AUTH_FAILED`.  |
| `VOICE_CHANNEL_SELECT` | Subscribed **globally** by the provider → emits `channel_id ?? null`, triggering a channel reload / re-subscribe. |
| `VOICE_STATE_CREATE`   | Subscribed per channel → emits a `create` voice-state change.            |
| `VOICE_STATE_UPDATE`   | Subscribed per channel → emits an `update` voice-state change.           |
| `VOICE_STATE_DELETE`   | Subscribed per channel → emits a `delete` voice-state change.            |
| `SPEAKING_START`       | Subscribed per channel → `onSpeaking(userId, true)`.                     |
| `SPEAKING_STOP`        | Subscribed per channel → `onSpeaking(userId, false)`.                    |

`subscribeVoiceChannel(channelId)` subscribes to exactly five events —
`VOICE_STATE_CREATE`, `VOICE_STATE_UPDATE`, `VOICE_STATE_DELETE`,
`SPEAKING_START`, `SPEAKING_STOP` — each with `{ channel_id: channelId }`.
`unsubscribeVoiceChannel(channelId)` mirrors this with five `UNSUBSCRIBE`s.
`VOICE_CHANNEL_SELECT` is subscribed **once, globally** (no `channel_id`) by the
provider, separately from the per-channel subscriptions.

Any inbound event not matched above is logged at debug level and otherwise
ignored.

---

## 5. Scopes (read-only)

Declared in `types.ts` as `MVP_SCOPES` and used as the default `scopes` in the
service config:

```ts
export const MVP_SCOPES = ['identify', 'rpc', 'rpc.voice.read'] as const;
```

| Scope            | Why                                                    |
|------------------|--------------------------------------------------------|
| `identify`       | Identify the authorizing user.                         |
| `rpc`            | Use the RPC interface.                                 |
| `rpc.voice.read` | **Read** voice channel + voice-state/speaking events.  |

`rpc.voice.write` is **intentionally NOT requested.** Deckord only *observes*
voice state; it never mutes, moves, or otherwise mutates anyone's voice. The
constant's own comment states: *"Minimal read-only scopes required for the MVP.
NEVER request rpc.voice.write."*

Note the `rpc` scope is **whitelist-only** on Discord's side — see §8 for how to
add yourself as an app tester so the authorization succeeds.

---

## 6. Auth model

Types in `types.ts` (`DiscordRpcConfig`) and `DiscordAuth.ts`
(`StoredToken`, `TokenStore`, `exchangeCodeForToken`, `refreshAccessToken`,
`isTokenValid`).

- **Client id** (`config.clientId`) — the application's public client id, sent
  in the handshake. Sourced from `DISCORD_CLIENT_ID`.
- **Scopes** (`config.scopes`) — defaults to `MVP_SCOPES` (§5).
- **Access token** (`config.accessToken`) — an optional pre-obtained OAuth
  access token that lets the client skip the interactive `AUTHORIZE` step
  entirely (the "fast path"). Sourced from `DISCORD_ACCESS_TOKEN`.
- **Client secret** (`config.clientSecret`, optional) — required for the OAuth
  token exchange and refresh. Its comment: *"Never ship this in the client."* It
  lives only on the trusted local service. Sourced from `DISCORD_CLIENT_SECRET`.
- **Redirect URI** (`config.redirectUri`, optional) — sent in the token
  exchange; defaults to `http://127.0.0.1/callback`. Must match a redirect URI
  registered on the Discord application. Sourced from `DISCORD_REDIRECT_URI`.

### Token exchange & refresh

Both live in `DiscordAuth.ts` and `POST` to
`https://discord.com/api/oauth2/token` with an
`application/x-www-form-urlencoded` body carrying `client_id`, `client_secret`,
and the grant fields:

- **`exchangeCodeForToken(config, code)`** — `grant_type=authorization_code`
  with the `code` from `AUTHORIZE` and the `redirect_uri`.
- **`refreshAccessToken(config, refreshToken)`** — `grant_type=refresh_token`.

Both require `DISCORD_CLIENT_SECRET` (they throw `DISCORD_AUTH_FAILED` without
it). A non-2xx response throws `DISCORD_AUTH_FAILED` with the status + body. On
success the JSON (`access_token`, `refresh_token`, `expires_in`, `scope`) is
mapped to a `StoredToken`, with `expiresAt = Date.now() + expires_in × 1000`.
Discord access tokens are valid for roughly **7 days**;
`isTokenValid(token, margin = 60 s)` treats a token as valid only if it isn't
within `margin` of `expiresAt` — so the authenticator refreshes proactively.

### Token store

`TokenStore` is the persistence interface:

```ts
interface TokenStore {
  load(): Promise<StoredToken | null>;
  save(token: StoredToken): Promise<void>;
  clear(): Promise<void>;
}

type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
};
```

Two implementations ship today:

- **`FileTokenStore`** — file-backed JSON at a given path (creates parent
  directories on save). The MVP writes **plaintext** JSON with `mode: 0o600`;
  this is called out as a security note in the code and is slated to be replaced
  by an OS-secured store (Windows DPAPI/Credential Manager, macOS Keychain,
  libsecret) behind the same interface in **Phase 9**. The path defaults to
  `DECKORD_TOKEN_PATH`, or `~/.deckord/discord-token.json`
  (`{DECKORD_DATA_DIR}/discord-token.json`).
- **`MemoryTokenStore`** — in-memory, for tests and ephemeral prototypes.

`VoiceService` constructs a `FileTokenStore` from `config.discordTokenPath` and
passes it into `DiscordVoiceProvider`, which hands it to the
`DiscordAuthenticator`.

---

## 7. Authorization flow (`DiscordAuthenticator.acquire`)

`DiscordAuthenticator.acquire(client)` runs against an **already-handshaken**
client and returns an access token, which the provider then passes to
`client.authenticate(token)`. It tries the cheapest option first:

1. **Explicit access token (fast path).** If `config.accessToken`
   (`DISCORD_ACCESS_TOKEN`) is set, it is returned as-is. No client secret, no
   store, no network call — ideal for quick testing.
2. **Valid stored token.** Otherwise `store.load()` is consulted; if a token
   exists and `isTokenValid()` is true, its `accessToken` is returned.
3. **Refresh.** If the stored token is expiring but has a `refreshToken` **and**
   a `clientSecret` is configured, `refreshAccessToken()` is called; the
   refreshed token is persisted with `store.save()` and returned. A failed
   refresh logs a warning and falls through to step 4.
4. **Interactive `AUTHORIZE`.** With no usable token:
   - If **no** `clientSecret` is configured, it throws
     `DeckordError('DISCORD_AUTH_REQUIRED', …)` — there is nothing to exchange a
     code with (see §9). Supply `DISCORD_CLIENT_SECRET` or `DISCORD_ACCESS_TOKEN`.
   - Otherwise it calls `client.authorize(scopes)`, which issues the RPC
     `AUTHORIZE` command and shows the consent dialog inside the Discord desktop
     client (waiting up to 120 s). Discord returns an authorization `code` on the
     RPC channel — **no browser redirect listener is involved**. The code is
     exchanged via `exchangeCodeForToken()` (POST to the token endpoint with the
     client secret, on the trusted local service), the resulting token is
     persisted with `store.save()`, and its `accessToken` is returned.

On subsequent runs, step 2 (or step 3) short-circuits the flow, so the consent
dialog is a **one-time** cost until the refresh token can no longer renew.

---

## 8. Setup & testing against a real Discord client

To exercise authenticated RPC end-to-end against a live Discord desktop client:

1. **Create a Discord application.** In the
   [Discord Developer Portal](https://discord.com/developers/applications),
   create an application and copy its **Client ID** and **Client Secret**
   (OAuth2 → General).
2. **Add a redirect URI.** Under **OAuth2 → General → Redirects**, add a redirect
   URI (e.g. `http://127.0.0.1/callback`). It must match the `redirect_uri` used
   in the token exchange — i.e. `DISCORD_REDIRECT_URI`, defaulting to
   `http://127.0.0.1/callback`.
3. **Whitelist yourself for the `rpc` scope.** The `rpc` scope is **whitelist-only**.
   Either use the application **owner** account, or add your account under the
   application's **App Testers** so the `AUTHORIZE` consent will succeed.
4. **Run the Discord desktop client** and **join a voice channel** — the RPC
   surface is exposed by the running desktop client, and
   `GET_SELECTED_VOICE_CHANNEL` needs you to actually be in a channel.
5. **Start Deckord (interactive OAuth).** Provide the client id + secret and force
   the Discord provider:

   ```bash
   DISCORD_CLIENT_ID=… \
   DISCORD_CLIENT_SECRET=… \
   DECKORD_PROVIDER=discord-rpc \
   DECKORD_LOG_LEVEL=debug \
   pnpm dev:service
   ```

   Approve the in-client consent dialog **once**. The exchanged token is cached
   at `DECKORD_TOKEN_PATH` (default `~/.deckord/discord-token.json`), so later
   runs reuse/refresh it without prompting again.
6. **Fast path (no OAuth).** To test without the consent flow, skip the secret
   and pass a pre-obtained token instead:

   ```bash
   DISCORD_CLIENT_ID=… \
   DISCORD_ACCESS_TOKEN=… \
   DECKORD_PROVIDER=discord-rpc \
   pnpm dev:service
   ```

### Environment variables (Discord)

| Env var                 | Maps to                  | Notes                                                                     |
|-------------------------|--------------------------|---------------------------------------------------------------------------|
| `DISCORD_CLIENT_ID`     | `discord.clientId`       | Application client id; sent in the handshake. Required for RPC.           |
| `DISCORD_CLIENT_SECRET` | `discord.clientSecret`   | Required for the interactive `AUTHORIZE` exchange and token refresh. Trusted local service only — never ship to a browser. |
| `DISCORD_ACCESS_TOKEN`  | `discord.accessToken`    | Pre-obtained token; the fast path that skips `AUTHORIZE`.                 |
| `DISCORD_REDIRECT_URI`  | `discord.redirectUri`    | Token-exchange redirect URI; defaults to `http://127.0.0.1/callback`. Must be registered on the app. |
| `DECKORD_PROVIDER`      | `provider` preference    | `auto` (default), `mock`, or `discord-rpc`. Under `auto`, Discord RPC is chosen only when `DISCORD_CLIENT_ID` **and** (`DISCORD_ACCESS_TOKEN` **or** `DISCORD_CLIENT_SECRET`) are present. |
| `DECKORD_TOKEN_PATH`    | `discordTokenPath`       | Where the OAuth token JSON is persisted. Defaults to `{DECKORD_DATA_DIR}/discord-token.json`. |
| `DECKORD_DATA_DIR`      | (token path base)        | Base data directory; defaults to `~/.deckord`. Only used to derive the default token path. |

`discord.scopes` is fixed to `MVP_SCOPES` and is not env-overridable.

---

## 9. Normalization: raw voice state → `VoiceUser`

`normalizeVoiceState(raw, isSpeaking = false)` in `types.ts` maps a raw RPC
`RawVoiceState` (partial Discord payload) onto the provider-agnostic
`VoiceUser` (`@deckord/shared`, `domain/voice.ts`). Downstream consumers never
see raw Discord shapes.

| `VoiceUser` field | Source in `RawVoiceState`                                         |
|-------------------|-------------------------------------------------------------------|
| `userId`          | `raw.user.id`                                                     |
| `username`        | `raw.user.username`                                              |
| `displayName`     | `raw.nick || raw.user.global_name || raw.user.username` (first non-empty) |
| `avatarHash`      | `raw.user.avatar ?? undefined`                                   |
| `avatarUrl`       | `discordAvatarUrl(user.id, user.avatar)` (see below)             |
| `isSpeaking`      | the `isSpeaking` argument (default `false`)                      |
| `selfMute`        | `raw.self_mute`                                                  |
| `serverMute`      | `raw.mute`                                                       |
| `selfDeaf`        | `raw.self_deaf`                                                  |
| `serverDeaf`      | `raw.deaf`                                                       |
| `suppress`        | `raw.suppress`                                                   |
| `volume`          | `raw.volume`                                                     |

`discordAvatarUrl(userId, avatarHash)` returns `undefined` when there's no hash;
otherwise `https://cdn.discordapp.com/avatars/{userId}/{hash}.{ext}?size=128`,
where `ext` is `gif` for animated hashes (prefix `a_`) or `png` otherwise.

### How the provider maintains state

`DiscordVoiceProvider` keeps a `Map<userId, VoiceUser>`:

- Initial fill: each entry in the selected channel's `voiceStates` is normalized
  and inserted.
- `VOICE_STATE_CREATE` / `UPDATE`: normalize and upsert, **preserving** the
  existing `isSpeaking` flag (speaking arrives on separate events).
- `VOICE_STATE_DELETE`: remove the user.
- `SPEAKING_START` / `STOP`: flip `isSpeaking` on the matching user (ignored if
  the user isn't in the map).

Each change produces a `VoiceChannelState` snapshot (`provider: 'discord-rpc'`,
`connected`, `channelId`, `channelName`, `guildId`, `users`, `updatedAt`) emitted
to update handlers.

---

## 10. Failure states — all fall back to mock

Every failure is a typed `DeckordError` (`packages/shared/src/errors.ts`).
`DiscordVoiceProvider.start()` propagates it; `VoiceService.tryStartDiscord()`
catches it, logs a warning, emits a `PROVIDER_SWITCHED_TO_MOCK` status, and
starts `MockVoiceProvider` instead — so **the system keeps running regardless.**

| Condition                     | Error code                  | Where it originates                                                        |
|-------------------------------|-----------------------------|---------------------------------------------------------------------------|
| Discord not running (no socket)| `DISCORD_NOT_RUNNING`      | `send()` when the socket is absent.                                        |
| IPC pipe not found            | `DISCORD_IPC_NOT_FOUND`     | `transport.connect()` after trying `discord-ipc-0..9`.                     |
| Auth required                 | `DISCORD_AUTH_REQUIRED`     | `DiscordAuthenticator.acquire()` — no valid token **and** no `DISCORD_CLIENT_SECRET` to run the interactive `AUTHORIZE`. |
| Auth failed                   | `DISCORD_AUTH_FAILED`       | An RPC `ERROR` response (e.g. `AUTHORIZE`/`AUTHENTICATE`), a non-2xx from the token endpoint, or a missing client secret during exchange/refresh. |
| Scopes unavailable            | `DISCORD_SCOPES_UNAVAILABLE`| Reserved code for when granted scopes are insufficient (not thrown by this package today).|
| No selected voice channel     | `NO_SELECTED_VOICE_CHANNEL` | `getSelectedVoiceChannel()` returns `null` → provider reports a warning status. |

Notes on how each surfaces:

- **`DISCORD_NOT_RUNNING`, `DISCORD_IPC_NOT_FOUND`, `DISCORD_AUTH_REQUIRED`,
  `DISCORD_AUTH_FAILED`** are thrown out of `start()` and cause `VoiceService`
  to switch to the mock provider (`PROVIDER_SWITCHED_TO_MOCK`).
- **`DISCORD_AUTH_REQUIRED`** is raised by `DiscordAuthenticator` (not
  `connect()`): the handshake succeeds, but there is no valid token and no client
  secret for the interactive `AUTHORIZE`. Supply `DISCORD_CLIENT_SECRET`
  (and register/whitelist the app, §8) or `DISCORD_ACCESS_TOKEN`.
- **`NO_SELECTED_VOICE_CHANNEL`** is *not* fatal: the Discord provider starts
  successfully with an empty user set and emits a `warning`-level status. If the
  user later selects a channel, the global `VOICE_CHANNEL_SELECT` triggers a
  reload and per-channel subscribe.
- **A dropped connection** after start emits a `WEBSOCKET_DISCONNECTED`
  warning status (`transport` close handler) and the provider **reconnects with
  backoff** (§3) — it does *not* fall back to mock in that case.
  `PROVIDER_SWITCHED_TO_MOCK` is the status emitted specifically when
  `VoiceService` performs the initial-start fallback.

`resolveInitialProvider()` also *pre-empts* most of these under `auto`: it only
attempts Discord RPC when `DISCORD_CLIENT_ID` **and** (`DISCORD_ACCESS_TOKEN` or
`DISCORD_CLIENT_SECRET`) are configured, so a bare install boots straight into
mock without a failed connection attempt.

---

## 11. Remaining work

- **Task 4.8 — live protocol verification.** The one remaining step is verifying
  the flow against a real Discord desktop client (payload shapes, event field
  names, and the `AUTHORIZE` handshake) and adjusting any mismatches. See §8 for
  the setup.
- **Task 4.9 — speaking-event throttle (optional).** Coalescing/throttling
  `SPEAKING_START` / `SPEAKING_STOP` bursts is a nice-to-have optimization, not a
  correctness requirement.
