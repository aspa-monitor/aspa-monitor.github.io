"""This portal's own ASPA results, from aspa-validation's rolling "latest" release.

ASPA hygiene (each published ASPA against the upstreams seen in our feeds) for the /hygiene/ page:
    data/validation/hygiene/summary.json = {schema_version, as_of, generated_at, feeds_total, evidence_thresholds,
        inputs (caida_citation, caida_file, ris_as_of, rpki_as_of), built,
        "fields": [...], "asns": [[asn, rir, cc, group, evidence, missing (n), seen (n upstreams)], ...],
        "missing": {"<asn>": [[provider, feeds, share, evidence, first_observed], ...]}  (groups with missing only)}
    data/validation/hygiene/asn/<asn % 100>.json = {"<asn>": full aspa-validation entry}
And invalid customer/provider pairs for the /aspa/ page, computed by aspa-validation from the same RIS and
RouteViews feeds as /lookup/. Only side "origin" pairs are kept (the customer sent the route to a provider its
ASPA doesn't list); side "peer" pairs are mostly our feeds' own peers above the real break.
If the download fails or looks wrong, nothing is written and the page falls back to BGPKIT's top pairs.
Layout: data/validation/invalid_pairs.json =
    {"schema_version": 1, "source": url, "generated_at": IST, "as_of": IST, "feeds_total": n, "built": IST,
     "paths_verified": n, "pairs_total": n (both sides),
     "pairs": [[customer, provider, invalid_paths, routes, feeds, first_observed, customer_cc, customer_rir], ...]}
    pairs sorted by invalid_paths, then routes (both descending)

    python -m pipeline.validation download --work work/validation
"""
import argparse
import gzip
import hashlib
import json
import sys
from pathlib import Path

from pipeline.ris.fetch import _get
from pipeline.timefmt import now_ist

RELEASE_BASE = "https://github.com/aspa-monitor/aspa-validation/releases/download/latest/"
SUPPORTED_SCHEMA = {1}
FIELDS = ("customer", "provider", "invalid_paths", "routes", "feeds", "first_observed", "customer_cc", "customer_rir")


def download(work: Path) -> None:
    """manifest.json, invalid_pairs.json.gz and hygiene.json.gz, size- and sha256-checked against the manifest."""
    manifest = json.loads(_get(RELEASE_BASE + "manifest.json", timeout=30))
    if manifest.get("schema_version") not in SUPPORTED_SCHEMA:
        raise RuntimeError(f"aspa-validation schema_version {manifest.get('schema_version')!r} not supported")
    work.mkdir(parents=True, exist_ok=True)
    (work / "manifest.json").write_text(json.dumps(manifest, indent=2))
    for key in ("invalid_pairs", "hygiene"):
        meta = manifest["files"][key]
        data = _get(RELEASE_BASE + meta["asset"], timeout=120)
        if len(data) != meta["bytes"] or hashlib.sha256(data).hexdigest() != meta["sha256"]:
            raise RuntimeError(f"{meta['asset']}: size or sha256 differs from the manifest")
        (work / meta["asset"]).write_bytes(data)
        print(f"downloaded aspa-validation {meta['asset']}: {len(data) / 1e3:.0f} kB, as of {manifest.get('as_of')}")


def pairs_doc(raw: dict) -> dict:
    """aspa-validation's invalid_pairs document -> the page's compact one (side "origin" only)."""
    if raw.get("schema_version") not in SUPPORTED_SCHEMA:
        raise ValueError(f"schema_version {raw.get('schema_version')!r}")
    rows = [r for r in raw["invalid_pairs"] if r.get("side") == "origin"]
    for r in rows:
        if not (isinstance(r.get("customer"), int) and isinstance(r.get("provider"), int)
                and isinstance(r.get("invalid_paths"), int)):
            raise ValueError(f"bad pair {r!r}")
    rows.sort(key=lambda r: (-r["invalid_paths"], -r.get("routes", 0), r["customer"], r["provider"]))
    counts = raw.get("counts", {})
    return {
        "schema_version": 1, "source": RELEASE_BASE + "invalid_pairs.json.gz",
        "generated_at": raw.get("generated_at"), "as_of": raw.get("as_of"), "feeds_total": raw.get("feeds_total"),
        "built": now_ist(), "paths_verified": counts.get("paths_verified"), "pairs_total": len(raw["invalid_pairs"]),
        "fields": list(FIELDS), "pairs": [[r.get(f) for f in FIELDS] for r in rows],
    }


