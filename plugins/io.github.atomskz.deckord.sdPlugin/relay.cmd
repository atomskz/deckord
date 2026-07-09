@echo off
rem Windows launcher for the Deckord OpenDeck relay.
rem Windows has no shebang, so the host launches this wrapper, which runs the
rem relay on Node (>= 22, for the global WebSocket). All host args
rem (-port -pluginUUID -registerEvent -info) are forwarded verbatim.
node "%~dp0relay.mjs" %*
