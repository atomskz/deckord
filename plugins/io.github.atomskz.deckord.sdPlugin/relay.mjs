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

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^-/, '');
    if (key) out[key] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const HOST_URL = `ws://127.0.0.1:${args.port}`;
const DECKORD_URL = process.env.DECKORD_OPENDECK_URL ?? 'ws://127.0.0.1:8788/opendeck';

const toHost = [];
const toDeckord = [];
let host = null;
let deckord = null;

function asText(data) {
  return typeof data === 'string' ? data : data.toString();
}
function forward(target, queue, data) {
  const msg = asText(data);
  if (target && target.readyState === 1) target.send(msg);
  else queue.push(msg);
}
function flush(target, queue) {
  while (queue.length && target && target.readyState === 1) target.send(queue.shift());
}

function connectHost() {
  host = new WebSocket(HOST_URL);
  host.addEventListener('open', () => {
    // Register with the OpenDeck host, then drain anything queued for it.
    host.send(JSON.stringify({ event: args.registerEvent, uuid: args.pluginUUID }));
    flush(host, toHost);
  });
  host.addEventListener('message', (e) => forward(deckord, toDeckord, e.data));
  // If the host goes away, the plugin's job is done.
  host.addEventListener('close', () => process.exit(0));
  host.addEventListener('error', () => {});
}

function connectDeckord() {
  deckord = new WebSocket(DECKORD_URL);
  deckord.addEventListener('open', () => flush(deckord, toDeckord));
  deckord.addEventListener('message', (e) => forward(host, toHost, e.data));
  deckord.addEventListener('close', () => {
    deckord = null;
    setTimeout(connectDeckord, 2000); // Deckord service may not be running yet
  });
  deckord.addEventListener('error', () => {});
}

connectHost();
connectDeckord();
