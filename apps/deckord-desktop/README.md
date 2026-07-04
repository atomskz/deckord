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

## Status: scaffold

This app **cannot be built or run in the headless CI sandbox** (no display, no
Electron binary). It is intentionally excluded from the root `build` / `typecheck`
/ `lint` scripts. To work on it locally:

```bash
pnpm install                              # pulls electron, electron-builder, esbuild
pnpm --filter deckord-desktop exec tsc --noEmit -p tsconfig.json   # typecheck
pnpm --filter deckord-desktop start       # compile + build UI + launch Electron
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
