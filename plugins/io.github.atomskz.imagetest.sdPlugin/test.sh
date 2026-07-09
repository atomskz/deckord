#!/usr/bin/env sh
# Linux/macOS launcher for the Deckord Image Test plugin. Runs the plugin on Node
# (>= 22, for the global WebSocket) regardless of the .mjs executable bit or shebang
# resolution. All host args (-port -pluginUUID -registerEvent -info) are forwarded.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/test.mjs" "$@"
