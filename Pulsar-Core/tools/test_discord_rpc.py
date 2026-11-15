#!/usr/bin/env python3
"""Unit checks for the small Discord local IPC helper; no Discord account required."""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import socket
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(REPO / "Pulsar-Sync/tools"))
import neu  # noqa: E402
SPEC = importlib.util.spec_from_file_location("pulsar_discord_rpc", ROOT / "Linux/resources/discord-rpc.py")
assert SPEC and SPEC.loader
RPC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RPC)


class DiscordRpcTests(unittest.TestCase):
    def test_frame_uses_discord_little_endian_opcode_and_utf8_length(self):
        packet = RPC.encode_frame(RPC.OP_HANDSHAKE, {"v": 1, "client_id": "12345678901234567"})
        opcode, size = struct.unpack("<II", packet[:8])
        payload = json.loads(packet[8:].decode("utf-8"))
        self.assertEqual(opcode, 0)
        self.assertEqual(size, len(packet) - 8)
        self.assertEqual(payload, {"v": 1, "client_id": "12345678901234567"})

    def test_playing_activity_includes_title_artist_and_elapsed_timestamp(self):
        with patch.object(RPC.time, "time", return_value=1000):
            activity = RPC.make_activity({
                "title": "Example song", "artist": "Example artist", "playing": True, "position": 34.8
            })
        self.assertEqual(activity["type"], 2)
        self.assertEqual(activity["details"], "Example song")
        self.assertEqual(activity["state"], "Example artist")
        self.assertEqual(activity["timestamps"]["start"], 965)

    def test_paused_activity_has_no_running_clock(self):
        activity = RPC.make_activity({"title": "Paused song", "artist": "Artist", "playing": False, "position": 40})
        self.assertNotIn("timestamps", activity)
        self.assertEqual(activity["state"], "Paused · Artist")

    def test_activity_fields_are_bounded_and_helper_uses_no_secret_token(self):
        activity = RPC.make_activity({"title": "T" * 200, "artist": "A" * 200, "playing": True})
        self.assertLessEqual(len(activity["details"]), 128)
        self.assertLessEqual(len(activity["state"]), 128)
        source = (ROOT / "Linux/resources/discord-rpc.py").read_text(encoding="utf-8")
        self.assertNotIn("access_token", source.lower())
        self.assertIn("AF_UNIX", source)
        self.assertIn("SET_ACTIVITY", source)

    def test_desktop_archives_include_their_native_ipc_helper(self):
        expected = {
            REPO / "Pulsar-Linux/resources.neu": ("resources/discord-rpc.py", ROOT / "Linux/resources/discord-rpc.py"),
            REPO / "Pulsar-Windows/resources.neu": ("resources/discord-rpc.ps1", ROOT / "Windows/resources/discord-rpc.ps1"),
        }
        for archive, (name, source) in expected.items():
            data, header, base = neu.read_archive(str(archive))
            files = {path: entry for path, entry in neu.iter_files(header)}
            self.assertIn(name, files, f"{archive.name} includes {name}")
            self.assertEqual(neu.file_bytes(data, base, files[name]), source.read_bytes(),
                             f"{archive.name} contains the latest {name}")

    def test_ipc_client_handshakes_and_sends_set_activity_over_unix_socket(self):
        with tempfile.TemporaryDirectory() as directory:
            endpoint = os.path.join(directory, "discord-ipc-0")
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind(endpoint)
            server.listen(1)
            received = {}
            failure = []

            def serve():
                try:
                    connection, _ = server.accept()
                    with connection:
                        opcode, handshake = RPC.read_packet(connection)
                        received["handshake"] = (opcode, handshake)
                        connection.sendall(RPC.encode_frame(RPC.OP_FRAME, {"evt": "READY", "data": {}}))
                        opcode, command = RPC.read_packet(connection)
                        received["command"] = (opcode, command)
                        connection.sendall(RPC.encode_frame(RPC.OP_FRAME, {
                            "cmd": "SET_ACTIVITY", "evt": None, "nonce": command["nonce"], "data": {}
                        }))
                except Exception as error:  # surface background-thread failures in the test
                    failure.append(error)
                finally:
                    server.close()

            thread = threading.Thread(target=serve, daemon=True)
            thread.start()
            with patch.dict(os.environ, {"DISCORD_IPC_PATH": endpoint}):
                rpc = RPC.DiscordIPC()
                rpc.send("12345678901234567", {"type": 2, "details": "Test track"})
                rpc.close()
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
            self.assertFalse(failure)
            self.assertEqual(received["handshake"][0], RPC.OP_HANDSHAKE)
            self.assertEqual(received["handshake"][1]["client_id"], "12345678901234567")
            self.assertEqual(received["command"][0], RPC.OP_FRAME)
            self.assertEqual(received["command"][1]["cmd"], "SET_ACTIVITY")
            self.assertEqual(received["command"][1]["args"]["activity"]["details"], "Test track")


if __name__ == "__main__":
    unittest.main(verbosity=2)
