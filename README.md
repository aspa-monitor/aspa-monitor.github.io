# ASPA Monitor

The public web portal of the ASPA Monitor project: **https://aspa-monitor.gauravkansal.in/**
(`https://aspa-monitor.github.io/` redirects there).

| Repo | Role |
|---|---|
| [ris-routing-data](https://github.com/aspa-monitor/ris-routing-data) | RIPE RIS → hourly routes / paths / adjacency snapshots (hourly :20 UTC) |
| [rpki-aspa-data](https://github.com/aspa-monitor/rpki-aspa-data) | Validated RPKI ASPA objects (hourly :30 UTC) |
| [aspa-validation](https://github.com/aspa-monitor/aspa-validation) | ASPA verdicts from both datasets (hourly :50 UTC) |
| **aspa-monitor.github.io** (this) | The website. Static pages + data copied from the releases above |

## Pages
- `/lookup/` — RIS prefix lookup. Takes a prefix (exact match, or longest covering prefix) or an IP address
  (longest match), IPv4 or IPv6. Shows each route's AS path (clean and raw), origin, path length, last change (IST),
  communities, OTC, aggregator, AS_SET members and flags with explanations, plus covering and more-specific prefixes.
  Each route gets an RPKI ROV badge (valid / invalid / not found for prefix + origin), live from the BGPKIT API
  (`site/assets/rov.js`, daily RPKI snapshot); for an invalid route the covering ROAs say why (wrong origin or too
  specific for maxLength). Interim, until rpki-aspa-data publishes ROAs.
  An AS path graph merges every peer's path to the matched prefix (`site/assets/pathgraph.js`); peers that send RIS
  no routes of the queried family (e.g. IPv4-only peers) are left out. Peers whose paths are the same after their own
  AS share one box and one set of lines (the first peer's colour), worked out fresh for every search
  (`site/assets/peergroups.js`). With more than 6 distinct paths the graph shows the 6 that add the most ASes, with a
  "Show all" button; the per-peer route sections below always list every peer. Graph boxes show the organisation
  part of an AS name ("AT&T Enterprises, LLC" from "ATT-INTERNET4 - AT&T Enterprises, LLC"; full name in the tooltip),
  and the origin box carries the same RPKI ROV verdict as the route cards, outlined green (valid), red (invalid) or
  grey (not found). AS numbers are plain chips, not links.
  Each route also gets an **ASPA** verdict (valid / invalid / unknown, with the reason and a pair-by-pair breakdown),
  worked out in the browser from the site's own ASPA copy (`site/assets/aspapath.js`, draft-ietf-sidrops-aspa-verification).
  RIS collectors get every peer's full table, so paths are checked as routes received from a provider (the draft's
  downstream procedure, as BGPKIT and Cloudflare Radar do for collector data). Verdicts and ramp lengths were checked
  against Cloudflare Radar's ASPA validator on sample paths. The graph's peer chips carry the verdict and the caption
  counts them; peers whose verdicts differ are never merged into one box. Lines between boxes carry pair marks:
  a red ✗ where a drawn path breaks ASPA (always shown) and a green ✓ for an authorised pair (shown on the
  highlighted path only, to keep the graph readable).
  **Trial:** a second map, "AS relationships (inferred)", draws the same paths with one line per AS pair coloured by
  the relationship BGPKIT infers from observed routes (`/v4/routing/as2rel`, daily; `site/assets/asrel.js`):
  ↑ customer → provider, ↓ provider → customer, ↔ peers, ≈ mixed, ? not known. A **!** marks a pair where the data says
  customer → provider but the customer's ASPA leaves that provider out (the ASPA is then probably out of date).
  Remove it by setting `SHOW_REL_MAP = false` in `site/assets/lookup.js`. Shareable URLs: `/lookup/?q=1.10.10.0/24&source=rrc00_AS7018` (`source=all` for all sources).
  AS names are fetched live in the browser from the RIPEstat `as-overview` API (8 s timeout), cached in `localStorage`
  for 7 days. If RIPEstat fails or has no name, the page uses the site's own copy of RIPE NCC's
  [asn.txt](https://ftp.ripe.net/ripe/asnames/asn.txt) (all RIRs), shown in italics and cached for 1 day.
- `/aspa/` — ASPA statistics, interim: fetched live in the browser from the free [BGPKIT API](https://bgpkit.com/api)
  (`site/assets/aspa.js`, client in `site/assets/bgpkit.js`; ASes with ASPA, the day's path verdicts in BGPKIT's five buckets, daily trend, top invalid
  customer/provider pairs, and the ASPA of any AS). Replaced by this project's own verdicts once aspa-validation
  publishes them.
- Colour themes: Auto (follows the system), Daylight, Midnight, Ocean, Sand. Picker in the header (`site/assets/theme.js`),
  saved in `localStorage`; theme colours are CSS variables per `[data-theme]` in `site/assets/style.css`.

## How the data gets here
Browsers can't read GitHub Release assets (no CORS headers), so `.github/workflows/pages.yml` copies them server-side
and deploys GitHub Pages from Actions. **Nothing is committed**: the data only exists in the Pages artifact.

1. Runs hourly at `:35 UTC` (`:05 IST`), on push to `main`, and manually.
   Scheduled runs first compare the upstream `manifest.json` `generated_at` with the one the live site was built from
   (`https://aspa-monitor.gauravkansal.in/data/ris/manifest.json`) and skip the deploy if nothing is new.
2. `pipeline.ris.fetch` downloads `manifest.json`, checks `schema_version` (only `1` is supported; anything else fails
   the job and the old site stays up) and downloads every source's routes/paths/meta, checking size and SHA-256.
3. `pipeline.build_site` copies `site/` and writes `data/ris/` with `pipeline.ris.shard`, then fails if the site is
   over 900 MB (GitHub Pages limit: 1 GB). Today one source is about 131 MB.

## Data layout (`/data/ris/`)
```
manifest.json                 sources, upstream generated_at / as_of, build time (IST)
                              (per source, optional display_name / collector_location from ris-routing-data:
                              the page shows "AT&T (AS7018)", grouped by "rrc00 · Amsterdam"; else "rrc00 · peer AS7018")
<source>/index.json           blocks per family: {"<id>": {"n": routes in file, "t": routes in subtree, "k": split bits}}
<source>/meta.json            ris-routing-data meta for the source
<source>/v4/<id>.json.gz      one address block, gzip-compressed JSON (the page decompresses it); v6/ likewise
../asnames/<asn % 100>.json   backup AS names {"<asn>": "<name>"}, rebuilt every deploy (step skipped if asn.txt fails)
../aspa/aspas.json            validated ASPAs {"aspas": {"<customer AS>": [provider AS, ...]}, source_time, built, counts}
```
ASPAs (interim, until rpki-aspa-data publishes its own): `pipeline.aspa` downloads Cloudflare's public rpki-client output
(`rpki.cloudflare.com/rpki.json`, all five RIRs), keeps only the ASPAs (about 4,400 customers, 130 kB) and drops expired
ones. A provider list of `[0]` means the customer has no providers. If the download fails or looks wrong (bad entries,
fewer than 2,000 ASPAs), the build reuses the live site's `aspas.json`, which keeps its original `source_time`.
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
python3 -m pipeline.asnames download --out work/asn.txt
python3 -m pipeline.aspa download --out work/aspas.json
python3 -m pipeline.build_site --ris-work work/ris --asnames work/asn.txt --aspa work/aspas.json --out _site
python3 -m http.server 8765 --directory _site      # http://localhost:8765/lookup/
python3 -m unittest discover -s tests -t .
node --test tests/js/*.test.mjs
```
No dependencies beyond the Python 3.12+ standard library (and Node 22 for the JS tests).

## Setup (once)
- Repository Settings → Pages → Source: **GitHub Actions**.
- Custom domain `aspa-monitor.gauravkansal.in`: DNS `CNAME` record → `aspa-monitor.github.io`, domain set in
  Settings → Pages (with "Enforce HTTPS"). With Actions deployments GitHub ignores a `CNAME` file, so there is none.
- The domain is hard-coded in: `site/*.html` (`canonical`, `og:url`, JSON-LD `url`), `site/robots.txt`,
  `site/sitemap.xml`, `LIVE_MANIFEST_URL` / `LIVE_ASPA_URL` in `.github/workflows/pages.yml` and `USER_AGENT` in `pipeline/ris/fetch.py`.
  Pages and data use root-relative links (`/lookup/`, `/data/...`), so nothing else changes with the domain.
