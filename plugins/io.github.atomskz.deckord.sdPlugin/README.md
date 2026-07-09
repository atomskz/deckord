# Deckord OpenDeck plugin (`io.github.atomskz.deckord.sdPlugin`)

The OpenDeck / Elgato Stream Deck plugin for Deckord. Per the
[architecture decision](../../docs/adapters/opendeck.md) this is a **thin relay
(Variant B)**: it is launched by the OpenDeck host, connects to it, and forwards raw
Elgato frames to/from the standalone **Deckord service**, where all the logic lives
(`@deckord/adapter-opendeck`). The relay itself is a dumb pipe.

## How it works

```
OpenDeck host ──launch(-port,-pluginUUID,-registerEvent)──▶ relay.mjs
      ▲                                                        │
      └───────────────── Elgato WS ────────────────────────────┘
                                                               │  ws://127.0.0.1:8788/opendeck
                                                               ▼
                                                    Deckord service (OpenDeckAdapter)
```

- `manifest.json` declares the plugin (UUID = folder name = `io.github.atomskz.deckord`)
  and two actions: **Voice Slot** (`io.github.atomskz.deckord.slot`) and
  **Status / Page** (`io.github.atomskz.deckord.status`).
- `relay.mjs` is the `CodePath` the host launches. It registers with the host and
  pipes frames to/from Deckord (`DECKORD_OPENDECK_URL`, default
  `ws://127.0.0.1:8788/opendeck`), queuing until each side connects and retrying the
  Deckord connection if the service is not up yet.

## Using it

1. Run the Deckord service with OpenDeck enabled:
   `DECKORD_DECK_ADAPTER=opendeck pnpm dev:service` (opens the relay endpoint on
   `127.0.0.1:8788/opendeck`).
2. Install this folder into OpenDeck's plugins directory, then in OpenDeck drag the
   **Voice Slot** action onto the keys you want, and **Status / Page** onto one key.
3. The keys light up with the channel's participants (avatar, speaking glow,
   mute/deafen badges) driven by the service.

## Open items (skeleton)

- **Packaging / launch:** per-OS launchers ship — `relay.sh` (`CodePath`, Linux/macOS)
  and `relay.cmd` (`CodePathWin`, Windows) both invoke `node relay.mjs`. They still
  require **Node >= 22 on PATH** (for the global `WebSocket`); bundling a runtime so
  the plugin starts with no system Node is future work.
- **Icons:** `icons/plugin`, `icons/slot`, `icons/status` are placeholders.
- **Property Inspector:** a small HTML PI showing Deckord-service connection status
  (and a `Participant` / `Status-Page` role) is not built yet.
- **Reconnect semantics:** on a Deckord restart the relay reconnects, but stale
  `willAppear` state on the service side is not yet cleared.
