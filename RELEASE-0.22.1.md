# Pulsar 0.22.1

Portable desktop music player for Windows and Linux. This patch release restores normal Windows startup, extends M4A/MP4 tags, and improves application updates.

## Highlights

- **Windows startup fix** — correct a JavaScript syntax error that prevented the player UI, library restore, and controls from initializing.
- **M4A/MP4 metadata** — read and write album, year, and genre alongside title, artist, and cover art; preserve untouched tags and clear fields explicitly removed in the editor.
- **Update panel** — display GitHub release notes safely as plain text and link to a platform-matched download when an asset is available.
- **Factory reset** — clear the local library, settings, playback history, and sync cache from Settings; original audio files and exported backups on disk are preserved.
- **Album artwork recovery** — refresh album covers from embedded MP3/M4A artwork first, then iTunes, Deezer, MusicBrainz/Cover Art Archive, and finally YouTube; generated album mosaics now refresh when a track's artwork is discovered.
- **Lyrics import** — import `.lrc` and `.txt` files from the track editor; imported lyrics are saved per track and restored with it.
- **PL/EN/ES localization** remains available across the updated UI.

## Downloads

- Windows 10/11 x64: `Pulsar-Desktop.zip`
- Linux x64: `Pulsar-Linux.zip`
- Checksums: `SHA256SUMS-0.22.1.txt`

Pulsar remains portable and does not install application updates automatically.
