// ASPA path verification (draft-ietf-sidrops-aspa-verification), run in the browser on the site's own copy
// of the validated ASPAs (/data/aspa/aspas.json, from pipeline/aspa.py). Pure functions apart from loadAspas().
//
// RIS collectors receive every peer's full table, so each path is checked as a route received from a provider
// (the draft's "downstream" procedure, the same view BGPKIT and Cloudflare Radar take for collector data):
// from the origin the path may climb through authorised providers, then descend through authorised providers
// to the peer. Prepends are collapsed first; a path with an AS_SET is Invalid.

/** Pair check. x sent the route to y. "P": x's ASPA lists y (Provider+), "N": x has an ASPA without y
 *  (Not Provider+), "U": x has no ASPA (No Attestation). */
export function hop(aspas, x, y) {
  const p = aspas.get(String(x));
  if (!p) return "U";
  return p.has(String(y)) ? "P" : "N";
}

const asl = (a) => `AS${a}`;

/**
 * hops: the collapsed path, peer first and origin last (as pathgraph's hops() returns it).
 * Returns {verdict: "valid" | "invalid" | "unknown", reason, pairs, culprits, ramps}
 *   ramps: {maxUp, minUp, maxDown, minDown} as the draft (and Cloudflare Radar) count them; null for N <= 2.
 *   pairs: one per neighbouring pair in path order (peer side first): {near, far, up, down, mark, text}
 *     near = the AS nearer the peer, far = the AS nearer the origin; the route went far -> near.
 *     up = hop(far, near) (near is far's provider), down = hop(near, far) (far is near's provider).
 *     mark: "ok" (authorised one way or the other), "bad" (where the path breaks), "none" (no ASPA to check).
 */
export function verifyPath(aspas, hops) {
  const seq = [...hops].reverse(); // the draft's AS(1) = origin ... AS(N) = the peer
  const N = seq.length;
  const pairs = [];
  for (let i = 0; i < hops.length - 1; i++) {
    const near = hops[i], far = hops[i + 1];
    pairs.push({ near, far, up: hop(aspas, far, near), down: hop(aspas, near, far), mark: "none" });
  }
  for (const p of pairs) if (p.up === "P" || p.down === "P") p.mark = "ok";
  let ramps = null;
  const finish = (verdict, reason, culprits = []) => {
    for (const c of culprits) c.mark = "bad";
    for (const p of pairs) p.text = pairText(aspas, p);
    return { verdict, reason, pairs, culprits, ramps };
  };

  if (hops.some((h) => String(h).startsWith("{"))) {
    return finish("invalid", "The path contains an AS_SET, which ASPA verification treats as invalid.");
  }
  if (N <= 2) {
    return finish("valid", N === 1
      ? "The peer originates the prefix itself."
      : "A path of two ASes always passes for a route received from a provider.");
  }
  // Ramps, counted in ASes, with the draft's names: the up-ramp climbs from the origin, the down-ramp from the
  // peer. "max" runs until a pair is Not Provider+ (as far as the path could climb); "min" runs only while
  // pairs are Provider+ (as far as ASPA proves it climbs).
  const ramp = (pair, ok) => {
    let k = 1;
    while (k < N && ok(pair(k))) k++;
    return k;
  };
  const upPair = (k) => hop(aspas, seq[k - 1], seq[k]);         // AS(k) -> AS(k+1)
  const downPair = (k) => hop(aspas, seq[N - k], seq[N - k - 1]); // AS(N-k+1) -> AS(N-k)
  const maxUp = ramp(upPair, (h) => h !== "N"), maxDown = ramp(downPair, (h) => h !== "N");
  const minUp = ramp(upPair, (h) => h === "P"), minDown = ramp(downPair, (h) => h === "P");
  ramps = { maxUp, minUp, maxDown, minDown };

  if (minUp + minDown >= N) {
    return finish("valid", "Every pair is authorised: the path climbs from the origin through providers listed in " +
      "ASPAs and comes down to the peer the same way.");
  }
  if (maxUp + maxDown < N) {
    // The climb from the origin stops at AS(maxUp) -> AS(maxUp+1), the one from the peer at AS(N-maxDown+1) -> AS(N-maxDown).
    const pairOf = (a, b) => pairs.find((p) => (p.far === a && p.near === b) || (p.far === b && p.near === a));
    const ua = seq[maxUp - 1], ub = seq[maxUp], da = seq[N - maxDown], db = seq[N - maxDown - 1];
    const culprits = [...new Set([pairOf(ua, ub), pairOf(da, db)].filter(Boolean))];
    const what = (a, b) => (aspas.get(String(a))?.has("0") ? `${asl(a)}'s ASPA says it has no providers`
      : `${asl(a)}'s ASPA does not list ${asl(b)}`);
    const reason = ua === db && ub === da
      ? `${what(ua, ub)}, and ${what(da, db)}: neither may send this route to the other.`
      : `Climbing from the origin, ${what(ua, ub)}; climbing from the peer, ${what(da, db)}. ` +
        "The path has a valley, which suggests a route leak (or an ASPA that is out of date).";
    return finish("invalid", reason, culprits);
  }
  const missing = [...new Set(seq.filter((a) => !aspas.has(String(a))))];
  return finish("unknown", "Nothing on the path contradicts ASPA, but not enough ASes have published one to prove " +
    `it valid${missing.length ? ` (no ASPA from ${missing.map(asl).join(", ")})` : ""}.`);
}

function pairText(aspas, { near, far, up, down, mark }) {
  if (String(near).startsWith("{") || String(far).startsWith("{")) return "AS_SET: not checked";
  if (up === "P" && down === "P") return `${asl(far)} and ${asl(near)} list each other as providers`;
  if (up === "P") return `${asl(far)} lists ${asl(near)} as a provider (route sent up)`;
  if (down === "P") return `${asl(near)} lists ${asl(far)} as a provider (route sent down)`;
  const side = (a, b, h) => (h === "U" ? `${asl(a)} has no ASPA`
    : aspas.get(String(a))?.has("0") ? `${asl(a)}'s ASPA says it has no providers` : `${asl(a)}'s ASPA does not list ${asl(b)}`);
  const noProviders = (a) => aspas.get(String(a))?.has("0");
  if (up === "N" && down === "N" && !noProviders(far) && !noProviders(near)) {
    return `neither ${asl(far)} nor ${asl(near)} lists the other as a provider` +
      (mark === "bad" ? "" : " (fine only as a peering link at the top of the path)");
  }
  const s1 = side(far, near, up), s2 = side(near, far, down);
  return s1 === s2 ? s1 : `${s1}; ${s2}`;
}

/** {verdict, label} for display. */
export const VERDICT_LABEL = { valid: "Valid", invalid: "Invalid", unknown: "Unknown" };

/** aspas.json -> {map: Map<"customer AS", Set<"provider AS">>, sourceTime, reusedAt}. One fetch per page load. */
export function parseAspas(doc) {
  if (!doc || doc.schema_version !== 1 || !doc.aspas) throw new Error("unexpected ASPA file");
  const map = new Map();
  for (const [c, ps] of Object.entries(doc.aspas)) map.set(String(c), new Set(ps.map(String)));
  return { map, sourceTime: doc.source_time || null, reusedAt: doc.reused_at || null };
}

let loading = null;
export function loadAspas() {
  loading ||= fetch("/data/aspa/aspas.json").then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }).then(parseAspas);
  loading.catch(() => { loading = null; }); // try again on the next lookup
  return loading;
}
