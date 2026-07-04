# Testing Deckord on Windows

Deckord's target platform is Windows. This guide covers testing it there — first in
**mock mode** (no Discord, no hardware), then against a **real Discord desktop client**
(roadmap task 4.8).

All commands are shown for **PowerShell** (the default in Windows Terminal). `cmd.exe`
equivalents are noted where they differ.

---

## 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 (LTS 20/22/24) | `winget install OpenJS.NodeJS.LTS` — or from <https://nodejs.org> |
| pnpm | 10.x | via Corepack (ships with Node) — see below |
| Git | any | `winget install Git.Git` |
| Discord | desktop app | only for the real-client test (§6) — the **native** app, not the browser |

Enable pnpm through Corepack:

```powershell
corepack enable pnpm
corepack prepare pnpm@10.13.1 --activate
pnpm --version   # -> 10.13.1
```

> If `corepack enable` fails with a permission error (it tries to write shims into the
> Node install dir), either run the terminal **as Administrator** once, or install pnpm
> standalone: `iwr https://get.pnpm.io/install.ps1 -useb | iex` (then reopen the terminal).

---

## 2. Get the code

```powershell
git clone git@github.com:atomskz/deckord.git   # SSH (needs a GitHub key)
# or over HTTPS:
git clone https://github.com/atomskz/deckord.git
cd deckord
```

---

## 3. Install dependencies

```powershell
pnpm install
```

No build step is required for local dev: the workspace packages are consumed straight
from their TypeScript source (`tsx` for the service, Vite for the UI).

> **PowerShell execution policy.** If `pnpm` refuses to run with a "running scripts is
> disabled" error, allow local scripts for your user once:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (answer `Y`).

---

## 4. Run in mock mode (default — start here)

```powershell
pnpm dev
```

This starts **both** processes concurrently:

- **service** → WebSocket API on `ws://127.0.0.1:8787/deck`
- **debug deck** → `http://127.0.0.1:5173`

Open **<http://127.0.0.1:5173>** in a browser. Stop everything with **Ctrl+C**.

> If Windows Defender Firewall prompts on first run, you can dismiss/deny it — the API
> binds to loopback (`127.0.0.1`) only and needs no external access.

### What to verify (mock acceptance checklist)

1. A **2×5 grid** of 10 buttons renders.
2. **5 mock users** appear on the first 9 slots with names + colored initials placeholders.
3. The **last slot** is a status/page slot.
4. Users randomly light up with a green **speaking** glow.
5. Use the **mock controls** panel on the right:
   - *Toggle mute* / *Toggle deafen* → red **M** / amber **D** badges appear.
   - *Add user* six times → the last slot flips to a **page** indicator (`1/2`); click it to page.
   - *Random speaking*, *Stop mock*, *Reset channel* behave as labeled.
6. The **event log** streams changes; the header shows `provider: mock`, `service: open`.

### Run only one side (optional)

```powershell
pnpm dev:service       # service only  (tsx watch, auto-reloads on edits)
pnpm dev:debug-deck    # UI only
```

---

## 5. Quality checks

```powershell
pnpm test         # unit tests (Vitest)
pnpm typecheck    # production TypeScript typecheck
pnpm test:types   # typecheck the test files
pnpm lint         # ESLint
pnpm build        # typecheck all packages + build the UI bundle
```

---

## 6. Testing against a real Discord client (task 4.8)

### 6.1 One-time Discord application setup

