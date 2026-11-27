"""Validated ASPA objects for the site (interim, until rpki-aspa-data publishes its own).

Source: Cloudflare's public rpki-client output, https://rpki.cloudflare.com/rpki.json (about 100 MB, all five
RIR trust anchors, rebuilt every few minutes). The download step keeps only the ASPAs; the build writes one
small file the browser reads in a single request:

    data/aspa/aspas.json = {"schema_version": 1, "source": ..., "source_time": IST, "built": IST,
                            "customers": N, "providers": rows, "aspas": {"<customer AS>": [provider AS, ...]}}

A provider list of [0] (AS0) means the customer has no providers at all.
If the download fails or looks wrong, the build reuses the live site's current file, so the site keeps the
last good ASPA set instead of losing it.

    python -m pipeline.aspa download --out work/aspas.json
"""
import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from pipeline.timefmt import IST, now_ist

RPKI_JSON_URL = "https://rpki.cloudflare.com/rpki.json"
SOURCE = "Cloudflare RPKI validator (rpki-client), rpki.cloudflare.com/rpki.json"
SCHEMA_VERSION = 1
MIN_EXPECTED = 2000  # sanity check: 4,357 ASPAs on 2026-11-27, and the number only grows
MAX_ASN = 2**32 - 1
USER_AGENT = "aspa-monitor-portal (+https://aspa-monitor.gauravkansal.in/)"


def get(url: str, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def download(out: Path) -> None:
    """Fetch rpki.json and keep only its ASPAs and build time (the rest is ~100 MB of ROAs)."""
    data = get(RPKI_JSON_URL)
    full = json.loads(data)
    small = {"buildtime": full.get("metadata", {}).get("buildtime"), "aspas": full.get("aspas", [])}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(small, separators=(",", ":")))
    print(f"downloaded {RPKI_JSON_URL}: {len(data) / 1e6:.1f} MB, kept {len(small['aspas'])} ASPAs")


def _asn(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= MAX_ASN


def extract(raw: dict, now: float = None) -> dict:
    """rpki-client ASPAs -> {customer: sorted providers}, dropping expired objects.
    Raises ValueError if the data looks wrong (bad entries, or fewer than MIN_EXPECTED)."""
    now = time.time() if now is None else now
    aspas = {}
    for i, a in enumerate(raw.get("aspas") or []):
        cust, provs = a.get("customer_asid"), a.get("providers")
        if not _asn(cust) or cust == 0 or not isinstance(provs, list) or not provs or not all(_asn(p) for p in provs):
            raise ValueError(f"bad ASPA entry #{i}: {a!r}"[:200])
        if isinstance(a.get("expires"), (int, float)) and a["expires"] < now:
            continue
        aspas.setdefault(cust, set()).update(provs)  # one object per customer today; merge if that changes
    if len(aspas) < MIN_EXPECTED:
        raise ValueError(f"only {len(aspas)} ASPAs (expected at least {MIN_EXPECTED})")
    return {c: sorted(p) for c, p in sorted(aspas.items())}


def to_ist(utc_text: str) -> str:
    """'2026-11-27T06:42:05Z' -> '2026-11-27T12:12:05+05:30' (None stays None)."""
    if not utc_text:
        return None
    dt = datetime.fromisoformat(utc_text.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).isoformat(timespec="seconds")


def document(aspas: dict, source_time: str) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "source": SOURCE,
        "source_time": source_time,
        "built": now_ist(),
        "customers": len(aspas),
        "providers": sum(len(p) for p in aspas.values()),
        "aspas": {str(c): p for c, p in aspas.items()},
    }


def check_document(doc: dict) -> None:
    """The same checks for a reused live file as for a fresh one."""
    if doc.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"schema_version {doc.get('schema_version')!r}, expected {SCHEMA_VERSION}")
    raw = {"aspas": [{"customer_asid": int(c), "providers": p} for c, p in (doc.get("aspas") or {}).items()]}
    extract(raw, now=0)


def write(doc: dict, out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    data = json.dumps(doc, separators=(",", ":")).encode()
    (out / "aspas.json").write_bytes(data)
    return len(data)


def build(fresh: Path, out: Path, live_url: str = "") -> str:
    """Write data/aspa/aspas.json from the fresh download, else from the live site.
    Returns "fresh", "reused" or "none" (the site then shows no ASPA data)."""
    try:
        if not fresh or not fresh.exists():
            raise ValueError(f"{fresh} missing (download failed?)")
        raw = json.loads(fresh.read_text())
        aspas = extract(raw)
        size = write(document(aspas, to_ist(raw.get("buildtime"))), out)
        print(f"ASPA: {len(aspas)} customers, {sum(map(len, aspas.values()))} providers, {size / 1e3:.0f} kB (fresh)")
        return "fresh"
    except (OSError, ValueError) as e:
        print(f"warning: fresh ASPA data unusable: {e}")
    if live_url:
        try:
            doc = json.loads(get(live_url, timeout=60))
            check_document(doc)
            doc["reused_at"] = now_ist()  # the data itself is still from doc["source_time"]
            size = write(doc, out)
            print(f"ASPA: reused the live file ({doc['customers']} customers, source time {doc.get('source_time')})")
            return "reused"
        except (OSError, ValueError) as e:
            print(f"warning: could not reuse the live ASPA file: {e}")
    print("warning: site will have no ASPA data")
    return "none"


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
