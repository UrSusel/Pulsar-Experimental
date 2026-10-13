# Pulsar — Linux

Everything in this folder is self-contained. No installer needed.

| File | Purpose |
|---|---|
| `pulsar` | Application executable (Linux x86_64) |
| `resources.neu` | The packaged app (UI, visualizers, Linux bridge) |
| `yt-dlp` | Bundled YouTube search/downloader |

## Run it

```bash
cd Pulsar-Linux
chmod +x pulsar yt-dlp
./pulsar
```

## One-time system prerequisites

The app uses your system's web engine (WebKitGTK), like any other Linux desktop app:

```bash
# Arch / CachyOS
sudo pacman -S gtk3 webkit2gtk-4.1

# Debian / Ubuntu
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0

# Fedora
sudo dnf install gtk3 webkit2gtk4.1
```

`yt-dlp` runs on the bundled copy and only needs `python3`, which every desktop distro already has.

## Optional: MP3 export

Converting downloads to MP3 uses `ffmpeg` (auto-detected from your system or from this folder).
Everything else — playback, downloads, covers, tags, library — works without it.

```bash
sudo pacman -S ffmpeg     # or place an ffmpeg binary in this folder
```

## Cloud library (Google Drive)

The app can keep your library — titles, artists, favourites, play counts, albums — in a folder
that Google Drive syncs, so Windows, Linux and the Android app all share one library. Only that
metadata travels; the audio files stay on each device.

1. Sync a folder with Drive using whatever you already run — `rclone` (`rclone mount`, or
   `rclone bisync` on a timer), Insync, or a Files/overlay integration. The app does not care
   how the folder gets to the cloud, only that it does.
2. In Pulsar: **Settings → Cloud → Choose folder** and pick that folder. This is a one-time
   step per machine; the app remembers it.
3. Leave **Sync automatically** on. **Sync now** forces a sync on demand, and the panel shows
   when the last one happened.

Signing in with a Google account inside the app is Android-only (Google no longer allows the
desktop flow), so the desktop panel asks for the folder instead — no account setup, no OAuth
screen, no Google Cloud project.

Two things worth knowing: the other device must pick the same folder, and it sees changes only
after its Drive client has downloaded `pulsar-library.json`, so this is not instant.

## Troubleshooting

- **No sound** (the usual one): WebKitGTK decodes MP3/AAC through GStreamer codecs that minimal
  installs skip. Add them: `sudo pacman -S gst-libav gst-plugins-ugly gst-plugins-good`
  (Debian/Ubuntu: `sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-ugly gstreamer1.0-plugins-good`).
  Verify outside the app with `gst-play-1.0 some-track.mp3`.
- **Black or blank window** (usually NVIDIA + Wayland):
  `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./pulsar` or `WEBKIT_DISABLE_COMPOSITING_MODE=1 ./pulsar`
- **No tray icon on GNOME**: enable an AppIndicator/TopIcons extension (app still works without it).
- **Library and settings** are saved automatically in your user profile; nothing is written into this folder except cached audio.
