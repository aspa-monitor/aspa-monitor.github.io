"""Backup AS names for the site, from RIPE NCC's list of all registered ASNs (all RIRs).

The browser asks RIPEstat first; when that fails or has no name it reads these files, which are on
the same origin (no CORS needed). Layout: data/asnames/<asn % 100>.json = {"<asn>": "<name>", ...}

    python -m pipeline.asnames download --out work/asn.txt
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

ASN_TXT_URL = "https://ftp.ripe.net/ripe/asnames/asn.txt"
BUCKETS = 100
MIN_EXPECTED = 50000  # sanity check: the list has >120k ASNs (2026)


def download(out: Path) -> None:
    req = urllib.request.Request(ASN_TXT_URL, headers={"User-Agent": "aspa-monitor-portal"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"downloaded {ASN_TXT_URL}: {len(data) / 1e6:.1f} MB")


def parse(text: str) -> dict:
    """'13335 CLOUDFLARENET - Cloudflare, Inc., US' lines -> {13335: 'CLOUDFLARENET - Cloudflare, Inc., US'}"""
    names = {}
    for line in text.splitlines():
        num, _, name = line.strip().partition(" ")
        if num.isdigit() and name.strip():
            names[int(num)] = name.strip()
    return names


def write_buckets(names: dict, out: Path) -> int:
    buckets = [{} for _ in range(BUCKETS)]
    for asn, name in names.items():
        buckets[asn % BUCKETS][str(asn)] = name
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    for i, b in enumerate(buckets):
        data = json.dumps(b, separators=(",", ":"), ensure_ascii=False).encode()
        (out / f"{i}.json").write_bytes(data)
        total += len(data)
    return total


def build(asn_txt: Path, out: Path) -> bool:
    """Write the buckets; False (and nothing written) if the file is missing or looks wrong."""
    if not asn_txt.exists():
        print(f"warning: {asn_txt} missing; site will have no backup AS names")
        return False
    names = parse(asn_txt.read_bytes().decode("utf-8", errors="replace"))
    if len(names) < MIN_EXPECTED:
        print(f"warning: only {len(names)} AS names in {asn_txt}; skipping backup AS names")
        return False
    size = write_buckets(names, out)
    print(f"backup AS names: {len(names)} ASNs, {size / 1e6:.1f} MB")
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("download")
    d.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    download(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
