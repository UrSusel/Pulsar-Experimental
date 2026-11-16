# Pulsar 0.23.2

## Highlights

- **Faster Discord Rich Presence track changes** — track-selection events now update the local Discord IPC presence immediately rather than waiting through the previous 500 ms debounce. Other playback-state refreshes remain coalesced, and periodic refresh remains a fallback.
- **Version metadata** — align the desktop app metadata, window title, website build labels, and update-check fixtures with version 0.23.2.

## Notes

Discord Rich Presence remains opt-in and uses the Discord desktop client's local IPC connection. No bot, Discord token, or per-user Application ID setup is introduced. Actual end-to-end timing depends on the desktop runtime and Discord; verify against the running app.

## Downloads

- Windows 10/11 x64: `Pulsar-Desktop.zip`
- Linux x64: `Pulsar-Linux.zip`
