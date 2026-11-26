"""Split ris-routing-data routes into small JSON files the browser can fetch.

Layout per source (data/ris/<source>/):
  index.json           which blocks exist, how many routes each holds, which were split
  v4/root.json.gz      IPv4 prefixes shorter than /8      (v6/root.json.gz: shorter than /16)
  v4/<id>.json.gz      one block, named by node_id() (IPv4 103/8 -> 67, 103.0/11 -> 670-11)

Block files are gzip-compressed JSON (about 6x smaller), so many peers fit in the 1 GB Pages limit.
Pages serves them as plain bytes; the browser decompresses them (DecompressionStream).
index.json "block_suffix" names the file ending, so the page never has to guess.

A block with more than SPLIT_THRESHOLD routes is split by the next k bits (k = "k" in index.json,
the fewest bits that should bring each child under the threshold): it keeps the prefixes shorter than
depth+k, and children hold the rest; children that are still too big are split again. So every covering prefix of an address lives on
the chain root -> /8 -> /16 -> ... and a lookup fetches only that chain.

Each block file is self-contained: {"paths": [...], "routes": [...]}, routes point at paths by index.
  path  = [path, raw_path, length, origin_asn, flags, set_members]
  route = [prefix, peer_index, path_index, origin_asn, communities, otc, aggr_asn, aggr_ip, atomic, timestamp]
"""
import csv
import gzip
import ipaddress
import json
from pathlib import Path

SHARD_SCHEMA = 1
SPLIT_THRESHOLD = 4000
FAMILY = {
    "4": {"key": "v4", "width": 32, "base": 8},
    "6": {"key": "v6", "width": 128, "base": 16},
}

csv.field_size_limit(1 << 24)


