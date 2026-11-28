"""Which ASNs APNIC delegated, and to which economy, for the /aspa/ page's India / AP region / World choice.

Source: APNIC's daily delegated statistics (public). Interim: aspa-validation will later publish each AS's
registry and country with its own verdicts, and the page will use those instead.
Layout: data/asregions/apnic.json =
    {"source": url, "date": "YYYYMMDD" (APNIC's file date), "built": IST,
     "asns": n, "cc": {"IN": [[first ASN, count], ...], ...}}   ranges merged where consecutive

    python -m pipeline.asregions download --out work/delegated-apnic-latest
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

from pipeline.timefmt import now_ist

URL = "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest"
MIN_EXPECTED = 20000  # sanity check: APNIC had ~31k delegated ASNs in 2026


def download(out: Path) -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "aspa-monitor-portal"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"downloaded {URL}: {len(data) / 1e6:.1f} MB")


def parse(text: str) -> dict:
    """Delegated-stats lines -> {"date": file date, "cc": {cc: [[start, count], ...]}, "asns": total}."""
    date, rows = None, []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        p = line.strip().split("|")
        if date is None and len(p) >= 4 and p[0].isdigit():  # header: version|registry|serial|records|...
            date = p[2]
            continue
        if len(p) >= 7 and p[0] == "apnic" and p[2] == "asn" and p[6] in ("allocated", "assigned") \
                and p[3].isdigit() and p[4].isdigit() and len(p[1]) == 2:
            rows.append((int(p[3]), int(p[4]), p[1].upper()))
    rows.sort()
    by_cc, total = {}, 0
    for start, count, cc in rows:
        ranges = by_cc.setdefault(cc, [])
        if ranges and ranges[-1][0] + ranges[-1][1] == start:
            ranges[-1][1] += count
        else:
            ranges.append([start, count])
        total += count
    return {"date": date, "cc": by_cc, "asns": total}


def build(src: Path, out: Path) -> bool:
    """Write data/asregions/apnic.json; False (nothing written) if the file is missing or looks wrong.
    The page then offers only the World view."""
    if not src or not src.exists():
        print(f"warning: {src} missing; /aspa/ will offer only the World view")
        return False
    parsed = parse(src.read_bytes().decode("utf-8", errors="replace"))
    if parsed["asns"] < MIN_EXPECTED or "IN" not in parsed["cc"]:
        print(f"warning: only {parsed['asns']} APNIC ASNs in {src}; skipping regions")
        return False
    out.mkdir(parents=True, exist_ok=True)
    doc = {"source": URL, "date": parsed["date"], "built": now_ist(), "asns": parsed["asns"], "cc": parsed["cc"]}
    data = json.dumps(doc, separators=(",", ":")).encode()
    (out / "apnic.json").write_bytes(data)
    print(f"APNIC ASNs: {parsed['asns']} in {len(parsed['cc'])} economies, {len(data) / 1e3:.0f} kB")
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("download")
    d.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    if args.cmd == "download":
        download(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
