// India / AP region / World choice for the /aspa/ page's invalid customer/provider pairs. The choice is about the
// customer AS, the network that published the ASPA; the provider can be anywhere.
// Main source: this portal's own pairs (data/validation/invalid_pairs.json, from aspa-validation over our RIS and
// RouteViews feeds), which carry the customer's country and registry. Fallback: BGPKIT's top 200 worldwide, with
// regions from APNIC's delegated statistics (data/asregions/apnic.json). Pure functions; tests in
// tests/js/pairregions.test.mjs.

export const PAIR_REGIONS = [["IN", "India"], ["AP", "AP region (APNIC)"], ["world", "World"]];
export const PAIRS_SHOWN = 20;

const sorted = (ranges) => ranges.map(([s, c]) => [s, s + c - 1]).sort((a, b) => a[0] - b[0]);

function inRanges(asn, ranges) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (asn < ranges[mid][0]) hi = mid - 1;
    else if (asn > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** apnic.json -> {IN(row), AP(row)} on the row's customer_asn (delegated by APNIC to India / at all); null without it. */
export function regionIndex(doc) {
  if (!doc || !doc.cc || !doc.cc.IN) return null;
  const india = sorted(doc.cc.IN);
  const all = sorted(Object.values(doc.cc).flat());
  return {
    IN: (r) => inRanges(Number(r.customer_asn), india),
    AP: (r) => inRanges(Number(r.customer_asn), all),
  };
}

/** The portal's own pairs file -> rows in the same shape as BGPKIT's culprits, plus routes, feeds, cc, rir. */
export function ownPairs(doc) {
  if (!doc || doc.schema_version !== 1 || !Array.isArray(doc.pairs) || !Array.isArray(doc.fields)) return null;
  const at = Object.fromEntries(doc.fields.map((f, i) => [f, i]));
  return doc.pairs.map((p) => ({
    customer_asn: p[at.customer], provider_asn: p[at.provider], invalid_paths: p[at.invalid_paths],
    routes: p[at.routes], feeds: p[at.feeds], first_observed: p[at.first_observed],
    cc: p[at.customer_cc], rir: p[at.customer_rir],
  }));
}

/** Region tests on the own rows' customer country / registry (same values as aspa-validation's hygiene). */
export const OWN_INDEX = { IN: (r) => r.cc === "IN", AP: (r) => r.rir === "apnic" };

/** Rows whose customer is in the region, most invalid paths first (then routes, or BGPKIT's observations). */
export function pairsIn(rows, region, index) {
  const keep = region === "world" || !index ? rows : rows.filter((r) => index[region]?.(r));
  const second = (r) => r.routes ?? r.invalid_observations ?? 0;
  return [...keep].sort((a, b) => b.invalid_paths - a.invalid_paths || second(b) - second(a));
}
