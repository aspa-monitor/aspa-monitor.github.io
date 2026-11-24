"""Download the latest ris-routing-data release (server-side; browsers can't read Release assets).

    python -m pipeline.ris.fetch check --live-url URL   # is there newer data than the live site?
    python -m pipeline.ris.fetch download --work DIR    # manifest + routes/paths/meta, sha256-checked
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from pipeline.timefmt import parse_iso

RELEASE_BASE = "https://github.com/aspa-monitor/ris-routing-data/releases/download/latest/"
SUPPORTED_SCHEMA = {1}
USER_AGENT = "aspa-monitor-portal (+https://aspa-monitor.github.io/)"


class SchemaError(RuntimeError):
    pass


def _get(url: str, timeout: int = 60, tries: int = 4) -> bytes:
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == tries:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == tries:
                raise
        time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def check_manifest(manifest: dict) -> None:
    version = manifest.get("schema_version")
    if version not in SUPPORTED_SCHEMA:
        raise SchemaError(
            f"ris-routing-data schema_version {version!r} not supported "
            f"(supported: {sorted(SUPPORTED_SCHEMA)}); update pipeline/ris before deploying"
        )
    if not manifest.get("sources"):
        raise SchemaError("manifest lists no sources")
    for src in manifest["sources"]:
        for kind in ("routes", "paths"):
            if kind not in src.get("files", {}):
                raise SchemaError(f"source {src.get('name')!r} has no {kind} file")
        parse_iso(src["as_of"])
    parse_iso(manifest["generated_at"])


def fetch_manifest() -> dict:
    manifest = json.loads(_get(RELEASE_BASE + "manifest.json"))
    check_manifest(manifest)
    return manifest


def live_upstream_generated_at(live_url: str):
    """generated_at of the upstream manifest the live site was built from, or None."""
    try:
        live = json.loads(_get(live_url, timeout=30, tries=2))
        return parse_iso(live["upstream"]["generated_at"])
    except Exception as e:  # first deploy, site down, old format: just rebuild
        print(f"live manifest not usable ({e}); treating data as changed")
        return None


def download_asset(name: str, expected: dict, dest: Path) -> None:
    data = _get(RELEASE_BASE + name, timeout=300)
    if len(data) != expected["bytes"]:
        raise RuntimeError(f"{name}: {len(data)} bytes, manifest says {expected['bytes']}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected["sha256"]:
        raise RuntimeError(f"{name}: sha256 {digest} != manifest {expected['sha256']}")
    dest.write_bytes(data)


def download(work: Path) -> dict:
    work.mkdir(parents=True, exist_ok=True)
    manifest = fetch_manifest()
    for src in manifest["sources"]:
        for kind in ("routes", "paths"):
            f = src["files"][kind]
            print(f"downloading {f['asset']} ({f['bytes'] / 1e6:.1f} MB)")
            download_asset(f["asset"], f, work / f["asset"])
        if src.get("meta"):
            try:
                (work / src["meta"]).write_bytes(_get(RELEASE_BASE + src["meta"]))
            except Exception as e:  # meta is informational only
                print(f"warning: meta {src['meta']} not downloaded: {e}")
    # Write the manifest last so a partial download never looks complete.
    (work / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def _set_output(key: str, value: str) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write(f"{key}={value}\n")
    print(f"{key}={value}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("--live-url", required=True)
    d = sub.add_parser("download")
    d.add_argument("--work", type=Path, required=True)
    args = ap.parse_args(argv)

    try:
        if args.cmd == "check":
            upstream = fetch_manifest()
            live = live_upstream_generated_at(args.live_url)
            new = parse_iso(upstream["generated_at"])
            changed = live is None or new > live
            print(f"upstream generated_at {upstream['generated_at']}, live {live.isoformat() if live else None}")
            _set_output("changed", "true" if changed else "false")
        else:
            download(args.work)
    except SchemaError as e:
        print(f"::error::{e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
