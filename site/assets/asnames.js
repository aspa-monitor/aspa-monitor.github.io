// AS names. First choice: RIPEstat as-overview, live (it allows CORS). Backup, when RIPEstat fails,
// times out or has no name: the site's own copy of RIPE NCC's asn.txt (data/asnames/<asn % 100>.json),
// rebuilt hourly. Results are cached in localStorage: 7 days for RIPEstat names, 1 day for backup
// names (so RIPEstat is tried again soon).
import { asnCategory } from "./flags.js";

const API = "https://stat.ripe.net/data/as-overview/data.json";
const BACKUP = "/data/asnames/";
const BUCKETS = 100;
const KEY = "asname2:";
const DAY_MS = 24 * 3600 * 1000;
const TTL = { ripestat: 7 * DAY_MS, backup: DAY_MS, none: DAY_MS };
const TIMEOUT_MS = 8000;
const MAX_PARALLEL = 6;

/**
 * The clearer half of a registered AS name, for tight spaces like graph boxes: "HANDLE - Organisation" becomes
 * "Organisation", and the backup list's trailing country code (", US") goes. Names in the older form without
 * " - " (e.g. "ASGARR Consortium GARR") stay as they are: guessing where the handle ends would cut real names.
 */
export function shortName(name) {
  let s = String(name || "").trim();
  const i = s.indexOf(" - ");
  if (i > 0 && s.slice(i + 3).trim()) s = s.slice(i + 3).trim();
  return s.replace(/,\s*[A-Z]{2}$/, "").trim() || String(name || "");
}

export const SOURCE_LABEL = { ripestat: "RIPEstat", backup: "RIPE NCC AS names list (backup)" };

const pending = new Map(); // asn -> Promise<{name, source}>
const queue = [];
let running = 0;

function cached(asn) {
  try {
    const raw = localStorage.getItem(KEY + asn);
    if (!raw) return undefined;
    const { n, s, t } = JSON.parse(raw);
    if (Date.now() - t > (TTL[s || "none"] || DAY_MS)) return undefined;
    return { name: n, source: s };
  } catch {
    return undefined;
  }
}

function store(asn, result) {
  try {
    localStorage.setItem(KEY + asn, JSON.stringify({ n: result.name, s: result.source, t: Date.now() }));
  } catch {
    /* storage full or disabled: just don't cache */
  }
}

/** Name from RIPEstat: string ("" = RIPEstat has none), or null when the request failed. */
async function fromRipestat(asn) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}?resource=AS${asn}&sourceapp=aspa-monitor`, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.data && j.data.holder) || "";
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const buckets = new Map();
/** Name from the backup list, or "" if not found / not available. */
async function fromBackup(asn) {
  const i = asn % BUCKETS;
  if (!buckets.has(i)) {
    const p = fetch(`${BACKUP}${i}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    buckets.set(i, p);
  }
  const names = await buckets.get(i);
  return names[String(asn)] || "";
}

async function resolveName(asn) {
  const live = await fromRipestat(asn);
  if (live) return { name: live, source: "ripestat" };
  const backup = await fromBackup(asn);
  if (backup) return { name: backup, source: "backup" };
  return { name: "", source: live === null ? null : "none" };
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const { asn, resolve } = queue.shift();
    running++;
    resolveName(asn)
      .then((res) => {
        if (res.source) store(asn, res); // both lookups failed: don't cache, retry next time
        resolve(res);
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

/** {name, source}: source is "ripestat", "backup", "special", "none" (no name anywhere) or null (lookups failed). */
export function asName(asn) {
  const special = asnCategory(asn);
  if (special) {
    const name = { private: "private-use ASN", reserved: "reserved ASN", as_trans: "AS_TRANS placeholder" }[special];
    return Promise.resolve({ name, source: "special" });
  }
  const hit = cached(asn);
  if (hit !== undefined) return Promise.resolve(hit);
  if (!pending.has(asn)) {
    pending.set(asn, new Promise((resolve) => queue.push({ asn, resolve })));
    pump();
  }
  return pending.get(asn);
}

/** Fill every [data-asn] element's .asname child under root. */
export function fillNames(root) {
  for (const el of root.querySelectorAll("[data-asn]")) {
    const asn = Number(el.dataset.asn);
    const target = el.querySelector(".asname");
    if (!target || target.dataset.filled) continue;
    target.dataset.filled = "1";
    asName(asn).then(({ name, source }) => {
      target.textContent = name || "";
      if (name) {
        el.title = `AS${asn} ${name}` + (SOURCE_LABEL[source] ? ` (name from ${SOURCE_LABEL[source]})` : "");
        if (source === "backup") target.classList.add("backup");
      } else {
        el.title = source === null ? `AS${asn} (name lookup failed)` : `AS${asn} (no registered name found)`;
      }
    });
  }
}
