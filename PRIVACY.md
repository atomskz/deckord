# Deckord — Privacy Policy

_Last updated: 2026-07-05_

Deckord is a **local, desktop application**. It shows the participants of your
current Discord voice channel on a macro deck (a browser "debug deck" or a
physical device via OpenDeck). This document describes exactly what data Deckord
touches and where it goes.

## The short version

- **Everything stays on your computer.** Deckord has no backend, no telemetry, no
  analytics, and no accounts. It never sends your data to us or to any third party.
- **Read-only.** Deckord requests read-only Discord voice scopes and never mutes,
  moves, or otherwise acts on anyone in Discord.
- **No messages.** Deckord does not read, store, or transmit the content of any
  Discord messages. It only sees voice-channel presence and speaking/mute state.

## What data Deckord accesses

Via Discord's **local RPC** interface (the Discord desktop client running on the
same machine), Deckord reads, for the voice channel you are in:

- channel and guild id/name;
- the list of participants: user id, username / display name, avatar;
- per-user voice state: speaking, self/server mute, self/server deafen, suppress.

Deckord connects to the Discord client over its local `discord-ipc-{0..9}`
pipe/socket. It does **not** use a user token, a self-bot, a client modification,
or screen/DOM scraping.

Scopes requested (read-only): `identify`, `rpc`, `rpc.voice.read`. Deckord never
requests `rpc.voice.write`.

## What Deckord stores, and where

All state lives in a local data directory (default `~/.deckord`, shown in the app's
**Settings → data** field):

| File | Contents | Protection |
| --- | --- | --- |
| `settings.json` | Your non-secret configuration (provider choice, ports, app name, etc.). No secrets. | file permissions `0600` |
| `secrets.json` *(headless service)* | Your Discord **client secret** and the OAuth **token**. | file permissions `0600` |
| OS secure store *(desktop app)* | The same secrets, encrypted at rest by the OS (Windows DPAPI / macOS Keychain / libsecret via Electron `safeStorage`). | OS-encrypted |
| `avatars/` | Cached copies of participants' avatar images. | local only |
| `diagnostics.json` | A **redacted** support bundle you generate on demand (see below). | file permissions `0600` |

You can delete the data directory at any time to remove everything Deckord has
stored. Nothing is retained elsewhere.

## Bring-your-own Discord application

Until the public Deckord application is approved by Discord, each user registers
their **own** Discord application and enters its `client_id` / `client_secret` in
Settings. Those credentials are yours; Deckord stores them locally (secured as
above) and uses them only to authenticate to your own Discord client. They are
never transmitted to us.

## Diagnostics

The **Generate diagnostics** button produces a support bundle containing your
platform/version info, provider and connection status, your effective settings,
and recent status/error messages. It is **redacted**: it contains presence flags
for secrets (`hasClientSecret`, `hasToken`) but never the secret values, and the
WebSocket shared-token is shown as `***`. Sharing it is your choice — Deckord does
not upload it anywhere; it is only written to `diagnostics.json` locally.

## Network

Deckord's own WebSocket API binds to **loopback** (`127.0.0.1`) only and can be
gated with a shared token. The only outbound network requests Deckord makes are:

- to Discord's OAuth token endpoint (`discord.com`) to exchange/refresh your token,
  using the credentials **you** provided; and
- to Discord's CDN to download participant avatars for the physical-deck renderer.

## Contact

Deckord is open source. Questions or concerns: open an issue at
<https://github.com/atomskz/deckord>.
