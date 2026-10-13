# Pulsar for Android — experimental port

This is a separate Android project; it does not change the Windows or Linux app folders.

## Current milestone

- Loads the packed Pulsar web runtime inside a Capacitor Android shell.
- Keeps the existing player UI and browser-based playback/library logic.
- Changes the desktop folder picker into Android's multi-file audio picker.
- Hides desktop-only controls, while keeping the network-library view available on Android. YouTube search/import uses the existing public-provider fallbacks; saved audio is added to the in-app library. Provider availability and WebView stream downloads still need on-device verification.
- Adds Android safe-area handling for settings and dialogs, plus a compact three-row mobile control bar that retains the track text and transport controls.
- Adds an Android media-playback foreground service, `MediaSession`, media notification, lock-screen/notification transport controls, and a partial wake lock while audio is playing. Controls are wired back to the existing WebView player; notification permission is requested on first playback where Android requires it.
- Extracted web assets are generated locally from `../Pulsar-Linux/resources.neu` into the ignored `www/` folder; do not commit `www/` or unpacked app HTML/JS.

**Not release-ready yet:** The native playback path and Android YouTube import have not been built or tested on a device. Online YouTube providers may block requests or individual videos; Android does not run the desktop yt-dlp bridge and does not export MP3 files to a user-selected device folder. Verify screen-off playback, notification permission denial, media buttons, seeking, service/process lifecycle, network search/import, and Android-version compatibility before relying on it. A native Android mini-player is still not implemented.

## Build

Requirements: Node.js 22+/npm, Python 3, Android Studio with Android SDK 36, and JDK 21+.

```bash
npm ci
npm run android:sync
npm run android:open
# or, with an emulator/device connected:
npm run android:run
```

The Capacitor `android/` project is included in this folder. Use Android Studio to build/run on an emulator or device. After changing the packed runtime, run `npm run android:sync` again to regenerate and copy the web assets.

The build deliberately reads the existing packed runtime instead of checking in unpacked player sources. The generated `www/` tree is disposable and ignored by Git.
