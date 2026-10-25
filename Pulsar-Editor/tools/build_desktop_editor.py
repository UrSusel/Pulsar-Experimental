#!/usr/bin/env python3
"""Wbudowuje edytor audio/napisów w paczki Pulsara Windows i Linux.

  python Pulsar-Editor/tools/build_desktop_editor.py
  python Pulsar-Editor/tools/build_desktop_editor.py --check
  python Pulsar-Editor/tools/build_desktop_editor.py --platform windows

Skrypt współpracuje z warstwą Pulsar-Sync: zmienia tylko zaczepy edytora,
dodaje trzy własne zasoby i przelicza integralność resources.neu.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

EDITOR_DIR = Path(__file__).resolve().parents[1]
REPO = EDITOR_DIR.parent
TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(REPO / "Pulsar-Sync" / "tools"))
from runtime_patches import apply_editor_runtime_patches, editor_runtime_patched  # noqa: E402
import neu  # noqa: E402

INDEX = "resources/index.html"
ASSETS = {
    "resources/editor-core.js": EDITOR_DIR / "editor-core.js",
    "resources/audio-editor.js": EDITOR_DIR / "audio-editor.js",
    "resources/audio-editor.css": EDITOR_DIR / "audio-editor.css",
}
CSS_TAG = '  <link rel="stylesheet" href="audio-editor.css">\n'
SCRIPT_TAGS = (
    '  <script src="editor-core.js"></script>\n'
    '  <script src="audio-editor.js"></script>\n'
)
PLATFORMS = {
    "windows": REPO / "Pulsar-Windows" / "resources.neu",
    "linux": REPO / "Pulsar-Linux" / "resources.neu",
}


def patch_asset_tags(html: str) -> str:
    for tag in (CSS_TAG, SCRIPT_TAGS):
        html = html.replace(tag, "")
    # Usuń także znaczniki z innym wcięciem po starszych buildach.
    lines = [line for line in html.splitlines(keepends=True)
             if not any(name in line and ("<script" in line or "<link" in line)
                        for name in ("editor-core.js", "audio-editor.js", "audio-editor.css"))]
    html = "".join(lines)
    if html.count("</head>") != 1 or html.count("</body>") != 1:
        raise ValueError("index.html nie ma dokładnie jednego </head> i </body>")
    html = html.replace("</head>", CSS_TAG + "</head>", 1)
    html = html.replace("</body>", SCRIPT_TAGS + "</body>", 1)
    return html


def expected_index(original: bytes) -> bytes:
    html = original.decode("utf-8")
    return patch_asset_tags(apply_editor_runtime_patches(html)).encode("utf-8")


def run(platform: str, archive: Path, check_only: bool) -> bool:
    if not archive.is_file():
        print(f"[{platform}] brak {archive}")
        return False
    for source in ASSETS.values():
        if not source.is_file():
            raise ValueError(f"brak zasobu {source}")

    with tempfile.TemporaryDirectory(prefix=f"pulsar-editor-{platform}-") as tmp:
        work = Path(tmp) / "src"
        data, header, base = neu.read_archive(str(archive))
        files = {rel: neu.file_bytes(data, base, entry) for rel, entry in neu.iter_files(header)}
        if INDEX not in files:
            raise ValueError("w archiwum brak resources/index.html")
        for rel, blob in files.items():
            target = work / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(blob)

        patched = expected_index(files[INDEX])
        sources_match = all(files.get(rel) == source.read_bytes() for rel, source in ASSETS.items())
        ready = files[INDEX] == patched and sources_match and editor_runtime_patched(patched.decode("utf-8"))
        if check_only:
            print(f"[{platform}] {'gotowe' if ready else 'wymaga przebudowania'}")
            return ready
        if ready:
            print(f"[{platform}] edytor już aktualny")
            return True

        (work / INDEX).write_bytes(patched)
        for rel, source in ASSETS.items():
            target = work / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

        rebuilt = Path(tmp) / "resources.neu"
        neu.pack(str(work), str(rebuilt))
        after_data, after_header, after_base = neu.read_archive(str(rebuilt))
        after = {rel: neu.file_bytes(after_data, after_base, entry)
                 for rel, entry in neu.iter_files(after_header)}
        allowed = {INDEX, *ASSETS.keys()}
        for rel, blob in files.items():
            if rel not in allowed and after.get(rel) != blob:
                raise ValueError(f"plik {rel} zmienił się przy przebudowie")
        if after.get(INDEX) != patched:
            raise ValueError("index.html w archiwum różni się od oczekiwanego")
        for rel, source in ASSETS.items():
            if after.get(rel) != source.read_bytes():
                raise ValueError(f"zasób {rel} nie zgadza się ze źródłem")
        for rel, entry in neu.iter_files(after_header):
            if neu.check(entry, after[rel]) is False:
                raise ValueError(f"zła suma SHA-256: {rel}")

        shutil.copy2(rebuilt, archive)
        print(f"[{platform}] zapisano edytor: {archive.stat().st_size} B, {len(after)} plików")
        return True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=sorted(PLATFORMS))
    parser.add_argument("--check", action="store_true", help="sprawdź bez zapisywania")
    args = parser.parse_args(argv)
    targets = [args.platform] if args.platform else sorted(PLATFORMS)
    ok = True
    for platform in targets:
        try:
            ok &= run(platform, PLATFORMS[platform], args.check)
        except (OSError, ValueError, KeyError) as exc:
            print(f"[{platform}] błąd: {exc}", file=sys.stderr)
            return 1
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
