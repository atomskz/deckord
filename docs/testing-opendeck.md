# Testing Deckord with a real device in OpenDeck

This is a step-by-step guide for running Deckord end-to-end against a **real
OpenDeck host + a physical Stream Deck-compatible device** (e.g. AJAZZ AKP05 PRO,
Elgato Stream Deck, Mirabox, …).

> Status: this path is **code-complete but not yet verified on real hardware**
> (roadmap Phase 7, item 7.x). The steps below are what the architecture expects;
> expect to hit the rough edges called out under [Known gaps](#known-gaps).

## How the pieces fit (Variant B — two processes)

```
Discord client ─IPC─▶ deckord-service (owns Discord + the whole pipeline)
                        └─ OpenDeckAdapter ──WS(:8788/opendeck)──▶ relay.mjs ──Elgato WS──▶ OpenDeck host ──▶ your device
```

- The **service** (`deckord-service`) owns everything: Discord/mock voice,
  slot layout, PNG rasterization, and the Elgato protocol logic
  (`@deckord/adapter-opendeck`). It exposes a loopback endpoint on
  `ws://127.0.0.1:8788/opendeck`.
- The **relay** (`plugins/io.github.atomskz.deckord.sdPlugin/relay.mjs`) is a dumb
  byte-pipe launched *by* the OpenDeck host. It forwards raw Elgato frames between
  the host and the service. It contains no logic.
- OpenDeck sends you only the **keys you assign the Deckord action to** — slot count
  follows the keys you place, not the whole device.

## Prerequisites

- **OpenDeck** installed and detecting your device
  (<https://github.com/nekename/OpenDeck>), with the device showing in its grid.
- **Node.js ≥ 22 on your `PATH`** — the relay uses a global `WebSocket`, which
  Node exposes only from v22. (This repo already runs on Node 24.) Check: `node -v`.
- Deckord installed and building: from the repo root, `pnpm install` then
  `pnpm test` (should be all green).
- For a **real Discord** test, the bring-your-own Discord app from the
  [README](../README.md#distribution-model-v1-bring-your-own-discord-app) /
  [docs/discord-rpc.md](./discord-rpc.md). You can do a **first pass in mock mode**
  with no Discord at all.

---

## Step 1 — Start the Deckord service with OpenDeck enabled

Opting in with `DECKORD_DECK_ADAPTER=opendeck` both selects the OpenDeck adapter
**and** opens the relay endpoint on `127.0.0.1:8788/opendeck`
([config/index.ts](../apps/deckord-service/src/config/index.ts) — `openDeck.enabled`).

### Mock mode first (no Discord, recommended for the first hardware bring-up)

```bash
DECKORD_DECK_ADAPTER=opendeck DECKORD_LOG_LEVEL=debug pnpm dev:service
```

You should see a log line:

```
OpenDeck relay endpoint on ws://127.0.0.1:8788/opendeck
```

The mock seeds a fake "Mock Lounge" with 5 users and drives speaking on a timer,
so the keys will animate once the relay connects — no Discord needed.

### Real Discord mode

Set the Discord vars **in addition** to the OpenDeck one (see the README for the
full auth walkthrough), then start the service:

```bash
export DISCORD_CLIENT_ID=your_application_client_id
export DISCORD_CLIENT_SECRET=your_application_client_secret   # or DISCORD_ACCESS_TOKEN=…
DECKORD_DECK_ADAPTER=opendeck DECKORD_LOG_LEVEL=debug pnpm dev:service
# approve the one-time consent prompt in your Discord client; join a voice channel
```

Useful knobs (all optional — [config/index.ts](../apps/deckord-service/src/config/index.ts)):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DECKORD_DECK_ADAPTER` | `debug-browser` | Set to `opendeck` to select the adapter + open the relay endpoint. |
| `DECKORD_OPENDECK` | `false` | Alternative opt-in that opens the endpoint without forcing adapter selection. |
| `DECKORD_OPENDECK_PORT` | `8788` | Relay endpoint port (must match the relay's `DECKORD_OPENDECK_URL`). |
| `DECKORD_OPENDECK_ICON` | `96` | Square key image size in px rasterized for each key. |

> Tip: you can run the **browser debug deck at the same time** (`pnpm dev`) — the
> service drives all outputs at once, so the browser mirrors exactly what the
> hardware shows. Great for confirming the pipeline is alive independent of the
> device.

---

## Step 2 — Install the relay plugin into OpenDeck

1. The plugin ships per-OS launchers the host runs as `CodePath` — `relay.sh`
   (Linux/macOS) and `relay.cmd` (Windows), both invoking `node relay.mjs`. The
   `.sh` is already marked executable in the repo; if your checkout lost the bit,
   restore it:

   ```bash
   chmod +x plugins/io.github.atomskz.deckord.sdPlugin/relay.sh
   ```

2. **If you are on Linux**, add a Linux entry to the plugin manifest — it currently
   only declares `windows` and `mac`, so OpenDeck on Linux may skip it. Edit
   [plugins/io.github.atomskz.deckord.sdPlugin/manifest.json](../plugins/io.github.atomskz.deckord.sdPlugin/manifest.json)
   and add to the `OS` array:

   ```json
   { "Platform": "linux", "MinimumVersion": "0" }
   ```

3. Copy the **whole `.sdPlugin` folder** into OpenDeck's plugins directory. The
   location depends on the OpenDeck build/OS; common ones:
   - Linux: `~/.config/opendeck/plugins/`
   - macOS: `~/Library/Application Support/opendeck/plugins/`
   - Windows: `%APPDATA%\opendeck\plugins\`

   The folder name must stay exactly `io.github.atomskz.deckord.sdPlugin`.

   ```bash
   # Linux example
   mkdir -p ~/.config/opendeck/plugins
   cp -r plugins/io.github.atomskz.deckord.sdPlugin ~/.config/opendeck/plugins/
   ```

4. Restart OpenDeck so it re-reads its plugins. If the service is running, its log
   should show `OpenDeck relay connected` once the host launches the relay.

> If OpenDeck can't launch a bare `.mjs` on your platform, point its CodePath at
> Node explicitly (or bundle a runtime). This is the "ship a runnable relay" gap —
> see [Known gaps](#known-gaps).

---

## Step 3 — Place the Deckord actions on keys

In OpenDeck's UI:

1. Find the **"Deckord"** category in the actions sidebar. It has two actions:
   - **Voice Slot** (`io.github.atomskz.deckord.slot`) — one participant per key.
   - **Status / Page** (`io.github.atomskz.deckord.status`) — channel status / page toggle.
2. **Drag "Voice Slot" onto each key** you want to show a participant. Each drop
   fires a `willAppear` and grows the deck by one slot.
3. **Drag "Status / Page" onto one key.** Pressing it cycles pages when there are
   more participants than keys.

Slots fill in **reading order** — the adapter sorts assigned keys by `(row, column)`.
As you add/remove keys, the service debounces the changes and re-renders
([DeckordService.reconfigure](../apps/deckord-service/src/DeckordService.ts)).

---

## Step 4 — Verify

You should see, on the physical keys:

- Each occupied slot showing a **participant**: avatar (or a deterministic
  identicon), name, a **green glow when they speak**, and **mute/deafen badges**.
- The status key showing the **channel name / `Page 1/N`**.
- **Pressing a Voice Slot** selects/pins that user (debug behavior — no Discord
  write); **pressing Status / Page** switches pages. Watch the service log:
  `Switched to page …` / `Selected …`.

In **mock mode** the users speak on a timer automatically. In **Discord mode**,
speak / mute / deafen in the real voice channel and watch the keys react.

If nothing paints, work down the checklist in [Troubleshooting](#troubleshooting).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Service never logs `OpenDeck relay connected` | Plugin not installed / not launched. Confirm the folder is in OpenDeck's plugins dir, `relay.mjs` is executable, and (Linux) the manifest lists `linux`. Restart OpenDeck. |
| Relay starts but errors on `WebSocket` | The launching runtime is Node < 22 (no global `WebSocket`). Ensure Node ≥ 22 is what OpenDeck uses to launch the relay. |
| Relay can't reach the service | Service not running with OpenDeck enabled, or a port mismatch. Endpoint must be `ws://127.0.0.1:8788/opendeck`; override the relay with `DECKORD_OPENDECK_URL` if you changed `DECKORD_OPENDECK_PORT`. |
| Keys stay on the default icon | No `Voice Slot` actions placed, or no voice state yet. Place actions; in mock mode users appear immediately, in Discord mode you must be joined to a voice channel. |
| Keys go stale after restarting the service | Known gap — the relay reconnects but old `willAppear` state isn't cleared. Re-drag a key or restart OpenDeck to re-emit `willAppear`. |

---

## Known gaps

These are the real-hardware items still open (roadmap Phase 7 / P1 audit backlog):

- **Not yet verified on real hardware** — the whole path is exercised only against a
  simulated relay in tests (`OpenDeckAdapter.test.ts`,
  `OpenDeckPluginTransport.test.ts`). Live launch handshake, `willAppear`
  coordinates, `setImage(data:image/png)`, and key round-trip are unproven.
- **Relay packaging** — `relay.mjs` assumes Node ≥ 22 on `PATH`; there is no shipped
  runtime or per-OS `CodePath`/launcher. On a clean machine you must provide Node.
- **Manifest OS list** omits Linux (only `windows`/`mac`), and the file is not marked
  executable in the repo — both fixed manually in Step 2.
- **Reconnect hygiene** — on a Deckord restart the relay reconnects but the adapter
  doesn't clear stale devices/contexts, so contexts/images can go stale.
- **Placeholder icons + no Property Inspector** — the action icons are placeholders
  and there's no PI showing service-connection status.
- **`OpenDeckFactory.isSupported()` always returns `true`** — selection relies on the
  opt-in env var rather than probing for a connected relay.

See the audit backlog in [roadmap.md](./roadmap.md) (P1 "OpenDeck on real hardware",
"Ship a runnable relay", "Relay reconnect hygiene") for the authoritative list.
</content>
</invoke>
