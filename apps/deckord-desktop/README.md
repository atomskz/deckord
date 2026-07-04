# deckord-desktop

The Deckord **desktop shell** (Phase 9, Electron). It packages Deckord into an
installable tray app:

- runs the whole Deckord service **in-process** via `ServiceRunner`
  (`deckord-service`), so there's no separate daemon to manage;
- shows the config UI (the built debug deck, including the **Settings → bring your
  own Discord app** panel) in a window;
- lives in the **system tray** (open, restart service, launch-at-login, quit);
- stores the Discord client secret + OAuth token in an **OS-secured** store
  (`SafeStorageSecretStore` → Windows DPAPI / macOS Keychain / libsecret), instead
  of the headless service's `0600` JSON.

## Why the shell is thin

The UI already talks to the service over the loopback WebSocket, so the shell owns
only the window, tray, and OS integration — no business logic. That keeps the door
open to swapping Electron for a lighter native-webview shell later (see
[distribution](../../docs/distribution.md)) without touching the backend.

## Status

After `pnpm install`, this app is part of the normal workspace tooling: it
**typechecks**, **lints**, and **bundles** (`build` = esbuild → `dist/main.cjs`)
like any other package. What still needs a real desktop is **launching the GUI**
(Electron requires a display) and **producing/running an installer**.

```bash
pnpm --filter deckord-desktop typecheck   # tsc against real Electron types
pnpm --filter deckord-desktop build       # esbuild-bundle the main (service inlined)
pnpm --filter deckord-desktop start       # compile + build UI + launch Electron (needs a display)
pnpm --filter deckord-desktop dist        # produce an installer (nsis/dmg/AppImage)
```

## Build pipeline

- `compile` — esbuild bundles `src/main.ts` (+ the imported service) → `dist/main.cjs`.
- `renderer` — builds the debug deck and copies its `dist/` to `./renderer`.
- `dist` — `electron-builder` packages `dist/` + `renderer/` + `assets/` using
  [`electron-builder.yml`](electron-builder.yml) (`appId: io.github.atomskz.deckord`).

## TODO (tracked in the roadmap)

- App/tray **icons** under `assets/` (`tray.png`, plus platform `icon.ico`/`.icns`).
- **Code signing / notarization** (Windows Authenticode, macOS notarization).
- **Auto-update** channel.
- First-run **onboarding** window.
- Reconnect the UI automatically when the WS host/port/token changes.
