"""Assemble the deployable site: static pages from site/ plus generated data/.

    python -m pipeline.build_site --ris-work work/ris --out _site
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

from pipeline.ris import fetch, shard
from pipeline.timefmt import now_ist

REPO = Path(__file__).resolve().parent.parent
PAGES_LIMIT_MB = 1000
DEFAULT_BUDGET_MB = 900


def dir_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


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
    ap.add_argument("--budget-mb", type=int, default=DEFAULT_BUDGET_MB)
    args = ap.parse_args(argv)

    if args.out.exists():
        shutil.rmtree(args.out)
    shutil.copytree(REPO / "site", args.out)
    (args.out / ".nojekyll").write_text("")
    build_ris(args.ris_work, args.out / "data" / "ris")

    total_mb = dir_bytes(args.out) / 1e6
    print(f"site total: {total_mb:.1f} MB (budget {args.budget_mb} MB, Pages limit {PAGES_LIMIT_MB} MB)")
    if total_mb > args.budget_mb:
        print(f"::error::site is {total_mb:.0f} MB, over the {args.budget_mb} MB budget", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
