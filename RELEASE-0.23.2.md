# Pulsar 0.23.2

## Highlights

- **Better handling of Apple/macOS files** — AppleDouble sidecars (`._*`) and `__MACOSX` archive entries are skipped when importing audio or scanning watched folders, so metadata sidecars are not mistaken for playable tracks. Previously saved sidecars are hidden when restoring the library without deleting stored data; Pulsar explains when the original audio files need to be added.
- **Discord Rich Presence** — add an opt-in way to show the current track and artist in the Discord desktop app. It uses local IPC (no bot or Discord token), follows track changes without the previous 500 ms debounce, and accounts for playback across a crossfade.

## Notes

Rich Presence remains optional and requires the Discord desktop client to be running. End-to-end update timing depends on the desktop runtime and Discord, so verify it in the running app.

## Downloads

- Windows 10/11 x64: `Pulsar-Desktop.zip`
- Linux x64: `Pulsar-Linux.zip`
