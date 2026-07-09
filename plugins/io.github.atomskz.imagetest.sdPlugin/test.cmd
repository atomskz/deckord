@echo off
rem Windows launcher for the Deckord Image Test plugin. Windows has no shebang, so
rem the host launches this wrapper, which runs the plugin on Node (>= 22, for the
rem global WebSocket). All host args (-port -pluginUUID -registerEvent -info) are
rem forwarded verbatim.
node "%~dp0test.mjs" %*
