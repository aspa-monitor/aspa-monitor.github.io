// Inferred AS relationships for the second ("relationships") map on /lookup/, from BGPKIT's as2rel API
// (daily snapshot, inferred from observed paths, so not authoritative). Shown next to ASPA so the two can be
// compared: when the data says "customer of" but the customer's ASPA leaves that provider out, the ASPA is
// probably out of date rather than the path being a leak. Pure functions apart from relation().
import { api } from "./bgpkit.js";

/** Kinds for a drawn line where the route went far -> near (far is nearer the origin). */
export const REL = {
  up: { glyph: "↑", name: "customer → provider", text: (f, n) => `AS${f} is a customer of AS${n} (route sent up)` },
  down: { glyph: "↓", name: "provider → customer", text: (f, n) => `AS${f} is a provider of AS${n} (route sent down)` },
  peer: { glyph: "↔", name: "peers", text: (f, n) => `AS${f} and AS${n} look like peers (no transit seen either way)` },
  mixed: { glyph: "≈", name: "mixed", text: (f, n) => `AS${f} and AS${n} show transit both ways (often sister networks)` },
  unknown: { glyph: "?", name: "not known", text: (f, n) => `no relationship known for AS${f} and AS${n}` },
};

/** BGPKIT answer for ?asn=far&other=near -> one of REL's keys. "downstream" means asn is the customer. */
export function kindOf(answer) {
  const r = answer?.data?.[0]?.relation;
  return { downstream: "up", upstream: "down", adjacent: "peer", mixed: "mixed" }[r] || "unknown";
}

/**
 * Compare the inferred relationship with ASPA for the same pair (a verifyPath() pair: up = far's ASPA lists
 * near, down = near's ASPA lists far; "P" yes, "N" no, "U" no ASPA). Returns null when there is nothing to
 * say, or {text} when they disagree in a way worth a look.
 */
export function aspaDisagrees(kind, pair, far, near) {
  if (!pair) return null;
  if (kind === "up" && pair.up === "N") {
    return { text: `The data says AS${far} buys transit from AS${near}, but AS${far}'s ASPA does not list it: ` +
      "the ASPA may be out of date." };
  }
  if (kind === "down" && pair.down === "N") {
    return { text: `The data says AS${near} buys transit from AS${far}, but AS${near}'s ASPA does not list it: ` +
      "the ASPA may be out of date." };
  }
  return null;
}

// ---------- fetching: one request per pair, at most 6 at a time, cached (sessionStorage via bgpkit.js) ----------

const MAX_PARALLEL = 6;
const pending = new Map();
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

/** {kind, date} for the line far -> near. */
export function relation(far, near) {
  const key = `${far}>${near}`;
  if (!pending.has(key)) {
    const p = new Promise((resolve, reject) => {
      queue.push(() => api(`as2rel?asn=${far}&other=${near}`, "routing")
        .then((a) => resolve({ kind: kindOf(a), date: a?.meta?.snapshot_date || null }), reject));
      pump();
    });
    p.catch(() => pending.delete(key)); // try again on the next lookup
    pending.set(key, p);
  }
  return pending.get(key);
}
