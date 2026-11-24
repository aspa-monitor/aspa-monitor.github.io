# aspa-monitor.github.io

The public web portal of the ASPA Monitor project: https://aspa-monitor.github.io/

| Repo | Role |
|---|---|
| [ris-routing-data](https://github.com/aspa-monitor/ris-routing-data) | RIPE RIS → hourly routes / paths / adjacency snapshots (hourly :20 UTC) |
| [rpki-aspa-data](https://github.com/aspa-monitor/rpki-aspa-data) | Validated RPKI ASPA objects (hourly :30 UTC) |
| [aspa-validation](https://github.com/aspa-monitor/aspa-validation) | ASPA verdicts from both datasets (hourly :50 UTC) |
| **aspa-monitor.github.io** (this) | The website. Static pages + data copied from the releases above |

## Pages
- `/lookup/` — RIS prefix lookup. Takes a prefix (exact match, or longest covering prefix) or an IP address
  (longest match), IPv4 or IPv6. Shows each route's AS path (clean and raw), origin, path length, last change (IST),
  communities, OTC, aggregator, AS_SET members and flags with explanations, plus covering and more-specific prefixes
  and RIPEstat / bgp.tools links. Shareable URLs: `/lookup/?q=1.10.10.0/24&source=rrc00_AS7018` (`source=all` for all sources).
  AS names are fetched live in the browser from the RIPEstat `as-overview` API and cached in `localStorage` for 7 days.
- `/aspa/` — ASPA verdicts (later).

## How the data gets here
Browsers can't read GitHub Release assets (no CORS headers), so `.github/workflows/pages.yml` copies them server-side
and deploys GitHub Pages from Actions. **Nothing is committed**: the data only exists in the Pages artifact.

1. Runs hourly at `:35 UTC` (`:05 IST`), on push to `main`, and manually.
   Scheduled runs first compare the upstream `manifest.json` `generated_at` with the one the live site was built from
   (`/data/ris/manifest.json`) and skip the deploy if nothing is new.
2. `pipeline.ris.fetch` downloads `manifest.json`, checks `schema_version` (only `1` is supported; anything else fails
   the job and the old site stays up) and downloads every source's routes/paths/meta, checking size and SHA-256.
3. `pipeline.build_site` copies `site/` and writes `data/ris/` with `pipeline.ris.shard`, then fails if the site is
   over 900 MB (GitHub Pages limit: 1 GB). Today one source is about 131 MB.

## Data layout (`/data/ris/`)
```
manifest.json                 sources, upstream generated_at / as_of, build time (IST)
<source>/index.json           blocks per family: {"<id>": {"n": routes in file, "t": routes in subtree, "k": split bits}}
<source>/meta.json            ris-routing-data meta for the source
<source>/v4/<id>.json         one address block; v6/ likewise
```
Blocks: `root` holds IPv4 prefixes shorter than /8 (IPv6: /16). Then one block per IPv4 first octet / IPv6 first
16 bits. A block with more than 4,000 routes is split by the next `k` bits (fewest bits that bring each child under
4,000); the parent keeps prefixes shorter than `depth + k`. So every covering prefix of an address sits on the chain
root → /8 → … and a lookup fetches only that chain. Block ids are the block's top bits in hex, plus `-<depth>` when
the depth is not a multiple of 4: IPv4 `103.0.0.0/8` → `67`, `103.160.0.0/11` → `67a-11`, IPv6 `2001::/16` → `2001`.

Each block file is self-contained, with paths referenced by index:
```
{"paths":  [[path, raw_path, length, origin_asn, flags, set_members], ...],
 "routes": [[prefix, peer_index, path_index, origin_asn, communities, otc, aggr_asn, aggr_ip, atomic, timestamp], ...]}
```
`peer_index` points into `index.json` `peers`. `timestamp` is Unix seconds (last change); the page shows it in IST.

## Times
Every time a person sees is IST (UTC+05:30); JSON timestamps are ISO 8601 with `+05:30`. GitHub cron is UTC.

## Local use
```bash
python3 -m pipeline.ris.fetch download --work work/ris
python3 -m pipeline.build_site --ris-work work/ris --out _site
python3 -m http.server 8765 --directory _site      # http://localhost:8765/lookup/
python3 -m unittest discover -s tests -t .
node --test tests/js/*.test.mjs
```
No dependencies beyond the Python 3.12+ standard library (and Node 22 for the JS tests).

## Setup (once)
Repository Settings → Pages → Source: **GitHub Actions**. For the custom domain later
(`aspa-monitor.gauravkansal.in`): add `site/CNAME`, a DNS `CNAME` record to `aspa-monitor.github.io`, and set the
domain in the Pages settings.
