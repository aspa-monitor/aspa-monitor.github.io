// AS names, fetched live from RIPEstat (it allows CORS) and cached in localStorage for 7 days.
import { asnCategory } from "./flags.js";

const API = "https://stat.ripe.net/data/as-overview/data.json";
const KEY = "asname:";
const TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_PARALLEL = 6;

const pending = new Map(); // asn -> Promise<string|null>
const queue = [];
let running = 0;

function cached(asn) {
  try {
    const raw = localStorage.getItem(KEY + asn);
    if (!raw) return undefined;
    const { n, t } = JSON.parse(raw);
    if (Date.now() - t > TTL_MS) return undefined;
    return n;
  } catch {
    return undefined;
  }
}

function store(asn, name) {
  try {
    localStorage.setItem(KEY + asn, JSON.stringify({ n: name, t: Date.now() }));
  } catch {
    /* storage full or disabled: just don't cache */
  }
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const { asn, resolve } = queue.shift();
    running++;
    fetch(`${API}?resource=AS${asn}&sourceapp=aspa-monitor`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        const name = (j && j.data && j.data.holder) || "";
        store(asn, name);
        resolve(name);
      })
      .catch(() => resolve(null)) // not cached: retry on the next page load
      .finally(() => {
        running--;
        pump();
      });
  }
}

/** Name of an AS ("" if RIPEstat has none, null if the request failed). */
export function asName(asn) {
  const special = asnCategory(asn);
  if (special) {
    return Promise.resolve({ private: "private-use ASN", reserved: "reserved ASN", as_trans: "AS_TRANS placeholder" }[special]);
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
  const els = root.querySelectorAll("[data-asn]");
  for (const el of els) {
    const asn = Number(el.dataset.asn);
    const target = el.querySelector(".asname");
    if (!target || target.dataset.filled) continue;
    target.dataset.filled = "1";
    asName(asn).then((name) => {
      if (name) {
        target.textContent = name;
        el.title = `AS${asn} ${name}`;
      } else if (name === null) {
        target.textContent = "";
        el.title = `AS${asn} (name lookup failed)`;
      }
    });
  }
}