def node_id(top: int, depth: int) -> str:
    """Name of the block holding the top `depth` bits `top`.

    Hex of those bits, padded to whole hex digits; "-<depth>" is added when depth is not a
    multiple of 4. E.g. IPv4 103/8 -> "67", 103.0/11 -> "670-11", IPv6 2001::/16 -> "2001".
    """
    nibbles = -(-depth // 4)
    text = format(top << (nibbles * 4 - depth), "0%dx" % nibbles)
    return text if depth % 4 == 0 else f"{text}-{depth}"


def parse_prefix(afi: str, prefix: str):
    if afi == "4":
        addr, _, plen = prefix.partition("/")
        a, b, c, d = (int(x) for x in addr.split("."))
        return (a << 24) | (b << 16) | (c << 8) | d, int(plen)
    n = ipaddress.IPv6Network(prefix)
    return int(n.network_address), n.prefixlen


def _int_or_none(s: str):
    return int(s) if s else None


def read_paths(path: Path) -> dict:
    paths = {}
    with gzip.open(path, "rt", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            paths[row["path_id"]] = [
                row["path"],
                row["raw_path"],
                _int_or_none(row["length"]),
                _int_or_none(row["origin_asn"]),
                row["flags"],
                row["set_members"],
            ]
    return paths


def read_routes(path: Path):
    """Yield (afi, net_int, plen, row-dict) per route."""
    with gzip.open(path, "rt", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            afi = row["afi"]
            if afi not in FAMILY:
                continue
            net, plen = parse_prefix(afi, row["prefix"])
            yield afi, net, plen, row


def split_bits(count: int, room: int) -> int:
    """Fewest extra bits so that, if routes spread evenly, each child is under the threshold."""
    k = 1
    while (count >> k) > SPLIT_THRESHOLD and k < room:
        k += 1
    return min(k, room)


def plan_blocks(routes, width: int, base: int):
    """Assign routes (net, plen, payload) to blocks.

    Returns {node_id: {"routes", "depth", "split_bits" (0 = not split), "total"}}; "root" holds
    prefixes shorter than `base`. A split block with k bits keeps prefixes shorter than depth+k.
    """
    blocks = {"root": {"routes": [], "depth": 0, "split_bits": 0, "total": 0}}
    groups = {}
    for r in routes:
        if r[1] < base:
            blocks["root"]["routes"].append(r)
        else:
            groups.setdefault(r[0] >> (width - base), []).append(r)
    blocks["root"]["total"] = len(blocks["root"]["routes"])

    def build(depth: int, top: int, members: list):
        nid = node_id(top, depth)
        if len(members) <= SPLIT_THRESHOLD or depth >= width:
            blocks[nid] = {"routes": members, "depth": depth, "split_bits": 0, "total": len(members)}
            return
        k = split_bits(len(members), width - depth)
        keep, children = [], {}
        for r in members:
            if r[1] < depth + k:
                keep.append(r)
            else:
                children.setdefault(r[0] >> (width - depth - k), []).append(r)
        blocks[nid] = {"routes": keep, "depth": depth, "split_bits": k, "total": len(members)}
        for child_top, sub in children.items():
            build(depth + k, child_top, sub)

    for top, members in groups.items():
        build(base, top, members)
    return blocks


BLOCK_SUFFIX = ".json.gz"


def _write_json(path: Path, obj, compress: bool = False) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
    if compress:
        data = gzip.compress(data, compresslevel=9, mtime=0)
    path.write_bytes(data)
    return len(data)


def shard_source(source: dict, work: Path, out: Path) -> dict:
    """Shard one manifest source into out/<name>/. Returns a summary for the portal manifest."""
    name = source["name"]
    dest = out / name
    paths = read_paths(work / source["files"]["paths"]["asset"])

    peers, peer_index = [], {}
    by_family = {"4": [], "6": []}
    for afi, net, plen, row in read_routes(work / source["files"]["routes"]["asset"]):
        peer = row["peer_ip"]
        if peer not in peer_index:
            peer_index[peer] = len(peers)
            peers.append(peer)
        by_family[afi].append((net, plen, row))

    index_nodes = {}
    total_bytes = 0
    files = 0
    counts = {}
    for afi, fam in FAMILY.items():
        routes = by_family[afi]
        counts[fam["key"]] = len(routes)
        blocks = plan_blocks(routes, fam["width"], fam["base"])
        nodes = {}
        for nid, blk in blocks.items():
            members = sorted(blk["routes"], key=lambda r: (r[0], r[1]))
            nodes[nid] = {"n": len(members), "t": blk["total"]}
            if blk["split_bits"]:
                nodes[nid]["k"] = blk["split_bits"]
            if not members:
                continue
            path_rows, path_pos = [], {}
            route_rows = []
            for _net, _plen, row in members:
                pid = row["path_id"]
                if pid not in path_pos:
                    path_pos[pid] = len(path_rows)
                    path_rows.append(paths.get(pid, ["", "", None, None, "", ""]))
                route_rows.append([
                    row["prefix"],
                    peer_index[row["peer_ip"]],
                    path_pos[pid],
                    _int_or_none(row["origin_asn"]),
                    row["communities"],
                    _int_or_none(row["otc"]),
                    _int_or_none(row["aggr_asn"]),
                    row["aggr_ip"],
                    1 if row["atomic"] == "1" else 0,
                    _int_or_none(row["timestamp"]),
                ])
            total_bytes += _write_json(dest / fam["key"] / f"{nid}{BLOCK_SUFFIX}",
                                       {"paths": path_rows, "routes": route_rows}, compress=True)
            files += 1
        if not nodes["root"]["n"]:
            nodes.pop("root")
        index_nodes[fam["key"]] = nodes

    index = {
        "schema_version": SHARD_SCHEMA,
        "source": name,
        "collector": source.get("collector"),
        "peer_asn": source.get("peer_asn"),
        "as_of": source["as_of"],
        "peers": peers,
        "split_threshold": SPLIT_THRESHOLD,
        "block_suffix": BLOCK_SUFFIX,
        "counts": {"routes": counts["v4"] + counts["v6"], **counts, "paths": len(paths)},
        "nodes": index_nodes,
    }
    total_bytes += _write_json(dest / "index.json", index)

    meta = source.get("meta")
    if meta and (work / meta).exists():
        data = (work / meta).read_bytes()
        (dest / "meta.json").write_bytes(data)
        total_bytes += len(data)

    return {
        "name": name,
        "collector": source.get("collector"),
        "peer_asn": source.get("peer_asn"),
        "as_of": source["as_of"],
        "routes": index["counts"]["routes"],
        "v4": index["counts"]["v4"],
        "v6": index["counts"]["v6"],
        "files": files + 1,
        "site_bytes": total_bytes,
    }
