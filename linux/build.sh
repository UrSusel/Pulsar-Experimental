#!/usr/bin/env bash
# Build a portable Pulsar Linux bundle from the repository checkout.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINUX="$ROOT/linux"
APP="$LINUX/app"
DIST="$LINUX/dist"
VERSION="${PULSAR_VERSION:-0.09.25}"
NEU_VERSION="${NEU_VERSION:-6.9.0}"

command -v python3 >/dev/null || { echo "Brak python3" >&2; exit 1; }
command -v tar >/dev/null || { echo "Brak tar" >&2; exit 1; }

# Synchronise the shared player while keeping the Linux desktop bridge separate.
rm -rf "$APP/resources"
mkdir -p "$APP/resources"
cp -a "$ROOT/app/resources/." "$APP/resources/"
rm -rf "$APP/resources/tray" "$APP/resources/tray-icon.png"
cp "$LINUX/desktop.js" "$APP/resources/desktop.js"
# The Linux config already lives at $APP/neutralino.config.json; do not copy it onto itself.

# The shared page has a Windows-labelled desktop pane.  The Linux port uses the
# same feature set, but presents it as Linux and does not mention WinForms.
python3 - "$APP/resources/index.html" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('<span>Windows</span>', '<span>Linux</span>')
s = s.replace('<h2 class="sm-pane-title">Windows</h2>', '<h2 class="sm-pane-title">Linux</h2>')
s = s.replace('Panel zasobnika w stylu Pulsara', 'Panel zasobnika Pulsara')
s = s.replace('Ikona w zasobniku otwiera ciemny panel z okładką i przyciskami zamiast zwykłego menu Windows', 'Ikona w zasobniku otwiera menu Pulsara z okładką i przyciskami')
p.write_text(s)
PY

mkdir -p "$DIST"
python3 "$ROOT/tools/neu.py" pack "$APP" "$DIST/resources.neu"
python3 "$ROOT/tools/neu.py" verify "$DIST/resources.neu"

TMP="$(mktemp -d)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

# Use a supplied Neutralino binary when possible. Otherwise download the official
# release archive and locate the x86_64 Linux client inside it.
NEU_BIN="${NEUTRALINO_BIN:-}"
if [[ -z "$NEU_BIN" ]]; then
  if [[ -x "$LINUX/neutralino" ]]; then
    NEU_BIN="$LINUX/neutralino"
  else
    command -v curl >/dev/null || { echo "Brak curl — ustaw NEUTRALINO_BIN ręcznie" >&2; exit 1; }
    command -v unzip >/dev/null || { echo "Brak unzip — ustaw NEUTRALINO_BIN ręcznie" >&2; exit 1; }
    curl -fL "https://github.com/neutralinojs/neutralinojs/releases/download/v${NEU_VERSION}/neutralinojs-v${NEU_VERSION}.zip" -o "$TMP/neutralino.zip"
    unzip -q "$TMP/neutralino.zip" -d "$TMP/neutralino"
    NEU_BIN="$(find "$TMP/neutralino" -type f \( -name 'neutralino-linux_x64' -o -name 'neutralinojs-linux_x64' -o -name 'neutralino' \) -print -quit)"
    [[ -n "$NEU_BIN" ]] || { echo "Nie znaleziono binarki Neutralino Linux w archiwum" >&2; exit 1; }
  fi
fi

cp "$NEU_BIN" "$DIST/pulsar"
chmod +x "$DIST/pulsar"

# yt-dlp and ffmpeg are optional at build time.  The app also accepts system
# installations from PATH, but bundling them makes the result portable.
if [[ -f "$LINUX/yt-dlp" ]]; then cp "$LINUX/yt-dlp" "$DIST/yt-dlp"; chmod +x "$DIST/yt-dlp";
elif command -v yt-dlp >/dev/null 2>&1; then cp "$(command -v yt-dlp)" "$DIST/yt-dlp"; chmod +x "$DIST/yt-dlp";
else echo "Uwaga: yt-dlp nie dołączono; aplikacja użyje yt-dlp z PATH." >&2; fi
if [[ -f "$LINUX/ffmpeg" ]]; then cp "$LINUX/ffmpeg" "$DIST/ffmpeg"; chmod +x "$DIST/ffmpeg";
elif command -v ffmpeg >/dev/null 2>&1; then cp "$(command -v ffmpeg)" "$DIST/ffmpeg"; chmod +x "$DIST/ffmpeg";
else echo "Uwaga: ffmpeg nie dołączono; MP3 i część formatów będą ograniczone." >&2; fi

cat > "$DIST/run-pulsar.sh" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec ./pulsar "$@"
SH
chmod +x "$DIST/run-pulsar.sh"

ARCHIVE="$DIST/Pulsar-Linux-x86_64-${VERSION}.tar.gz"
tar -czf "$ARCHIVE" -C "$DIST" pulsar resources.neu run-pulsar.sh yt-dlp ffmpeg 2>/dev/null || \
tar -czf "$ARCHIVE" -C "$DIST" pulsar resources.neu run-pulsar.sh

echo "Gotowe: $ARCHIVE"
