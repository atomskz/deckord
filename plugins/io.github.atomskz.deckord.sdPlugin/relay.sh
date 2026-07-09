#!/usr/bin/env sh
# Linux/macOS launcher for the Deckord OpenDeck relay.
# The host launches this wrapper, which runs the relay on Node (>= 22, for the
# global WebSocket) regardless of the .mjs executable bit or shebang resolution.
# All host args (-port -pluginUUID -registerEvent -info) are forwarded verbatim.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/relay.mjs" "$@"
