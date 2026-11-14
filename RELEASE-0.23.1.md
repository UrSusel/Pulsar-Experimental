# Pulsar 0.23.1

A focused visualizer update for Pulsar on Windows and Linux. This release expands the Retro-only 3D background collection and improves the motion, audio response, and presentation of its scenes.

## Highlights

- **Four Retro-only 3D scenes** — choose Vector Grid, Retro Plasma, Retro Oscilloscope, or Neon Sunset while using Pulsar Classic or Compact Retro. Standard visualizer styles remain separate and are restored when leaving Retro.
- **Vector Grid improvements** — restore smoothly travelling, locally varied surface waves while fading distant lines to prevent horizon flicker.
- **Neon Sunset enhancements** — add layered mountain silhouettes, a gently drifting sun behind the foreground ridge, softly glowing cloud edges, twinkling stars, rare glitch accents, and a rippling reflection across the grid that responds to bass and beats.
- **A livelier Retro Oscilloscope** — stronger waveform motion, local frequency-driven peaks, a subtle phosphor-style echo, and separated left/right traces when the audio contains distinguishable stereo channels. Mono audio continues to use a single trace.
- **Consistent desktop builds** — the Retro backgrounds and visualizer behavior are aligned across Windows and Linux.

## Downloads

- **Windows 10/11 x64:** `Pulsar-Desktop.zip` — unpack and run `pulsar.exe`.
- **Linux x64:** `Pulsar-Linux.zip` — unpack and run `chmod +x pulsar && ./pulsar`.
- **SHA-256 checksums:** `SHA256SUMS-0.23.1.txt`.

Both builds are portable. Linux requires WebKitGTK and suitable GStreamer audio codecs; see the included Linux README for distribution-specific package names. FFmpeg is optional. Windows SmartScreen may ask for confirmation because the executable is not code-signed.

Pulsar checks for new stable releases but never downloads or installs application updates automatically.
