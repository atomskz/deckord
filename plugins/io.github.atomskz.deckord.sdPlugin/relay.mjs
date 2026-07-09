#!/usr/bin/env node
/**
 * Deckord OpenDeck relay (Variant B).
 *
 * OpenDeck launches this with `-port <n> -pluginUUID <id> -registerEvent <ev> -info <json>`.
 * It is a DUMB PIPE: it connects to the OpenDeck host WS (and registers) and to the
 * Deckord service's OpenDeck endpoint, then forwards raw Elgato frames both ways.
 * ALL protocol logic lives in @deckord/adapter-opendeck inside the service.
 *
 * Requires a runtime with a global WebSocket (Node >= 22), or bundle one.
 * The Deckord endpoint defaults to ws://127.0.0.1:8788/opendeck (DECKORD_OPENDECK_URL).
 */

if (typeof WebSocket === 'undefined') {
  console.error('[deckord-relay] requires a global WebSocket (Node >= 22)');
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
      out[key] = true; // valueless flag
    }
  }
  return out;
}

function parseInfo(raw) {
  if (!raw || raw === true) return {};
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      return {};
    }
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.port || !args.pluginUUID || !args.registerEvent) {
  console.error('[deckord-relay] missing required -port / -pluginUUID / -registerEvent');
  process.exit(1);
}

const HOST_URL = `ws://127.0.0.1:${args.port}`;
const DECKORD_URL = process.env.DECKORD_OPENDECK_URL ?? 'ws://127.0.0.1:8788/opendeck';

const toHost = [];
const toDeckord = [];
let host = null;
let deckord = null;
let hostOpened = false;

function forward(target, queue, data) {
  const msg = typeof data === 'string' ? data : data.toString();
  if (target && target.readyState === 1) target.send(msg);
  else queue.push(msg);
}
function flush(target, queue) {
  while (queue.length && target && target.readyState === 1) target.send(queue.shift());
}

function connectHost() {
  host = new WebSocket(HOST_URL);
  host.addEventListener('open', () => {
    hostOpened = true;
    host.send(JSON.stringify({ event: args.registerEvent, uuid: args.pluginUUID }));
    flush(host, toHost);
  });
  host.addEventListener('message', (e) => forward(deckord, toDeckord, e.data));
  host.addEventListener('close', () => {
    if (hostOpened) process.exit(0); // host gone after a good session → job done
    else setTimeout(connectHost, 1000); // host may still be starting up
  });
  host.addEventListener('error', (e) => console.error('[deckord-relay] host ws error:', e?.message ?? e));
}

function connectDeckord() {
  deckord = new WebSocket(DECKORD_URL);
  deckord.addEventListener('open', () => {
    // Seed the service with the initial device list from the -info launch payload.
    deckord.send(JSON.stringify({ event: 'info', payload: parseInfo(args.info) }));
    flush(deckord, toDeckord);
  });
  deckord.addEventListener('message', (e) => forward(host, toHost, e.data));
  deckord.addEventListener('close', () => {
    deckord = null;
    setTimeout(connectDeckord, 2000); // Deckord service may not be running yet
  });
  deckord.addEventListener('error', (e) => console.error('[deckord-relay] deckord ws error:', e?.message ?? e));
}

connectHost();
connectDeckord();
