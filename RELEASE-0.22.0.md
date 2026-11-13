# Pulsar 0.22.0

Portable desktop music player for Windows and Linux. This release improves folder selection in Downloads, aligns the desktop download tools across both platforms, and updates the app version to 0.22.0.

## Highlights

- **Native folder selection in Downloads** — choose both the library destination and the optional on-disk copy location from the system folder picker instead of typing a path.
- **Linux/Windows download parity** — Linux now has the manual and daily yt-dlp updater, plus one automatic update-and-retry attempt after a failed download. Downloaded audio formats and embedded M4A/MP4 title, artist, album, year, genre and artwork handling are aligned.
- **Clearer folder settings** — the library destination and the optional disk-copy location are separate controls.
- **Lyrics import** — import `.lrc` or `.txt` files from the dedicated Lyrics tab in the full track editor. Imported lyrics are saved per track and restored with it.
- **Embedded M4A/MP4 artwork** — Pulsar can read cover art embedded in an audio file and use it as the track artwork when no separate cover is set.
- **Startup update notice** — Pulsar checks GitHub Releases whenever it starts and shows an in-app notice when a newer version is found. The update panel includes the release notes and a platform-specific download link when an asset is published. It never installs updates automatically; checks are retried every 12 hours while the app remains open.
- **PL/EN/ES localization** for the new folder-picker prompts and explanations.

## Download

- **Windows 10/11 x64:** `Pulsar-Desktop.zip` — unpack it and run `pulsar.exe`.
- **Linux x64:** `Pulsar-Linux.zip` — unpack it, then run `chmod +x pulsar yt-dlp && ./pulsar` from the extracted folder.
- **Integrity:** `SHA256SUMS-0.22.0.txt` contains SHA-256 hashes for both archives.

Both packages are portable and include `yt-dlp`. Windows SmartScreen may ask for confirmation because the executable is not code-signed. Linux requires WebKitGTK and the usual GStreamer audio codecs; see the included Linux README for distribution-specific commands. FFmpeg remains optional for MP3/FLAC export and very large recordings. Experimental AI alignment is optional and requires Python 3.10+ plus a one-time package/model download.

Pulsar checks `UrSusel/Pulsar-Desktop/releases/latest` for stable application updates. It never downloads or installs application updates automatically.
