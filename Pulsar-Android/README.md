# Pulsar for Android — experimental port

This is a separate Android project; it does not change the Windows or Linux app folders.

## Current milestone

- Loads the packed Pulsar web runtime inside a Capacitor Android shell.
- Keeps the existing player UI and browser-based playback/library logic.
- Changes the desktop folder picker into Android's multi-file audio picker.
- Hides desktop-only controls and the network-download view until Android implementations exist.
- Extracted web assets are generated locally from `../Pulsar-Linux/resources.neu` into the ignored `www/` folder; do not commit `www/` or unpacked app HTML/JS.

**Not release-ready yet:** YouTube/yt-dlp downloads, screen-off/background playback, Android media notification/lock-screen controls, and a native Android mini-player are not implemented. Test file picking, playback, IndexedDB persistence, and WebView audio behavior on a real device before relying on it.

## Build

Requirements: Node.js 22+/npm, Python 3, Android Studio with Android SDK 36, and JDK 17+.

```bash
npm ci
npm run android:sync
npm run android:open
# or, with an emulator/device connected:
npm run android:run
```

The Capacitor `android/` project is included in this folder. Use Android Studio to build/run on an emulator or device. After changing the packed runtime, run `npm run android:sync` again to regenerate and copy the web assets.

The build deliberately reads the existing packed runtime instead of checking in unpacked player sources. The generated `www/` tree is disposable and ignored by Git.
