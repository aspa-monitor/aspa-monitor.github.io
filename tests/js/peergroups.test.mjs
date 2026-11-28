import { test } from "node:test";
import assert from "node:assert/strict";
import { hops, groupPeers, pickGroups, packLines, groupAses, singlePeers, pickPeers, TIER1 } from "../../site/assets/peergroups.js";

const P = "1.10.10.0/24";
const e = (path, prefix = P) => ({ prefix, path });

test("hops collapse prepends", () => {
  assert.deepEqual(hops("7018 7018 3356 3356 3356 9498"), ["7018", "3356", "9498"]);
  assert.deepEqual(hops(""), []);
});

test("peers with the same path after their own AS share a group", () => {
  const g = groupPeers([e("7018 3356 9498"), e("6453 6453 3356 9498"), e("3333 1299 9498"), e("4608 3356 9498 9498")]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].members, [0, 1, 3]);
  assert.deepEqual(g[0].peers, ["7018", "6453", "4608"]);
  assert.deepEqual(g[0].tail, ["3356", "9498"]);
  assert.equal(g[0].path, "7018 3356 9498"); // first member's path
  assert.deepEqual(g[1].members, [2]);
});

test("grouping is per prefix, never merges different tails or self-originating peers", () => {
  const g = groupPeers([e("7018 3356 9498"), e("6453 3356 9498", "1.10.0.0/16"), e("7018 1299 9498"),
    e("13335"), e("2497")]);
  assert.equal(g.length, 5);
  assert.ok(g.every((x) => x.members.length === 1));
});

test("same peer AS at two collectors with the same path: one group, AS listed once", () => {
  const g = groupPeers([e("3333 1299 9498"), e("3333 1299 9498")]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].members, [0, 1]);
  assert.deepEqual(g[0].peers, ["3333"]);
});

test("groupAses counts peers and path", () => {
  const [g] = groupPeers([e("7018 3356 9498"), e("6453 3356 9498")]);
  assert.deepEqual([...groupAses(g)].sort(), ["3356", "6453", "7018", "9498"]);
});

test("pickGroups: no cut at or under the cap", () => {
  const g = groupPeers([e("1 10 9"), e("2 11 9"), e("3 12 9")]);
  assert.equal(pickGroups(g, 6).length, 3);
  assert.deepEqual(pickGroups(g, 3), g);
});

test("pickGroups: greedy by new ASes, then member count, then order; result in original order", () => {
  const groups = [
    { members: [0], peers: ["1"], tail: ["10", "9"] },             // {1,10,9}
    { members: [1], peers: ["2"], tail: ["20", "21", "22", "9"] }, // {2,20,21,22,9}: most new ASes, first
    { members: [2, 3], peers: ["3", "4"], tail: ["10", "9"] },     // {3,4,10,9}
    { members: [4], peers: ["5"], tail: ["10", "9"] },             // {5,10,9}
  ];
  // Pick 1: group 1 (5 new). Pick 2: group 2 adds {3,4,10} = 3; group 0 adds {1,10} = 2. Pick 3: group 0 and
  // group 3 both add 1 new AS ({1} or {5}) after 10 is shown; same member count, so the earlier (group 0) wins.
  assert.deepEqual(pickGroups(groups, 3), [groups[0], groups[1], groups[2]]);
  // Tie on new ASes broken by member count: {7,8}+... vs {6}+...
  const tie = [
    { members: [0], peers: ["6"], tail: ["9"] },
    { members: [1, 2], peers: ["7"], tail: ["9"] },
  ];
  assert.deepEqual(pickGroups(tie, 1), [tie[1]]);
  assert.deepEqual(pickGroups([tie[0], { members: [1], peers: ["7"], tail: ["9"] }], 1), [tie[0]]);
});

test("packLines wraps member AS numbers", () => {
  assert.deepEqual(packLines(["AS7018", "AS6453"], 20), ["AS7018 + AS6453"]);
  assert.deepEqual(packLines(["AS7018", "AS6453", "AS3333"], 13), ["AS7018 +", "AS6453 +", "AS3333"]);
  assert.deepEqual(packLines(["AS1", "AS2", "AS3"], 9), ["AS1 + AS2 +", "AS3"]);
});

test("singlePeers keeps every peer apart", () => {
  const g = singlePeers([e("7018 3356 9498"), e("6453 3356 9498"), e("")]);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.members), [[0], [1]]);
  assert.deepEqual(g[1].tail, ["3356", "9498"]);
});

test("pickPeers prefers new ASes, then paths not shown yet, then manifest order", () => {
  const g = singlePeers([
    e("1 100 9"), e("2 100 9"), e("3 100 9"), // same path after the peer
    e("4 200 300 9"), e("5 400 9"), e("6 500 9"), e("7 600 9"), e("8 700 9"),
  ]);
  const picked = pickPeers(g, 6).map((x) => x.peers[0]);
  assert.deepEqual(picked, ["1", "4", "5", "6", "7", "8"]); // 2 and 3 repeat peer 1's path
  assert.deepEqual(pickPeers(g.slice(0, 3), 6).length, 3); // under the cap: everyone
  // The phone graph's 3 peers are the first 3 picks, so always among the 6 a laptop shows.
  const three = pickPeers(g, 3).map((x) => x.peers[0]);
  assert.deepEqual(three, ["1", "4", "5"]);
  assert.ok(three.every((p) => picked.includes(p)));
  // Once every AS is shown, a path not shown yet still beats a repeat.
  const h = singlePeers([e("1 100 9"), e("2 100 9"), e("3 9"), e("4 100 9")]);
  // 1 first (most new ASes), then 3 (its path "9" is new), then 2 (earliest of the repeats).
  assert.deepEqual(pickPeers(h, 3).map((x) => x.peers[0]), ["1", "2", "3"]);
});

test("pickPeers prefers Tier 1 peers but keeps the most different paths", () => {
  assert.ok(TIER1.has("7018") && TIER1.has("174") && !TIER1.has("1221"));
  const g = singlePeers([
    e("1221 4637 4826 9"), // regional, longest path
    e("7018 3356 9"), // Tier 1
    e("3333 1299 9"),
    e("174 9"), // Tier 1, adds nothing new once 9 is shown
    e("4608 6939 9"),
  ]);
  // First pick is the best Tier 1 path (7018), even though 1221's path adds more ASes; then the most new ASes.
  const three = pickPeers(g, 3).map((x) => x.peers[0]);
  assert.deepEqual(three, ["7018", "1221", "3333"]); // Tier 1 first, then manifest order
  // New ASes still come before Tier 1: 4608 adds 6939, the Tier 1 peer 174 adds nothing new.
  assert.deepEqual(pickPeers(g, 4).map((x) => x.peers[0]), ["7018", "1221", "3333", "4608"]);
  // Under the cap: everyone, Tier 1 first.
  assert.deepEqual(pickPeers(g, 6).map((x) => x.peers[0]), ["7018", "174", "1221", "3333", "4608"]);
  // Equal gain after the first pick: the Tier 1 peer (174) wins over the earlier 3333.
  const h = singlePeers([e("7018 1 9"), e("3333 2 9"), e("174 3 9")]);
  assert.deepEqual(pickPeers(h, 2).map((x) => x.peers[0]), ["7018", "174"]);
  // No Tier 1 peer at all: unchanged behaviour.
  assert.deepEqual(pickPeers(singlePeers([e("1 5 9"), e("2 6 7 9"), e("3 5 9")]), 2).map((x) => x.peers[0]), ["1", "2"]);
});
