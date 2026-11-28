import json
import tempfile
import unittest
from pathlib import Path

from pipeline import asregions

SAMPLE = """# comments
2|apnic|20261128|89899|19830613|20261127|+1000
apnic|*|asn|*|5|summary
apnic|IN|asn|9583|1|20020801|allocated
apnic|IN|asn|9584|2|20020801|allocated
apnic|JP|asn|173|1|20020801|allocated
apnic|IN|asn|133000|10|20150101|assigned
apnic|AU|asn|1221|1|20020801|allocated
apnic||asn|64000|1|20020801|reserved
apnic|IN|ipv4|1.6.0.0|1024|20020801|allocated
"""


class TestAsRegions(unittest.TestCase):
    def test_parse_merges_consecutive_ranges_per_economy(self):
        got = asregions.parse(SAMPLE)
        self.assertEqual(got["date"], "20261128")
        self.assertEqual(got["cc"]["IN"], [[9583, 3], [133000, 10]])
        self.assertEqual(got["cc"]["JP"], [[173, 1]])
        self.assertEqual(got["asns"], 15)  # reserved and IPv4 rows left out
        self.assertNotIn("", got["cc"])

    def test_build_writes_file_or_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            src, out = Path(d) / "delegated", Path(d) / "out"
            self.assertFalse(asregions.build(src, out))  # missing
            src.write_text(SAMPLE)
            self.assertFalse(asregions.build(src, out))  # too few ASNs to be the real file
            self.assertFalse((out / "apnic.json").exists())
            big = SAMPLE + "".join(f"apnic|CN|asn|{200000 + i}|1|20200101|allocated\n" for i in range(0, 40000, 2))
            src.write_text(big)
            self.assertTrue(asregions.build(src, out))
            doc = json.loads((out / "apnic.json").read_text())
            self.assertEqual(doc["cc"]["IN"], [[9583, 3], [133000, 10]])
            self.assertTrue(doc["built"].endswith("+05:30"))


if __name__ == "__main__":
    unittest.main()
