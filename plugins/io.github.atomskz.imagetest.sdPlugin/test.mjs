#!/usr/bin/env node
/**
 * Deckord Image Test — a standalone OpenDeck / Elgato plugin for reproducing
 * image-persistence bugs (e.g. OpenDeck issue #152).
 *
 * Unlike a normal plugin, this one:
 *   - sets a DISTINCTIVE image only on `keyDown` (a colored, numbered tile that
 *     increments on each press, so it is unmistakably plugin-set); and
 *   - deliberately does NOT repaint on `willAppear`.
 *
 * That second point is the whole idea: real plugins usually repaint on
 * (re)appearance, which masks the bug. By staying silent on `willAppear`, this
 * plugin lets you see whether OpenDeck itself keeps the image or reverts the key
 * to the action's default icon after:
 *   (a) adding/moving another action (a profile re-render), or
 *   (b) disconnecting and reconnecting the device.
 *
 * Launched by the OpenDeck host with
 *   -port <n> -pluginUUID <id> -registerEvent <ev> -info <json>
 * Requires a runtime with a global WebSocket (Node >= 22).
 */

if (typeof WebSocket === 'undefined') {
  console.error('[imagetest] requires a global WebSocket (Node >= 22)');
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('-')) continue;
    const key = token.slice(1);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.port || !args.pluginUUID || !args.registerEvent) {
  console.error('[imagetest] missing required -port / -pluginUUID / -registerEvent');
  process.exit(1);
}

/** A base64 SVG data URL: a colored tile with a big number. Base64 (not raw
 *  percent-encoding) so it round-trips cleanly through OpenDeck's on-disk
 *  externalization of data-URL images. */
function image(n) {
  const hue = (n * 47) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
    `<rect width="144" height="144" fill="hsl(${hue} 80% 45%)"/>` +
    `<text x="72" y="100" font-size="88" font-family="sans-serif" fill="white" text-anchor="middle">${n}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const counters = new Map(); // context -> number

const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ event: args.registerEvent, uuid: args.pluginUUID }));
  console.error('[imagetest] registered; press a key to set its image');
});

ws.addEventListener('message', (e) => {
  let msg;
  try {
    msg = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
  } catch {
    return;
  }
  const { event, context } = msg;
  if (event === 'keyDown' && context) {
    const n = (counters.get(context) ?? 0) + 1;
    counters.set(context, n);
    ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: image(n), target: 0 } }));
    console.error(`[imagetest] setImage ${context} -> ${n}`);
  }
  // NOTE: `willAppear` is intentionally NOT handled. We never repaint on
  // (re)appearance, so a profile edit or a device reconnect will reveal whether
  // OpenDeck retained the plugin-set image or reverted the key to its default.
});

ws.addEventListener('close', () => process.exit(0));
ws.addEventListener('error', (err) => console.error('[imagetest] ws error:', err?.message ?? err));
