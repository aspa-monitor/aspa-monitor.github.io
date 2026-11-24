import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline import asnames


class AsNamesTest(unittest.TestCase):
    def test_parse(self):
        names = asnames.parse("13335 CLOUDFLARENET - Cloudflare, Inc., US\n7018 ATT-INTERNET4 - AT&T, US\nbad line\n99 \n")
        self.assertEqual(names, {13335: "CLOUDFLARENET - Cloudflare, Inc., US", 7018: "ATT-INTERNET4 - AT&T, US"})

    def test_build_buckets(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(asnames, "MIN_EXPECTED", 1):
            src, out = Path(tmp) / "asn.txt", Path(tmp) / "out"
            src.write_text("13335 CLOUDFLARENET - Cloudflare, Inc., US\n4200000001 X\n")
            self.assertTrue(asnames.build(src, out))
            self.assertEqual(len(list(out.glob("*.json"))), asnames.BUCKETS)
            self.assertEqual(json.loads((out / "35.json").read_text())["13335"], "CLOUDFLARENET - Cloudflare, Inc., US")
            self.assertIn("4200000001", json.loads((out / "1.json").read_text()))

    def test_missing_or_short_file_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            self.assertFalse(asnames.build(Path(tmp) / "nope.txt", out))
            (Path(tmp) / "short.txt").write_text("1 A\n")
            self.assertFalse(asnames.build(Path(tmp) / "short.txt", out))
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
