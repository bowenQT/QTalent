#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("source", Path(__file__).with_name("check-media-source.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
VERSION = "7:6.1.1-3ubuntu5"
SOURCES = f"Types: deb\nURIs: {source.MIRROR}\nSuites: noble\nSigned-By: {source.KEYRING}\n"


def row(uri, version=VERSION):
    return f"ffmpeg | {version} | {uri} noble/universe amd64 Packages\n"


class SourceTest(unittest.TestCase):
    def test_actual_reproduction(self):
        # Exact public wrapper form reproduced by X2; no local artifact required.
        mirrors = "http://archive.ubuntu.com/ubuntu/\tpriority:1\nhttp://security.ubuntu.com/ubuntu/\tpriority:2\n"
        self.assertTrue(source.mirrors_valid(mirrors))
        self.assertTrue(source.signed_wrapper_valid(SOURCES))
        self.assertEqual(source.check(row(source.MIRROR), VERSION, lambda: True), {
            "version_present": True, "official_source": True,
            "mirror_wrapper_present": True, "mirror_wrapper_verified": True})

    def test_direct_official(self):
        for uri in ("http://archive.ubuntu.com/ubuntu", "https://security.ubuntu.com/ubuntu/",
                    "http://azure.archive.ubuntu.com/ubuntu/", "http://us-east-2.ec2.archive.ubuntu.com/ubuntu"):
            with self.subTest(uri=uri):
                self.assertTrue(source.check(row(uri), VERSION)["official_source"])

    def test_wrong_version(self):
        self.assertFalse(source.check(row("http://archive.ubuntu.com/ubuntu", "bad"), VERSION)["version_present"])

    def test_wrapper_requires_validation(self):
        self.assertFalse(source.check(row(source.MIRROR), VERSION, lambda: False)["official_source"])

    def test_other_mirrorfile(self):
        self.assertFalse(source.check(row("mirror+file:/tmp/apt-mirrors.txt"), VERSION, lambda: True)["official_source"])

    def test_spoofed_direct_urls(self):
        for uri in ("https://archive.ubuntu.com.evil.test/ubuntu", "https://evil.test/https://archive.ubuntu.com/ubuntu",
                    "https://user@archive.ubuntu.com/ubuntu", "https://archive.ubuntu.com:443/ubuntu",
                    "https://archive.ubuntu.com/ubuntu/evil", "https://archive.ubuntu.com/ubuntu?evil=1"):
            with self.subTest(uri=uri):
                self.assertFalse(source.check(row(uri), VERSION)["official_source"])

    def test_mixed_origins(self):
        self.assertFalse(source.check(row("https://archive.ubuntu.com/ubuntu") + row("https://evil.test/ubuntu"), VERSION)["official_source"])

    def test_nonofficial_mirror_member(self):
        self.assertFalse(source.mirrors_valid("https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://evil.test/ubuntu/\tpriority:2\n"))

    def test_empty_mirror(self):
        self.assertFalse(source.mirrors_valid("# no mirrors\n\n"))

    def test_runner_mirror_metadata(self):
        self.assertTrue(source.mirrors_valid("http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n"))

    def test_wrong_keyring(self):
        self.assertFalse(source.signed_wrapper_valid(SOURCES.replace(source.KEYRING, "/tmp/foreign.gpg")))

    def test_trust_bypass(self):
        for flag in ("Trusted", "Allow-Insecure", "Allow-Weak", "Allow-Downgrade-To-Insecure"):
            with self.subTest(flag=flag):
                self.assertFalse(source.signed_wrapper_valid(SOURCES + flag + ": yes\n"))

    def test_no_active_signed_wrapper(self):
        self.assertFalse(source.signed_wrapper_valid(SOURCES + "Enabled: no\n"))
        self.assertFalse(source.signed_wrapper_valid(SOURCES.replace(source.MIRROR, "http://archive.ubuntu.com/ubuntu")))

    def test_file_metadata(self):
        for uid, mode, allowed in ((0, 0o100644, True), (501, 0o100644, False), (0, 0o100666, False), (0, 0o120777, False)):
            with self.subTest(uid=uid, mode=mode), patch.object(Path, "lstat", return_value=SimpleNamespace(st_uid=uid, st_mode=mode)):
                if allowed:
                    source.protected_file("unused")
                else:
                    with self.assertRaises(ValueError):
                        source.protected_file("unused")

    def test_missing_file(self):
        with patch.object(Path, "lstat", side_effect=FileNotFoundError):
            self.assertFalse(source.runner_wrapper_valid())

    def test_duplicate_security_field(self):
        self.assertFalse(source.signed_wrapper_valid(SOURCES + "Signed-By: /tmp/foreign.gpg\n"))


if __name__ == "__main__":
    unittest.main()
