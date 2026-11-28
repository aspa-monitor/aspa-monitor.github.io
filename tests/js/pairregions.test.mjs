import { test } from "node:test";
import assert from "node:assert/strict";
import { regionIndex, pairsIn, ownPairs, OWN_INDEX, PAIR_REGIONS, markHop, detailsKey } from "../../site/assets/pairregions.js";

const doc = { cc: { IN: [[9583, 3], [133000, 10]], JP: [[173, 1]], AU: [[1221, 1]] } };
const row = (customer_asn) => ({ customer_asn });

test("regionIndex: India and the whole APNIC region from delegated ranges (BGPKIT fallback)", () => {
  const ix = regionIndex(doc);
  assert.equal(ix.IN(row(9585)), true);
  assert.equal(ix.IN(row(9586)), false);
  assert.equal(ix.IN(row("133009")), true);
  assert.equal(ix.AP(row(173)), true);
  assert.equal(ix.AP(row(1221)), true);
  assert.equal(ix.AP(row(7018)), false);
  assert.equal(regionIndex(null), null);
  assert.equal(regionIndex({ cc: {} }), null);
  assert.deepEqual(PAIR_REGIONS.map(([k]) => k), ["IN", "AP", "world"]);
});

test("pairsIn filters on the customer AS and sorts by invalid paths", () => {
  const rows = [
    { customer_asn: 7018, provider_asn: 1, invalid_paths: 900, invalid_observations: 1 },
    { customer_asn: 9583, provider_asn: 7018, invalid_paths: 5, invalid_observations: 9 }, // Indian customer, US provider
    { customer_asn: 133001, provider_asn: 2, invalid_paths: 50, invalid_observations: 1 },
    { customer_asn: 173, provider_asn: 9583, invalid_paths: 50, invalid_observations: 7 }, // Indian provider only
  ];
  const ix = regionIndex(doc);
  assert.deepEqual(pairsIn(rows, "IN", ix).map((r) => r.customer_asn), [133001, 9583]);
  assert.deepEqual(pairsIn(rows, "AP", ix).map((r) => r.customer_asn), [173, 133001, 9583]); // tie on paths: observations
  assert.deepEqual(pairsIn(rows, "world", ix).map((r) => r.customer_asn), [7018, 173, 133001, 9583]);
  assert.equal(pairsIn(rows, "IN", null).length, 4); // no region data: everything
});

test("ownPairs reads the portal's own file; regions come from the customer's country and registry", () => {
  const own = ownPairs({
    schema_version: 1, feeds_total: 16,
    fields: ["customer", "provider", "invalid_paths", "routes", "feeds", "first_observed", "customer_cc", "customer_rir"],
    pairs: [[58717, 153759, 762, 5163, 1, "2026-11-28T20:13:01+05:30", "BD", "apnic"],
      [153292, 140148, 15, 28, 9, "2026-11-28T20:13:01+05:30", "IN", "apnic"],
      [207841, 209735, 15, 90, 3, "2026-11-28T20:13:01+05:30", "DE", "ripencc"]],
  });
  assert.deepEqual(own[1], { customer_asn: 153292, provider_asn: 140148, invalid_paths: 15, routes: 28, feeds: 9,
    first_observed: "2026-11-28T20:13:01+05:30", cc: "IN", rir: "apnic" });
  assert.deepEqual(pairsIn(own, "IN", OWN_INDEX).map((r) => r.customer_asn), [153292]);
  assert.deepEqual(pairsIn(own, "AP", OWN_INDEX).map((r) => r.customer_asn), [58717, 153292]);
  assert.deepEqual(pairsIn(own, "world", OWN_INDEX).map((r) => r.customer_asn), [58717, 207841, 153292]); // tie: routes
  assert.equal(ownPairs({ schema_version: 2, fields: [], pairs: [] }), null);
  assert.equal(ownPairs(null), null);
});

test("markHop marks the customer -> provider hop (provider directly left of the customer)", () => {
  const hops = markHop("151704 153759 58717 24342", 58717, 153759);
  assert.deepEqual(hops.map((h) => h.hop), [false, true, true, false]);
  assert.deepEqual(markHop("7018 174 140148 153292", 153292, 140148).map((h) => h.hop), [false, false, true, true]);
  // Customer not directly after the provider (should not happen): nothing marked rather than a wrong hop.
  assert.deepEqual(markHop("1 2 3", 3, 1).map((h) => h.hop), [false, false, false]);
  assert.deepEqual(markHop("", 1, 2), []);
  assert.deepEqual(detailsKey(58717, 153759), { shard: 17, key: "58717-153759" });
});
