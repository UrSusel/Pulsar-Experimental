#!/usr/bin/env python3
"""Prepare Capacitor web assets from the packed Pulsar runtime.

The checked-in app remains closed-source: only the existing resources.neu
runtime archive is read. Extracted HTML/JS is generated into ignored www/ and
is never meant to be committed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
import sys
from pathlib import Path

ANDROID_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ANDROID_DIR.parent / "Pulsar-Linux" / "resources.neu"
DEFAULT_OUT = ANDROID_DIR / "www"
REQUIRED_RESOURCES = {"index.html", "tags.js"}


def archive_files(section: dict, prefix: str = ""):
    for name, meta in section.items():
        rel = f"{prefix}{name}"
        if "files" in meta:
            yield from archive_files(meta["files"], rel + "/")
        else:
            yield rel, meta


def read_archive(path: Path):
    data = path.read_bytes()
    if len(data) < 16:
        raise ValueError("resources.neu is too small to be a valid archive")
    outer_marker, header_size, inner_size, json_size = struct.unpack("<4I", data[:16])
    if outer_marker != 4 or inner_size > header_size or json_size > inner_size - 4:
        raise ValueError("unrecognised resources.neu header")
    header_raw = data[16:16 + json_size]
    header = json.loads(header_raw.decode("utf-8"))
    if not isinstance(header, dict) or "files" not in header:
        raise ValueError("resources.neu has no file table")
    base = 8 + header_size
    if base > len(data):
        raise ValueError("resources.neu header extends beyond the archive")
    return data, header, base


def extract_resource(data: bytes, base: int, meta: dict) -> bytes:
    size = int(meta["size"])
    offset = int(meta["offset"])
    start, end = base + offset, base + offset + size
    if offset < 0 or size < 0 or end > len(data):
        raise ValueError("invalid file offset in resources.neu")
    blob = data[start:end]
    integrity = meta.get("integrity", {})
    expected_hash = integrity.get("hash")
    if expected_hash and hashlib.sha256(blob).hexdigest() != expected_hash:
        raise ValueError("SHA-256 mismatch in resources.neu")
    blocks = integrity.get("blocks") or []
    block_size = int(integrity.get("blockSize") or 0)
    if blocks and block_size > 0:
        actual = [hashlib.sha256(blob[i:i + block_size]).hexdigest()
                  for i in range(0, len(blob), block_size)]
        if actual != blocks:
            raise ValueError("block-integrity mismatch in resources.neu")
    return blob


def build(archive: Path, out_dir: Path, bridge: Path) -> None:
    data, header, base = read_archive(archive)
    selected = {}
    for path, meta in archive_files(header["files"]):
        if not path.startswith("resources/"):
            continue
        relative = path[len("resources/"):]
        if relative in REQUIRED_RESOURCES:
            selected[relative] = extract_resource(data, base, meta)
    missing = REQUIRED_RESOURCES - selected.keys()
    if missing:
        raise ValueError("required resources missing from archive: " + ", ".join(sorted(missing)))

    html = selected["index.html"].decode("utf-8")
    replacements = [
        ('  <script src="neutralino.js"></script>\n', ""),
        ('  <script src="desktop.js"></script>\n', '  <script src="android-bridge.js"></script>\n'),
        ("if (/Linux/i.test(navigator.platform || navigator.userAgent || '') && decodeErrStreak === 2){",
         "if (!window.__pulsarAndroid && /Linux/i.test(navigator.platform || navigator.userAgent || '') && decodeErrStreak === 2){"),
    ]
    for old, new in replacements:
        if html.count(old) != 1:
            raise ValueError(f"expected exactly one source fragment: {old.strip()}")
        html = html.replace(old, new, 1)

    input_pattern = re.compile(r'<input type="file" id="folderInput"[^>]*>')
    html, count = input_pattern.subn(
        '<input type="file" id="folderInput" accept="audio/*" multiple hidden>', html, count=1
    )
    if count != 1:
        raise ValueError("could not adapt the music picker for Android file selection")

    if "Neutralino.init" in html or "src=\"desktop.js\"" in html:
        raise ValueError("desktop runtime reference remains in generated Android HTML")

    # The desktop build offers folder drag/drop; Android starts by importing
    # several selected audio files through WebView's system document picker.
    mobile_text = [
        (
            "Wybierz folder z muzyką (ikona foldera na dole) albo po prostu upuść pliki audio na to okno. Wykryte zostaną MP3, WAV, OGG, M4A i FLAC wraz z okładkami ID3. Skróty: Spacja — play/pauza, ←/→ — utwory, R — powtarzanie, S — losowo.",
            "Wybierz pliki audio przyciskiem „Dodaj muzykę” poniżej. Obsługiwane formaty: MP3, WAV, OGG, M4A i FLAC.",
            1,
        ),
        (
            "Brak wybranego folderu. Kliknij ikonę foldera na dole albo upuść pliki audio na okno.",
            "Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.",
            2,
        ),
        (
            "Brak utworów. Upuść pliki audio na okno albo kliknij „+ Dodaj muzykę”.",
            "Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.",
            2,
        ),
        (
            "Dodaj utwory z folderu lub pliki audio",
            "Wybierz pliki audio",
            2,
        ),
    ]
    for old, new, expected in mobile_text:
        if html.count(old) != expected:
            raise ValueError(f"unexpected Android UI text occurrence count for {old[:60]!r}")
        html = html.replace(old, new)

    old_folder_translation = "    'Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.': { en: 'No folder chosen. Click the folder icon below or drop audio files onto the window.', es: 'Ninguna carpeta elegida. Pulsa el icono de carpeta abajo o suelta archivos de audio en la ventana.' },"
    if html.count(old_folder_translation) != 1:
        raise ValueError("could not remove the obsolete folder-picker translation")
    html = html.replace(old_folder_translation, "", 1)

    old_dynamic_translation = "    'Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.': { en: 'No tracks yet. Drop audio files onto the window or click “+ Add music”.', es: 'Aún no hay canciones. Suelta archivos de audio en la ventana o pulsa «+ Añadir música».' },"
    new_dynamic_translation = "    'Brak utworów. Kliknij „Dodaj muzykę” i wybierz pliki audio.': { en: 'No tracks yet. Tap “Add music” and choose audio files.', es: 'Aún no hay canciones. Pulsa «Añadir música» y elige archivos de audio.' },"
    if html.count(old_dynamic_translation) != 1:
        raise ValueError("could not update the Android empty-library translation")
    html = html.replace(old_dynamic_translation, new_dynamic_translation, 1)

    old_add_translation = "    'Wybierz pliki audio': { en: 'Add tracks from a folder or audio files', es: 'Añadir canciones de una carpeta o archivos de audio' },"
    new_add_translation = "    'Wybierz pliki audio': { en: 'Choose audio files', es: 'Elegir archivos de audio' },"
    if html.count(old_add_translation) != 1:
        raise ValueError("could not update the Android add-files translation")
    html = html.replace(old_add_translation, new_add_translation, 1)

    dictionary = "  var I18N_DICT = {\n"
    mobile_hint_translation = (
        "    'Wybierz pliki audio przyciskiem „Dodaj muzykę” poniżej. Obsługiwane formaty: MP3, WAV, OGG, M4A i FLAC.': "
        "{ en: 'Use the “Add music” button below to choose audio files. Supported formats: MP3, WAV, OGG, M4A, and FLAC.', "
        "es: 'Usa el botón «Añadir música» de abajo para elegir archivos de audio. Formatos compatibles: MP3, WAV, OGG, M4A y FLAC.' },\n"
    )
    if html.count(dictionary) != 1:
        raise ValueError("could not find the app translation dictionary")
    html = html.replace(dictionary, dictionary + mobile_hint_translation, 1)

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    (out_dir / "index.html").write_text(html, encoding="utf-8")
    (out_dir / "tags.js").write_bytes(selected["tags.js"])
    shutil.copy2(bridge, out_dir / "android-bridge.js")
    print(f"Prepared {out_dir}: index.html, tags.js, android-bridge.js")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    try:
        build(args.archive.resolve(), args.out.resolve(), (ANDROID_DIR / "android-bridge.js"))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"Android web asset preparation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
