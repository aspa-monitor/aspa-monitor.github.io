// ASPA hygiene page: pure helpers over data/validation/hygiene/ (built by pipeline/validation.py from
// aspa-validation's hygiene.json.gz). No DOM; tests in tests/js/hygienedata.test.mjs.

export const RIRS = [["apnic", "APNIC"], ["afrinic", "AFRINIC"], ["arin", "ARIN"], ["lacnic", "LACNIC"],
  ["ripencc", "RIPE NCC"], ["all", "All registries"]];

// What each group means, in neutral words: this describes routing data, not intent.
export const GROUPS = {
  under_declared: { name: "Observed provider not in ASPA", tone: "warn",
    text: "An upstream that CAIDA labels a provider was seen in our feeds, and the ASPA does not list it." },
  under_and_over: { name: "Observed provider not in ASPA, listed one not seen", tone: "warn",
    text: "As above, and the ASPA also lists a provider that was not seen (allowed; often a backup)." },
  as0: { name: "ASPA says no providers (AS0)", tone: "info",
    text: "The ASPA lists only AS0, meaning the AS has no providers. Upstreams seen are still shown." },
  over_declared_only: { name: "Lists providers not seen", tone: "ok",
    text: "Every provider seen is in the ASPA; it also lists some that were not seen (allowed; often backups)." },
  match: { name: "Matches what we see", tone: "ok",
    text: "The ASPA lists exactly the providers seen in our feeds." },
  not_visible: { name: "No upstream seen", tone: "info",
    text: "None of our feeds saw a route from this AS through an upstream, so there is nothing to compare." },
};
export const GROUP_ORDER = ["under_declared", "under_and_over", "as0", "over_declared_only", "match", "not_visible"];
const EVIDENCE_RANK = { strong: 0, partial: 1, weak: 2 };

/** summary.json -> rows [{asn, rir, cc, group, evidence, missing, seen}]; null if it isn't a version-1 summary. */
export function summaryRows(doc) {
  if (!doc || doc.schema_version !== 1 || !Array.isArray(doc.asns) || !Array.isArray(doc.fields)) return null;
  const at = Object.fromEntries(doc.fields.map((f, i) => [f, i]));
  return doc.asns.map((r) => ({ asn: r[at.asn], rir: r[at.rir], cc: r[at.cc], group: r[at.group],
    evidence: r[at.evidence], missing: r[at.missing], seen: r[at.seen] }));
}

export const inScope = (rows, rir, cc = "") =>
  rows.filter((r) => (rir === "all" || r.rir === rir) && (!cc || r.cc === cc));

/** Count of each group, plus total. */
export function groupCounts(rows) {
  const out = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0]));
  for (const r of rows) if (r.group in out) out[r.group]++;
  out.total = rows.length;
  return out;
}

/** Per country: [{cc, total, missing (ASes with an observed provider not in ASPA), ...groups}], most ASPAs first. */
export function byCountry(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.cc)) m.set(r.cc, { cc: r.cc, ...groupCounts([]), missing: 0 });
    const c = m.get(r.cc);
    c.total++;
    if (r.group in c) c[r.group]++;
    if (r.missing) c.missing++;
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.missing - a.missing || a.cc.localeCompare(b.cc));
}

/**
 * ASes with an observed provider not in their ASPA, with those providers ({asn, feeds, share, evidence, first}).
 * Returns {confirmed, weak}: weak = only weak evidence (seen by few feeds; cannot be confirmed from collector data).
 * Each list: strongest evidence first, then the largest share of routes through a missing provider.
 */
export function missingLists(rows, missingByAsn) {
  const items = rows.filter((r) => r.missing).map((r) => {
    const providers = (missingByAsn[String(r.asn)] || []).map(([asn, feeds, share, evidence, first]) =>
      ({ asn, feeds, share, evidence, first }))
      .sort((a, b) => (EVIDENCE_RANK[a.evidence] ?? 3) - (EVIDENCE_RANK[b.evidence] ?? 3) || (b.share ?? 0) - (a.share ?? 0));
    return { ...r, providers, top: Math.max(0, ...providers.map((p) => p.share ?? 0)) };
  });
  const order = (a, b) => (EVIDENCE_RANK[a.evidence] ?? 3) - (EVIDENCE_RANK[b.evidence] ?? 3) || b.top - a.top || a.asn - b.asn;
  return {
    confirmed: items.filter((i) => i.evidence === "strong" || i.evidence === "partial").sort(order),
    weak: items.filter((i) => i.evidence !== "strong" && i.evidence !== "partial").sort(order),
  };
}

export const shardOf = (asn) => Number(asn) % 100;
