import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.ris import fetch, shard

ROUTES_HEADER = "afi\tprefix\tpeer_ip\tpeer_asn\tpath_id\torigin_asn\tcommunities\totc\taggr_asn\taggr_ip\tatomic\ttimestamp\n"
PATHS_HEADER = "path_id\tpath\traw_path\tlength\torigin_asn\tflags\tset_members\troutes_v4\troutes_v6\n"


def write_gz(path: Path, text: str) -> None:
    with gzip.open(path, "wt") as fh:
        fh.write(text)


class NodeIdTest(unittest.TestCase):
    def test_whole_nibbles(self):
        self.assertEqual(shard.node_id(103, 8), "67")
        self.assertEqual(shard.node_id(0x2001, 16), "2001")
        self.assertEqual(shard.node_id(0x6701, 16), "6701")

    def test_partial_nibbles(self):
        # 103.0/11: top 11 bits = 103<<3 | 0 -> padded to 12 bits = 0x670
        self.assertEqual(shard.node_id(103 << 3, 11), "670-11")
        self.assertEqual(shard.node_id((103 << 3) | 5, 11), "67a-11")
        self.assertEqual(shard.node_id((0x2001 << 4) | 0xd, 20), "2001d")

    def test_split_bits(self):
        t = shard.SPLIT_THRESHOLD
        self.assertEqual(shard.split_bits(t + 1, 24), 1)
        self.assertEqual(shard.split_bits(t * 10, 24), 4)
        self.assertEqual(shard.split_bits(t * 10, 2), 2)


class PlanBlocksTest(unittest.TestCase):
    def test_root_and_blocks(self):
        routes = [
            (0, 0, "default"),
            (shard.parse_prefix("4", "1.0.0.0/24")[0], 24, "a"),
            (shard.parse_prefix("4", "2.0.0.0/8")[0], 8, "b"),
        ]
        blocks = shard.plan_blocks(routes, 32, 8)
        self.assertEqual([r[2] for r in blocks["root"]["routes"]], ["default"])
        self.assertEqual([r[2] for r in blocks["01"]["routes"]], ["a"])
        self.assertEqual([r[2] for r in blocks["02"]["routes"]], ["b"])

    def test_split_keeps_short_prefixes_in_parent(self):
        with mock.patch.object(shard, "SPLIT_THRESHOLD", 3):
            pfx = ["10.0.0.0/8", "10.0.0.0/9", "10.0.0.0/24", "10.1.0.0/24", "10.128.0.0/24", "10.200.0.0/16"]
            routes = [(*shard.parse_prefix("4", p), p) for p in pfx]
            blocks = shard.plan_blocks(routes, 32, 8)
        top = blocks["0a"]
        self.assertEqual(top["split_bits"], 1)  # 6 routes, threshold 3: 6>>1 = 3 fits
        self.assertEqual(sorted(r[2] for r in top["routes"]), ["10.0.0.0/8"])
        # /9 and longer go to the two /9 children.
        low = blocks[shard.node_id(0x0a << 1, 9)]
        high = blocks[shard.node_id((0x0a << 1) | 1, 9)]
        self.assertEqual(low["total"], 3)
        self.assertEqual(sorted(r[2] for r in high["routes"]), ["10.128.0.0/24", "10.200.0.0/16"])
        # Every route lands in exactly one block.
        placed = sorted(r[2] for b in blocks.values() for r in b["routes"])
        self.assertEqual(placed, sorted(pfx))

    def test_ipv6(self):
        net, plen = shard.parse_prefix("6", "2001:db8::/32")
        blocks = shard.plan_blocks([(net, plen, "x")], 128, 16)
        self.assertIn("2001", blocks)


class ShardSourceTest(unittest.TestCase):
    def test_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            work, out = Path(tmp) / "work", Path(tmp) / "out"
            work.mkdir()
            write_gz(work / "r.tsv.gz", ROUTES_HEADER +
                     "4\t1.0.0.0/24\t12.0.1.63\t7018\tp1\t13335\t7018:2500 7018:37171\t\t13335\t10.34.2.204\t1\t1795507729\n"
                     "4\t1.0.128.0/17\t12.0.1.63\t7018\tp2\t23969\t\t7018\t\t\t\t1794322469\n"
                     "6\t2001:db8::/32\t2001:1890:111d:1::63\t7018\tp1\t13335\t\t\t\t\t\t1794322000\n")
            write_gz(work / "p.tsv.gz", PATHS_HEADER +
                     "p1\t7018 13335\t7018 13335 13335\t2\t13335\t\t\t1\t1\n"
                     "p2\t7018 1299 {23969,65000}\t7018 1299 {65000,23969}\t3\t\tas_set,private\t23969 65000\t1\t0\n")
            src = {"name": "t_src", "collector": "rrc00", "peer_asn": 7018, "as_of": "2026-11-24T21:15:00+05:30",
                   "files": {"routes": {"asset": "r.tsv.gz"}, "paths": {"asset": "p.tsv.gz"}}}
            summary = shard.shard_source(src, work, out)
            self.assertEqual(summary["routes"], 3)

            index = json.loads((out / "t_src" / "index.json").read_text())
            self.assertEqual(index["peers"], ["12.0.1.63", "2001:1890:111d:1::63"])
            self.assertEqual(index["nodes"]["v4"]["01"], {"n": 2, "t": 2})
            self.assertNotIn("root", index["nodes"]["v4"])

            block = json.loads((out / "t_src" / "v4" / "01.json").read_text())
            self.assertEqual(len(block["paths"]), 2)
            r0, r1 = block["routes"]
            self.assertEqual(r0, ["1.0.0.0/24", 0, 0, 13335, "7018:2500 7018:37171", None, 13335, "10.34.2.204", 1, 1795507729])
            self.assertEqual(r1[5], 7018)  # otc
            self.assertEqual(block["paths"][r1[2]], ["7018 1299 {23969,65000}", "7018 1299 {65000,23969}", 3, None,
                                                    "as_set,private", "23969 65000"])
            v6 = json.loads((out / "t_src" / "v6" / "2001.json").read_text())
            self.assertEqual(v6["routes"][0][1], 1)


class ManifestCheckTest(unittest.TestCase):
    def good(self):
        return {"schema_version": 1, "generated_at": "2026-11-24T21:22:45+05:30", "as_of": "2026-11-24T21:15:00+05:30",
                "sources": [{"name": "s", "as_of": "2026-11-24T21:15:00+05:30",
                             "files": {"routes": {}, "paths": {}}}]}

    def test_ok(self):
        fetch.check_manifest(self.good())

    def test_wrong_schema(self):
        m = self.good()
        m["schema_version"] = 2
        with self.assertRaises(fetch.SchemaError):
            fetch.check_manifest(m)

    def test_missing_file(self):
        m = self.good()
        del m["sources"][0]["files"]["paths"]
        with self.assertRaises(fetch.SchemaError):
            fetch.check_manifest(m)


if __name__ == "__main__":
    unittest.main()
