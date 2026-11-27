import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, aspaDisagrees, REL } from "../../site/assets/asrel.js";

const answer = (relation) => ({ data: relation ? [{ relation }] : [], meta: { snapshot_date: "2026-11-26" } });

test("BGPKIT relations map to line kinds (asn = far, the AS nearer the origin)", () => {
  assert.equal(kindOf(answer("downstream")), "up");   // far is a customer of near: route sent up
  assert.equal(kindOf(answer("upstream")), "down");   // far is a provider of near
  assert.equal(kindOf(answer("adjacent")), "peer");
  assert.equal(kindOf(answer("mixed")), "mixed");
  assert.equal(kindOf(answer(null)), "unknown");
  assert.equal(kindOf(undefined), "unknown");
  for (const k of ["up", "down", "peer", "mixed", "unknown"]) assert.ok(REL[k].glyph && REL[k].text(1, 2));
});

test("flags a customer-provider link that the customer's ASPA leaves out", () => {
  // AS198831 buys from AS174 (inferred) but its ASPA does not list AS174 (up = N).
  const f = aspaDisagrees("up", { up: "N", down: "N" }, "198831", "174");
  assert.match(f.text, /AS198831's ASPA does not list it/);
  assert.match(aspaDisagrees("down", { up: "U", down: "N" }, "1299", "4637").text, /AS4637's ASPA does not list it/);
});

test("no flag when they agree, when there is no ASPA, or for peers", () => {
  assert.equal(aspaDisagrees("up", { up: "P", down: "U" }, "1", "2"), null);
  assert.equal(aspaDisagrees("up", { up: "U", down: "U" }, "1", "2"), null); // no ASPA: nothing to compare
  assert.equal(aspaDisagrees("peer", { up: "N", down: "N" }, "1", "2"), null);
  assert.equal(aspaDisagrees("up", null, "1", "2"), null);
});