In the [Discord Developer Portal](https://discord.com/developers/applications) for your
app:

1. **General Information** → copy the **Application ID** → this is `DISCORD_CLIENT_ID`.
2. **OAuth2** → **Reset Secret** → copy the **Client Secret** → this is `DISCORD_CLIENT_SECRET`.
3. **OAuth2 → Redirects** → **Add Redirect** → exactly `http://127.0.0.1/callback` → **Save Changes**.
4. Do **not** create a bot and do **not** set up a public install link — Deckord uses RPC
   `AUTHORIZE` directly. As the **app owner** you can authorize the whitelist-only `rpc`
   scope on your own account without Discord approval.

Deckord requests only the read-only scopes `identify`, `rpc`, `rpc.voice.read`
(never `rpc.voice.write`).

### 6.2 Preconditions

- The **Discord desktop app is running** (it exposes the local
  `\\?\pipe\discord-ipc-0..9` named pipe the service connects to — the browser version
  does not).
- You are **joined to a voice channel** (otherwise you'll see `NO_SELECTED_VOICE_CHANNEL`).

### 6.3 Run

PowerShell — set the two variables for the session, then start the service:

```powershell
$env:DISCORD_CLIENT_ID     = "your_application_id"
$env:DISCORD_CLIENT_SECRET = "your_client_secret"
$env:DECKORD_LOG_LEVEL     = "debug"
pnpm dev            # service + browser deck
```

`cmd.exe` equivalent:

```cmd
set DISCORD_CLIENT_ID=your_application_id
set DISCORD_CLIENT_SECRET=your_client_secret
set DECKORD_LOG_LEVEL=debug
pnpm dev
```

`DECKORD_PROVIDER` defaults to `auto`, which selects Discord RPC as soon as a client id
+ secret are present. (Set `$env:DECKORD_PROVIDER = "discord-rpc"` to force it.)

### 6.4 What happens

1. The service connects over IPC and issues `AUTHORIZE`.
2. A **consent dialog appears inside the Discord desktop app** — click **Authorize** (once).
3. The code is exchanged for a token, cached at
   **`%USERPROFILE%\.deckord\discord-token.json`** (subsequent runs skip the dialog and
   refresh the token automatically). Override the location with `DECKORD_TOKEN_PATH`.
4. The debug deck now shows the **real participants** of your voice channel, with live
   speaking highlight and mute/deafen badges.

### 6.5 Fast path — skip OAuth with a pre-obtained token

If you already have an access token with the scopes above:

```powershell
$env:DISCORD_CLIENT_ID    = "your_application_id"
$env:DISCORD_ACCESS_TOKEN = "your_access_token"
pnpm dev
```

---

## 7. Environment variables (reference)

Set in the shell before running (the service reads `process.env`; it does **not** read
`.env` files). Vite `VITE_*` variables may also go in `apps/deckord-debug-deck/.env.local`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DECKORD_PROVIDER` | `auto` | `auto` \| `mock` \| `discord-rpc` |
| `DECKORD_WS_HOST` / `DECKORD_WS_PORT` / `DECKORD_WS_PATH` | `127.0.0.1` / `8787` / `/deck` | Local WebSocket API |
| `DECKORD_WS_TOKEN` | *(none)* | Optional shared token for the WS API |
| `DECKORD_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DECKORD_MOCK_USERS` / `DECKORD_MOCK_SPEAKING_MS` / `DECKORD_MOCK_AUTOSTART` | `5` / `1600` / `true` | Mock tuning |
| `DISCORD_CLIENT_ID` | *(none)* | Application ID |
| `DISCORD_CLIENT_SECRET` | *(none)* | Enables interactive `AUTHORIZE` + refresh (local service only) |
| `DISCORD_ACCESS_TOKEN` | *(none)* | Pre-obtained token (fast path) |
| `DISCORD_REDIRECT_URI` | `http://127.0.0.1/callback` | Must match a registered redirect |
| `DECKORD_TOKEN_PATH` | `%USERPROFILE%\.deckord\discord-token.json` | Where the token is cached |
| `DECKORD_DATA_DIR` | `%USERPROFILE%\.deckord` | Base data dir |

> Tip: `$env:X = "y"` in PowerShell lasts for the current shell session. Clear one with
> `Remove-Item Env:X`, or just open a fresh terminal.

---

## 8. Troubleshooting (Windows)

| Symptom | Cause / fix |
|---------|-------------|
| `pnpm` not found | Run `corepack enable pnpm`; reopen the terminal. |
| "running scripts is disabled" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| `corepack enable` → EPERM | Run the terminal as Administrator once, or use the standalone pnpm installer. |
| UI shows "Waiting for service…" / `service: closed` | The service isn't up (or crashed). It reconnects automatically once you start it. |
| `EADDRINUSE :8787` or `:5173` | Port busy. Set `$env:DECKORD_WS_PORT="8799"` (+ `$env:VITE_WS_URL="ws://127.0.0.1:8799/deck"` for the UI), or free the port. |
| Discord test always falls back to mock | Check the `DECKORD_LOG_LEVEL=debug` log: `DISCORD_IPC_NOT_FOUND` (desktop app not running), `DISCORD_AUTH_FAILED` (bad secret / redirect mismatch), or `NO_SELECTED_VOICE_CHANNEL` (join a voice channel). |
| No consent dialog appears | You're running the **browser** Discord, not the desktop app. |
| `invalid redirect_uri` during token exchange | The redirect in the portal must equal `DISCORD_REDIRECT_URI` (default `http://127.0.0.1/callback`). |
| `git clone` over SSH fails | Add a GitHub SSH key, or clone over HTTPS. |

---

## 9. Success criteria

- **Mock:** `pnpm dev` opens a working 2×5 deck at `http://127.0.0.1:5173` with speaking
  highlight, mute/deafen badges, pagination, and a live event log — no Discord needed.
- **Real client:** with the Discord desktop app running and you in a voice channel,
  Deckord authorizes once and mirrors the channel's real participants and their
  speaking/mute/deafen state onto the deck.
