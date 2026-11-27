import { test } from "node:test";
import assert from "node:assert/strict";
import { hop, verifyPath, parseAspas } from "../../site/assets/aspapath.js";
import { groupPeers } from "../../site/assets/peergroups.js";

// ASPAs as {customer: [providers]}; paths are written peer first, origin last.
const A = (o) => parseAspas({ schema_version: 1, aspas: o }).map;
const v = (aspas, path) => verifyPath(A(aspas), path.split(" "));

test("pair check", () => {
  const a = A({ 1: [2], 5: [0] });
  assert.equal(hop(a, 1, 2), "P");
  assert.equal(hop(a, 1, 3), "N");
  assert.equal(hop(a, 9, 1), "U");
  assert.equal(hop(a, 5, 2), "N"); // AS0: no providers at all
});

test("climb only, and climb then descend, are valid", () => {
  assert.equal(v({ 1: [2], 2: [3], 3: [4] }, "4 3 2 1").verdict, "valid");
  assert.equal(v({ 1: [2], 3: [2] }, "3 2 1").verdict, "valid"); // 1 up to 2, 2 down to 3
  assert.equal(v({ 1: [2], 2: [3], 5: [4], 4: [3] }, "5 4 3 2 1").verdict, "valid"); // apex AS3
});

test("one peering link at the top is allowed", () => {
  // 1 up to 2; 2-3 neither lists the other (a peer link); 3 down to 4.
  const r = v({ 1: [2], 2: [9], 3: [8], 4: [3] }, "4 3 2 1");
  assert.equal(r.verdict, "valid");
  assert.match(r.pairs.find((p) => p.far === "2").text, /peering link at the top/);
});

test("a valley is invalid, with both breaking pairs named", () => {
  // 1 up to 2; 2 sends to 3 (not 2's provider); 4 sends to... from the peer side 4's ASPA lacks 3.
  const r = v({ 1: [2], 2: [9], 5: [4], 4: [8] }, "5 4 3 2 1");
  assert.equal(r.verdict, "invalid");
  assert.match(r.reason, /AS2's ASPA does not list AS3/);
  assert.match(r.reason, /AS4's ASPA does not list AS3/);
  assert.deepEqual(r.pairs.filter((p) => p.mark === "bad").map((p) => `${p.near}<${p.far}`), ["4<3", "3<2"]);
  assert.doesNotMatch(r.pairs.find((p) => p.mark === "bad").text, /fine only/);
});

test("same pair blocking both ways (two peering links) is invalid", () => {
  // 2-3 and 3-4 both look like peer links: only one is allowed.
  assert.equal(v({ 1: [2], 2: [9], 3: [9], 4: [9], 5: [4] }, "5 4 3 2 1").verdict, "invalid");
});

test("AS0: an AS that says it has no providers", () => {
  const r = v({ 1: [0], 3: [9] }, "3 2 1");
  assert.equal(r.verdict, "invalid");
  assert.match(r.reason, /AS1's ASPA says it has no providers/);
  assert.match(r.pairs.find((p) => p.far === "1").text, /AS1's ASPA says it has no providers/);
});

test("unknown when ASPAs are missing, valid for short paths, invalid with AS_SET", () => {
  const r = v({ 1: [2] }, "4 3 2 1");
  assert.equal(r.verdict, "unknown");
  assert.match(r.reason, /no ASPA from AS2, AS3, AS4/);
  assert.equal(v({}, "7018 13335").verdict, "valid");
  assert.equal(v({}, "13335").verdict, "valid");
  assert.equal(v({ 1: [2] }, "4 3 {5,6}").verdict, "invalid");
});

test("pairs come in path order with directions", () => {
  const r = v({ 1: [2], 3: [2] }, "3 2 1");
  assert.deepEqual(r.pairs.map((p) => [p.near, p.far, p.up, p.down, p.mark]),
    [["3", "2", "U", "P", "ok"], ["2", "1", "P", "U", "ok"]]);
  assert.equal(r.pairs[0].text, "AS3 lists AS2 as a provider (route sent down)");
  assert.equal(r.pairs[1].text, "AS1 lists AS2 as a provider (route sent up)");
});

test("peers with different verdicts are not merged", () => {
  const e = (path, split) => ({ prefix: "p", path, split });
  assert.equal(groupPeers([e("7018 3356 9", "valid"), e("6453 3356 9", "unknown")]).length, 2);
  assert.equal(groupPeers([e("7018 3356 9", "valid"), e("6453 3356 9", "valid")]).length, 1);
});

test("parseAspas rejects an unexpected file", () => {
  assert.throws(() => parseAspas({ schema_version: 2, aspas: {} }));
  assert.throws(() => parseAspas(null));
});
