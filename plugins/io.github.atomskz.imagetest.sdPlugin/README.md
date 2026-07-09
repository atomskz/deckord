# Deckord Image Test plugin (`io.github.atomskz.imagetest.sdPlugin`)

A **throwaway debug plugin** for reproducing OpenDeck image-persistence bugs (e.g.
[issue #152](https://github.com/nekename/OpenDeck/issues/152) and the profile
re-render clobber). It is **not** part of Deckord proper — it lives only on the
`tmp/opendeck-image-test` branch.

## Why it exists

Normal plugins (including Deckord's Voice Slot) repaint their key on `willAppear` —
which **masks** the bug, because a reconnect or profile edit re-fires `willAppear`
and the plugin immediately re-sends the image. This plugin does the opposite:

- it sets a distinctive image **only on key press** (`keyDown`) — a colored tile
  with a number that increments each press, so it is unmistakably plugin-set;
- it **never repaints on `willAppear`**.

So once you've pressed a key to set its image, anything that then reverts it to the
action's default icon is OpenDeck losing the image, not the plugin failing to repaint.

## Install

Requires **Node >= 22 on PATH** (global `WebSocket`). Copy the whole folder into
OpenDeck's plugins directory and restart OpenDeck:

- Linux: `~/.config/opendeck/plugins/`
- macOS: `~/Library/Application Support/opendeck/plugins/`
- Windows: `%APPDATA%\opendeck\plugins\`

The folder name must stay `io.github.atomskz.imagetest.sdPlugin`. On Linux/macOS make
sure `test.sh` (and `test.mjs`) are executable.

## Test procedure

Find the **Deckord Test → Static Image Test** action in the sidebar and drop it on a key.

**A. Profile re-render (the frontend bug our OpenDeck patch fixes)**
1. Press the key a few times — it shows a number on a colored tile.
2. Drop any other action onto a different empty key (or move an action).
3. Observe: without the patch the numbered key reverts to the default icon; with the
   patch it keeps the number.

**B. Device reconnect (OpenDeck issue #152)**
1. Press the key to set a number. Wait a few seconds.
2. Physically disconnect the device, then reconnect it.
3. Observe: does the key keep the number, or revert to the default icon?

Compare patched vs unpatched OpenDeck (`git stash` / `git stash pop` on the
`Key.svelte` change) to see which scenarios the patch actually affects.
