# Pulsar 0.23.0

A major feature release of Pulsar, the portable music player for Windows and Linux. This update brings the open-source desktop source tree, a redesigned retro player, substantial improvements to lyrics and audio editing, safer library management, and more reliable cross-device library sync.

## Highlights

- **Compact Retro player** — choose the new compact, classic-player layout or keep Pulsar Classic. The retro UI includes five coordinated themes, compact playback controls, a centered volume slider, and a persistent playlist/library panel. The compact layout uses neutral Pulsar branding.
- **Word-synced lyrics** — enhanced LRC and LRCLIB word timings are supported, with a multi-source Lyrics+ fallback when only line-synced lyrics are available. Words highlight progressively over their real duration; ordinary line highlighting remains the fallback.
- **Lyrics tools** — shift lyrics per track, export adjusted LRC, and remap timing when audio is edited. The optional experimental local AI aligner can manually align existing lyrics against local audio; it runs on CPU, asks before installing its dependencies/model, and keeps the original lyrics recoverable.
- **Audio Editor 2.0** — finer cut boundaries, deeper waveform zoom, adjustable silence detection, fades, resumable editing sessions, and non-destructive export. FFmpeg enables MP3/FLAC export and memory-safe editing of long recordings; WAV editing remains available without it.
- **Auto-DJ 2.0** — selectable listening moods, “more like this,” artist/genre diversity controls, explanations for picks, and undoable selection history.
- **Automatic backups and safety snapshots** — scheduled, rotated `.pulsarlib` backups plus safeguards before restores and large library changes, and warnings before deleting a track whose only local copy is in the library.
- **Cross-device library improvements** — synchronize library metadata through a folder shared by Google Drive across desktop and Android. Audio files and local paths are never uploaded. Cloud-only tracks can be found and downloaded on the current device.
- **Metadata and artwork** — broader embedded-cover recovery and M4A/MP4 tag support, including title, artist, album, year, genre, and cover art; unchanged tags are preserved when editing.
- **Release updates in the app** — check GitHub Releases, read release notes, and open a platform-matched download link. Pulsar does not install application updates automatically.
- **Open-source and documentation** — readable desktop source, build/test instructions, privacy information, and third-party license notices are included in the repository.

## Downloads

- **Windows 10/11 x64:** `Pulsar-Desktop.zip` — unpack and run `pulsar.exe`.
- **Linux x64:** `Pulsar-Linux.zip` — unpack and run `chmod +x pulsar && ./pulsar`.
- **SHA-256 checksums:** `SHA256SUMS-0.23.0.txt`.

Both builds are portable. Linux requires WebKitGTK and suitable GStreamer audio codecs; see the included Linux README for distribution-specific package names. FFmpeg is optional. Windows SmartScreen may ask for confirmation because the executable is not code-signed.

Pulsar checks for new stable releases but never downloads or installs application updates automatically. You can also use the project website and the included README for setup and troubleshooting.
