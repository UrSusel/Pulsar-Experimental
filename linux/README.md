# Pulsar — port Linux

Ten folder zawiera osobny port Pulsara na Linuxa. Interfejs odtwarzacza, biblioteka, tagi, equalizer, wizualizacje, tryb mini i logika odtwarzania są współdzielone z wersją główną. Linux ma własną warstwę desktopową w `desktop.js`, bez PowerShella, WinForms i ścieżek Windows.

## Co działa w porcie Linux

- lokalne pliki audio i biblioteka,
- okładki, tagi, albumy, ulubione i kopie `.pulsarlib`,
- equalizer, normalizacja, gapless, crossfade, Auto-DJ i sleep timer,
- WebGL/2D visualizery oraz tryb mini,
- always-on-top, podstawowy tray, powiadomienia i zapamiętana geometria okna,
- wyszukiwanie, podgląd i pobieranie z YouTube przez `yt-dlp`,
- zapis pobranych plików na dysku,
- obserwowany folder — skanowanie przez przenośny polling co kilka sekund,
- OBS Browser Source z overlayem. Audio bridge OBS jest obecnie oznaczony jako funkcja Windows-only; na Linuxie można użyć audio capture OBS albo PulseAudio/PipeWire.

## Wymagania systemowe

Na dystrybucji opartej o Debian/Ubuntu:

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 curl unzip python3
sudo apt install yt-dlp ffmpeg       # zalecane, jeśli nie bundlujesz binarek
```

Nazwy pakietów WebKit mogą się różnić. Na starszym Ubuntu użyj `libwebkit2gtk-4.0-37` zamiast `libwebkit2gtk-4.1-0`.

Neutralino korzysta z WebKitGTK, więc wymagane jest działające środowisko graficzne. Port jest przeznaczony dla Linux x86_64; skrypt można później rozszerzyć o ARM64 po dostarczeniu odpowiedniej binarki Neutralino.

## Budowanie gotowego folderu

Z katalogu głównego repozytorium:

```bash
chmod +x linux/build.sh
./linux/build.sh
```

Skrypt:

1. kopiuje aktualny wspólny player do `linux/app/resources`,
2. podmienia tylko warstwę Windows na Linuxową,
3. pakuje i weryfikuje `resources.neu`,
4. pobiera oficjalną binarkę Neutralino 6.9.0 dla Linux x86_64,
5. dołącza `yt-dlp` i `ffmpeg` z folderu `linux/` lub z `PATH`,
6. tworzy `linux/dist/Pulsar-Linux-x86_64-0.09.25.tar.gz`.

Jeśli binarka Neutralino jest już pobrana, można ominąć download:

```bash
NEUTRALINO_BIN=/ścieżka/do/neutralino ./linux/build.sh
```

Uruchomienie ręczne:

```bash
cd linux/dist
./run-pulsar.sh
```

## Struktura

```text
linux/
├─ app/                    # gotowane źródła zasobów Linuxa
│  ├─ neutralino.config.json
│  └─ resources/
├─ desktop.js              # Linuxowy mostek Neutralino/POSIX
├─ build.sh                # synchronizacja i budowa paczki
└─ README.md
```

`linux/app/resources/index.html` jest kopią źródła głównego z Linuxowymi etykietami. Przy kolejnych zmianach w głównym playerze należy uruchomić `linux/build.sh`, który odświeży tę kopię automatycznie.
