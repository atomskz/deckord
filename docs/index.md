---
title: Deckord
description: Show your Discord voice channel on a macro deck.
---

**Deckord** shows the participants of your Discord voice channel on a (virtual or
physical) macro deck — one button per person, lit up when they speak and badged when
they mute or deafen. The device is the only replaceable part; everything above it —
reading Discord voice state, assigning people to slots, paginating, rendering labels
and badges — is device-agnostic.

> This is the project wiki (a work-in-progress skeleton). Source and issues:
> [github.com/atomskz/deckord](https://github.com/atomskz/deckord).

## Status

- **Phases 0–3 (MVP)** — monorepo, domain model, mock voice provider, and the browser
  debug deck all run end-to-end.
- **Phase 4 (Discord RPC)** — done, **verified against a live Discord client** (real
  participants, speaking highlight, mute/deafen badges, channel switching).
- **Phase 5 (renderer)** — avatar caching, identicon, and server-side PNG rendering
  (`@deckord/image-renderer`) for physical decks.
- **Phase 6 (adapter system)** — capability negotiation + a runtime adapter registry.
- **Next:** Phase 7 (OpenDeck adapter), Phase 8 (StreamDock / AJAZZ AKP05 PRO),
  Phase 9 (productization).

## Pipeline

```
Discord/mock → VoiceService → deck-core → renderer → deck-adapter → deck (browser or hardware)
```

The adapter is the replaceable bottom layer: `deck-core` never depends on a concrete
adapter, and an adapter never contains Discord logic. Swapping the browser deck for a
physical one is a change in one place (`DeckordService`) and nowhere else.

## Run it (mock mode, no Discord needed)

```bash
corepack enable pnpm
pnpm install
pnpm dev        # service (:8787) + debug deck (:5173)
# open http://127.0.0.1:5173
```

## Documentation

The detailed docs live in the repository (rendered on GitHub):

- [Architecture](https://github.com/atomskz/deckord/blob/main/docs/architecture.md)
- [Roadmap](https://github.com/atomskz/deckord/blob/main/docs/roadmap.md)
- [Adapter API](https://github.com/atomskz/deckord/blob/main/docs/adapter-api.md) — implementing a new deck adapter
- [Discord RPC](https://github.com/atomskz/deckord/blob/main/docs/discord-rpc.md) — the RPC/auth model
- [OpenDeck adapter decision](https://github.com/atomskz/deckord/blob/main/docs/adapters/opendeck.md)
- [Testing on Windows](https://github.com/atomskz/deckord/blob/main/docs/testing-windows.md)

## Privacy

Deckord uses only Discord's local RPC with read-only voice scopes
(`identify`, `rpc`, `rpc.voice.read`) — no user token, no self-bot, no client
modification, no message reading. It handles only voice presence, display name, and
avatar; data stays local.
