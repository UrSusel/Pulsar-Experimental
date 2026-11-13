# Pulsar 0.21.0

Portable desktop music player for Windows and Linux. This release adds application update checks and brings together the new lyrics, editing, Auto-DJ and library-safety improvements.

## Highlights

- **Open source under Apache-2.0** — the complete readable core and extension sources are included in `Pulsar-Experimental`, with a deterministic desktop source build and third-party license notices in both downloadable archives.
- **Pulsar update checks** — the installed version is compared with the latest stable GitHub Release automatically (at most once every 12 hours) or manually in **Settings → Downloads → Pulsar**. A newer release shows a download link. Pulsar never downloads or installs an application update by itself.
- **Word-synced lyrics in the regular lyrics panel** — enhanced LRC/LRCLIB word timing and the Lyrics+ fallback gradually fill the current word over its real duration. There is no separate karaoke overlay and no moving progress line. Standard line highlighting remains when word timing is unavailable.
- **Experimental local AI alignment** — manually align existing lyrics to the actual recording on Windows/Linux. Includes candidate review, A/B comparison, selected-range alignment, first-word offset calibration and an explicit, restorable replacement of source word timing for music-video/studio-version mismatches. Audio and text are processed locally after the optional Python/model setup.
- **Audio Editor 2.0** — precise 1 ms cut boundaries, 32× waveform zoom, configurable silence detection, fades, resumable sessions, non-destructive WAV export, optional MP3/FLAC export and memory-safe editing of long recordings.
- **Auto-DJ 2.0** — listening moods, “more like this”, artist/genre diversity, undoable DJ history and a short explanation for each pick.
- **Safer automatic backups** — scheduled `.pulsarlib` copies, rotation, safety snapshots before restore or major library changes and an additional warning before deleting a track whose only file is inside the library.
- **AI setup fixes** — repair an incomplete virtual environment without pip and keep PyAV within the range compatible with the pinned Faster-Whisper version.
- **Complete PL/EN/ES localization for the new features** — editor, AI, Auto-DJ, backups and update checks follow the selected interface language immediately, including dynamic status messages and native error descriptions.

## Download

- **Windows 10/11 x64:** `Pulsar-Desktop.zip` — unpack it and run `pulsar.exe`.
- **Linux x64:** `Pulsar-Linux.zip` — unpack it, then run `chmod +x pulsar yt-dlp && ./pulsar` from the extracted folder.
- **Integrity:** `SHA256SUMS-0.21.0.txt` contains SHA-256 hashes for both archives.

Both packages are portable and include `yt-dlp`. Windows SmartScreen may ask for confirmation because the executable is not code-signed. Linux requires WebKitGTK and the usual GStreamer audio codecs; see the included Linux README for distribution-specific commands. FFmpeg remains optional for MP3/FLAC export and very large recordings. Experimental AI alignment is optional and requires Python 3.10+ plus a one-time package/model download.

## Update-check behavior

Pulsar checks `UrSusel/Pulsar-Desktop/releases/latest`. Releases intended for this channel must be published as stable releases with a Semantic Version tag such as `v0.21.0`; a Git tag alone, a draft or a nonnumeric tag is not treated as a valid newer version. Automatic application-update checks can be disabled independently of `yt-dlp` updates.
