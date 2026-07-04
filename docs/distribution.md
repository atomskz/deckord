# Distribution & packaging (Phase 9)

How Deckord goes from a pnpm monorepo to something an end user installs, and the
decisions behind it.

## The shipped product

Deckord ships as a single **Electron desktop app**
([`apps/deckord-desktop`](../apps/deckord-desktop)) that:

- runs the whole Deckord service **in-process** (`ServiceRunner`) — no separate
  daemon to install or supervise;
- shows the **config UI** in a window (the debug deck, including the settings
  panel);
- lives in the **system tray** (open, restart service, launch-at-login, quit),
  with a single-instance lock and hide-to-tray;
- keeps secrets in an **OS-secured store** (`SafeStorageSecretStore`).

```
Electron main ── ServiceRunner ── DeckordService ── WsServer(127.0.0.1:8787)
      │                                                     ▲
      ├── Tray (open / restart / autostart / quit)          │ loopback WS
      └── BrowserWindow ── renderer/index.html ─────────────┘ (config UI)
```

The window and the service talk over the **loopback WebSocket** — the same channel
the browser debug deck uses. The shell therefore contains **no business logic**;
it only owns the window, tray, and OS integration.

## Configuration model

Configuration is layered, so the shipped app needs no environment variables while
still allowing dev overrides:

```
env defaults (loadConfig)  →  settings.json overlay (mergeConfig)  →  stored secrets
```

- **[`config/index.ts`](../apps/deckord-service/src/config/index.ts)** builds the
  base config from environment defaults.
- **`settings.json`** (in the data dir, `0600`) is the user's saved configuration,
  edited from the UI and applied on top (`FileSettingsStore` + `mergeConfig`).
- **Secrets** (Discord `client_secret`, OAuth token) live in a `SecretStore`
  behind the same interface: `FileSecretStore` (`0600`) for the headless service,
  `SafeStorageSecretStore` (OS-encrypted) in the desktop shell.

The UI reads/writes config live over the WS (`get_config` / `set_config` /
`connect_discord` / `restart_service`); provider/credential/port changes are
applied by a **service restart** ("restart to apply"), which `ServiceRunner` owns.

## Bring-your-own Discord app

Until the public Deckord application is approved by Discord for the `rpc` scope
(whitelist-only), **every user registers their own Discord application** and enters
its `client_id` / `client_secret` in **Settings → Discord application**. The
credentials are stored locally (secret secured), and **Connect Discord** restarts
into the Discord provider, driving the existing interactive `AUTHORIZE` → token
exchange in [`DiscordAuthenticator`](../packages/discord-rpc/src/DiscordAuthenticator.ts).

Once (if) the public app is approved, bring-your-own remains the power-user/fallback
path.

## End-user flow

1. Install Deckord (installer from `electron-builder`).
2. It starts in the tray; open the window.
3. **Settings** → paste your Discord app's Client ID + Secret → **Connect Discord**.
4. Approve the one-time consent prompt in the Discord desktop client.
5. Join a voice channel — participants appear on the deck (browser and/or a
   physical deck via the OpenDeck plugin).
6. Optionally enable **Launch at login** from the tray.

## Framework decision: Electron (for now)

Electron reuses our Node service and React UI as-is, has the most turnkey
tray/installer/updater/keychain story, and gets us to a working installer fastest.
Its cost is memory (bundled Chromium, ~100–200 MB idle).

Because the UI is **decoupled from the service over the WS**, we can later swap the
shell for a lighter native-webview one **without touching the backend**:

| Shell | Chromium? | Backend | Our Node as-is | Idle RAM | Maturity |
| --- | --- | --- | --- | --- | --- |
| **Electron** *(chosen)* | bundled | Node (main) | ✅ | ~100–200 MB | high |
| Tauri + Node sidecar | system webview | Rust + Node daemon | ✅ (sidecar) | ~30–80 MB | high |
| Wails + Node sidecar | system webview | Go + Node daemon | ✅ (sidecar) | ~30–80 MB | medium |
| Neutralino | system webview | mini + Node ext | ⚠️ | low | medium |
| webview-nodejs | system webview | Node | ✅ | low | low / DIY |

**Plan:** ship on Electron; keep **Tauri + Node sidecar** as plan B if install size
/ memory becomes a real constraint. The WS-decoupled architecture is what keeps
that option cheap.

## Physical decks (Phase 7/8)

The **AKP05 PRO** and other hardware are supported today through **OpenDeck**
(Phase 7, Variant B: a host-launched relay pipes Elgato frames to the Deckord
service). A **direct USB-HID adapter (Phase 8) is deferred** — it's a latency/
dependency optimization, not a blocker, since OpenDeck already covers the hardware.

## Remaining work (tracked in the roadmap)

- App/tray **icons**; first-run **onboarding** window.
- **Code signing** (Windows Authenticode) + **macOS notarization** so installers
  aren't flagged.
- **Auto-update** channel.
- **Discord approval** for the public application (removes the bring-your-own step
  for most users).
