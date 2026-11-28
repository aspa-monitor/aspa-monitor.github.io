"""Assemble the deployable site: static pages from site/ plus generated data/.

    python -m pipeline.build_site --ris-work work/ris --asnames work/asn.txt --aspa work/aspas.json --out _site
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

from pipeline import asnames, aspa
from pipeline.ris import fetch, shard
from pipeline.timefmt import IST, now_ist, parse_iso

REPO = Path(__file__).resolve().parent.parent
PAGES_LIMIT_MB = 1000
DEFAULT_BUDGET_MB = 900


def dir_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def stamp_assets(out: Path) -> str:
    """Add ?v=<hash of assets> to asset URLs, so a deploy never mixes cached old and new files
    (Pages lets browsers cache for 10 minutes)."""
    assets = out / "assets"
    h = hashlib.sha256()
    for f in sorted(assets.rglob("*")):
        if f.is_file():
            h.update(f.name.encode() + f.read_bytes())
    v = h.hexdigest()[:10]
    for page in out.rglob("*.html"):
        text = page.read_text()
        text = re.sub(r'(/assets/[\w.-]+\.(?:js|css))"', rf'\1?v={v}"', text)
        page.write_text(text)
    for js in assets.glob("*.js"):
        text = js.read_text()
        text = re.sub(r'from "(\./[\w.-]+\.js)"', rf'from "\1?v={v}"', text)
        js.write_text(text)
    return v


BUILT_MARK = "<!--built-->"


def stamp_built(out: Path, built_at: str) -> None:
    """Write the build time (IST) into every page's footer, where the page has the <!--built--> mark."""
    dt = parse_iso(built_at).astimezone(IST)
    text = f' Portal last built: <time datetime="{built_at}">{dt:%Y-%m-%d %H:%M} IST</time>.'
    for page in out.rglob("*.html"):
        html = page.read_text()
        if BUILT_MARK in html:
            page.write_text(html.replace(BUILT_MARK, text))


# Peer colours are handed out per search in the browser (peergroups.colourSlots), so the manifest carries none.


def build_ris(work: Path, out: Path) -> dict:
    upstream = json.loads((work / "manifest.json").read_text())
    fetch.check_manifest(upstream)
    sources = []
    for src in upstream["sources"]:
        summary = shard.shard_source(src, work, out)
        print(f"{summary['name']}: {summary['routes']} routes, {summary['files']} files, "
              f"{summary['site_bytes'] / 1e6:.1f} MB")
        sources.append(summary)
    manifest = {
        "schema_version": 1,
        "built_at": now_ist(),
        "upstream": {
            "url": fetch.RELEASE_BASE + "manifest.json",
            "schema_version": upstream["schema_version"],
            "generated_at": upstream["generated_at"],
            "as_of": upstream["as_of"],
        },
        "sources": sources,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ris-work", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--asnames", type=Path, help="RIPE asn.txt for backup AS names (optional)")
    ap.add_argument("--aspa", type=Path, help="ASPAs from `pipeline.aspa download` (optional: falls back to the live file)")
    ap.add_argument("--live-aspa-url", default=os.environ.get("LIVE_ASPA_URL", ""),
                    help="live site's data/aspa/aspas.json, reused when the fresh ASPA download is unusable")
    ap.add_argument("--budget-mb", type=int, default=DEFAULT_BUDGET_MB)
    args = ap.parse_args(argv)

    if args.out.exists():
        shutil.rmtree(args.out)
    shutil.copytree(REPO / "site", args.out)
    (args.out / ".nojekyll").write_text("")
    print(f"asset version {stamp_assets(args.out)}")
    manifest = build_ris(args.ris_work, args.out / "data" / "ris")
    stamp_built(args.out, manifest["built_at"])  # same time as the home page's "site built"
    if args.asnames:
        asnames.build(args.asnames, args.out / "data" / "asnames")
    aspa.build(args.aspa, args.out / "data" / "aspa", args.live_aspa_url)

    total_mb = dir_bytes(args.out) / 1e6
    print(f"site total: {total_mb:.1f} MB (budget {args.budget_mb} MB, Pages limit {PAGES_LIMIT_MB} MB)")
    if total_mb > args.budget_mb:
        print(f"::error::site is {total_mb:.0f} MB, over the {args.budget_mb} MB budget", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