def build(work: Path, out: Path) -> bool:
    """Write data/validation/invalid_pairs.json; False (nothing written) when the download is missing or wrong."""
    src = work / "invalid_pairs.json.gz" if work else None
    if not src or not src.exists():
        print("warning: no aspa-validation pairs; /aspa/ falls back to BGPKIT's top pairs")
        return False
    try:
        doc = pairs_doc(json.loads(gzip.decompress(src.read_bytes())))
    except (ValueError, KeyError, OSError) as e:
        print(f"warning: aspa-validation pairs unusable ({e}); /aspa/ falls back to BGPKIT's top pairs")
        return False
    out.mkdir(parents=True, exist_ok=True)
    data = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    (out / "invalid_pairs.json").write_bytes(data)
    print(f"aspa-validation pairs: {len(doc['pairs'])} (side origin), {len(data) / 1e3:.0f} kB, as of {doc['as_of']}")
    return True


GROUPS = ("match", "over_declared_only", "under_declared", "under_and_over", "not_visible", "as0")
EVIDENCE = ("strong", "partial", "weak")
SUMMARY_FIELDS = ("asn", "rir", "cc", "group", "evidence", "missing", "seen")
BUCKETS = 100


def hygiene_docs(raw: dict) -> tuple:
    """aspa-validation's hygiene document -> (summary for lists and counts, {bucket: {asn: full entry}})."""
    if raw.get("schema_version") not in SUPPORTED_SCHEMA:
        raise ValueError(f"schema_version {raw.get('schema_version')!r}")
    rows, missing, buckets = [], {}, {}
    for a in raw["asns"]:
        if not isinstance(a.get("asn"), int) or a.get("group") not in GROUPS:
            raise ValueError(f"bad entry {str(a)[:120]}")
        obs = {o["asn"]: o for o in a.get("observed", [])}
        rows.append([a["asn"], a.get("rir"), a.get("cc"), a["group"], a.get("evidence"), len(a.get("missing", [])),
                     len(obs)])
        if a.get("missing"):
            missing[str(a["asn"])] = [[m, obs.get(m, {}).get("feeds"), obs.get(m, {}).get("share"),
                                       obs.get(m, {}).get("evidence"), obs.get(m, {}).get("first_observed")]
                                      for m in a["missing"]]
        buckets.setdefault(a["asn"] % BUCKETS, {})[str(a["asn"])] = a
    inputs = raw.get("inputs", {})
    summary = {
        "schema_version": 1, "source": RELEASE_BASE + "hygiene.json.gz", "built": now_ist(),
        "generated_at": raw.get("generated_at"), "as_of": raw.get("as_of"), "feeds_total": raw.get("feeds_total"),
        "evidence_thresholds": raw.get("evidence_thresholds"),
        "inputs": {k: inputs.get(k) for k in ("caida_citation", "caida_file", "ris_as_of", "rpki_as_of", "aspa_history_as_of")},
        "fields": list(SUMMARY_FIELDS), "asns": rows, "missing": missing,
    }
    if not summary["inputs"]["caida_citation"]:
        raise ValueError("no caida_citation (CAIDA's terms require showing it)")
    return summary, buckets


def build_hygiene(work: Path, out: Path) -> bool:
    """Write data/validation/hygiene/; False (nothing written) when the download is missing or wrong."""
    src = work / "hygiene.json.gz" if work else None
    if not src or not src.exists():
        print("warning: no aspa-validation hygiene; /hygiene/ will say the data is not available")
        return False
    try:
        summary, buckets = hygiene_docs(json.loads(gzip.decompress(src.read_bytes())))
    except (ValueError, KeyError, OSError) as e:
        print(f"warning: aspa-validation hygiene unusable ({e}); /hygiene/ will say the data is not available")
        return False
    dest = out / "hygiene"
    (dest / "asn").mkdir(parents=True, exist_ok=True)
    dump = lambda doc: json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    total = len(data := dump(summary))
    (dest / "summary.json").write_bytes(data)
    for i in range(BUCKETS):
        total += len(data := dump(buckets.get(i, {})))
        (dest / "asn" / f"{i}.json").write_bytes(data)
    print(f"aspa-validation hygiene: {len(summary['asns'])} ASNs, {total / 1e6:.1f} MB, as of {summary['as_of']}")
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("download")
    d.add_argument("--work", type=Path, required=True)
    args = ap.parse_args(argv)
    if args.cmd == "download":
        download(args.work)
    return 0


if __name__ == "__main__":
    sys.exit(main())
