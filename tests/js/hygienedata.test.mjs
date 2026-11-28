import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryRows, inScope, groupCounts, byCountry, missingLists, shardOf, GROUPS, GROUP_ORDER, RIRS }
  from "../../site/assets/hygienedata.js";

const doc = {
  schema_version: 1, feeds_total: 16,
  fields: ["asn", "rir", "cc", "group", "evidence", "missing", "seen"],
  asns: [
    [141476, "apnic", "IN", "under_declared", "partial", 1, 2],
    [151704, "apnic", "IN", "match", null, 0, 3],
    [17747, "apnic", "IN", "under_and_over", "weak", 1, 4],
    [58717, "apnic", "BD", "as0", "strong", 2, 2],
    [3333, "ripencc", "NL", "over_declared_only", null, 0, 1],
    [64500, "arin", "ZZ", "not_visible", null, 0, 0],
  ],
  missing: {
    141476: [[45117, 10, 0.4651, "partial", "2026-11-28T20:08:08+05:30"]],
    17747: [[9498, 2, 0.02, "weak", "2026-11-28T20:08:08+05:30"]],
    58717: [[153759, 1, 0.1, "weak", null], [3491, 12, 0.6, "strong", null]],
  },
};

test("summaryRows and scope: registry, then country", () => {
  const rows = summaryRows(doc);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], { asn: 141476, rir: "apnic", cc: "IN", group: "under_declared", evidence: "partial", missing: 1, seen: 2 });
  assert.equal(inScope(rows, "apnic").length, 4);
  assert.equal(inScope(rows, "apnic", "IN").length, 3);
  assert.equal(inScope(rows, "all").length, 6);
  assert.equal(summaryRows({ ...doc, schema_version: 2 }), null);
  assert.equal(RIRS[0][0], "apnic"); // the page's default
  assert.deepEqual(Object.keys(GROUPS).sort(), [...GROUP_ORDER].sort());
});

test("groupCounts and byCountry", () => {
  const rows = inScope(summaryRows(doc), "apnic");
  const c = groupCounts(rows);
  assert.equal(c.total, 4);
  assert.equal(c.under_declared + c.under_and_over, 2);
  const ccs = byCountry(rows);
  assert.deepEqual(ccs.map((x) => [x.cc, x.total, x.missing, x.match]), [["IN", 3, 2, 1], ["BD", 1, 1, 0]]);
});

test("missingLists: weak-only cases apart; strongest evidence, then largest share first", () => {
  const { confirmed, weak } = missingLists(summaryRows(doc), doc.missing);
  assert.deepEqual(confirmed.map((i) => i.asn), [58717, 141476]); // strong before partial
  assert.deepEqual(confirmed[0].providers.map((p) => p.asn), [3491, 153759]); // strong provider listed first
  assert.deepEqual(weak.map((i) => i.asn), [17747]);
  assert.equal(confirmed[1].providers[0].feeds, 10);
  assert.equal(shardOf(141476), 76);
});
