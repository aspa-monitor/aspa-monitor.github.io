import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, parseAddress, formatAddress, formatPrefix, covers, nodeId } from "../../site/assets/prefix.js";
import { chain, nodeRange, blocksInside } from "../../site/assets/risdata.js";

test("IPv4 prefixes and addresses", () => {
  const q = parseQuery("1.10.10.0/24");
  assert.equal(q.afi, 4);
  assert.equal(q.len, 24);
  assert.equal(formatPrefix(4, q.net, q.len), "1.10.10.0/24");
  assert.equal(q.hostBits, false);

  const h = parseQuery("1.10.10.7/24");
  assert.equal(h.hostBits, true);
  assert.equal(formatPrefix(4, h.net, h.len), "1.10.10.0/24");

  const a = parseQuery(" 8.8.8.8 ");
  assert.equal(a.isAddress, true);
  assert.equal(a.len, 32);
});

test("invalid input", () => {
  for (const bad of ["", "1.2.3", "1.2.3.256", "1.2.3.4/33", "1.2.3.4/x", "2001:db8::/129", "2001:::1", "1:2:3:4:5:6:7:8:9", "a/b/c"]) {
    assert.ok(parseQuery(bad).error, bad);
  }
});

test("IPv6 parsing and RFC 5952 formatting", () => {
  const cases = {
    "2001:db8::": "2001:db8::",
    "2001:0DB8:0000:0000:0000:0000:0000:0001": "2001:db8::1",
    "::": "::",
    "::1": "::1",
    "2001:db8:0:0:1:0:0:1": "2001:db8::1:0:0:1",
    "2001:db8:0:1:1:1:1:1": "2001:db8:0:1:1:1:1:1",
    "::ffff:192.0.2.1": "::ffff:c000:201",
    "64:ff9b::192.0.2.33": "64:ff9b::c000:221",
  };
  for (const [inp, out] of Object.entries(cases)) {
    const a = parseAddress(inp);
    assert.equal(a.afi, 6, inp);
    assert.equal(formatAddress(6, a.addr), out, inp);
  }
  const q = parseQuery("2001:4860:4860::8888/32");
  assert.equal(formatPrefix(6, q.net, q.len), "2001:4860::/32");
});

test("covers", () => {
  const p = parseQuery("10.0.0.0/8"), a = parseQuery("10.200.1.1");
  assert.ok(covers(4, p.net, p.len, a.net, a.len));
  const b = parseQuery("11.0.0.1");
  assert.ok(!covers(4, p.net, p.len, b.net, b.len));
  const z = parseQuery("0.0.0.0/0");
  assert.ok(covers(4, z.net, z.len, b.net));
});

test("nodeId matches pipeline/ris/shard.py node_id", () => {
  const a = parseAddress("103.1.2.3").addr;
  assert.equal(nodeId(4, a, 8), "67");
  assert.equal(nodeId(4, a, 11), "670-11");
  assert.equal(nodeId(4, parseAddress("103.160.0.0").addr, 11), "67a-11");
  assert.equal(nodeId(4, a, 16), "6701");
  const v6 = parseAddress("2001:db8::1").addr;
  assert.equal(nodeId(6, v6, 16), "2001");
  assert.equal(nodeId(6, v6, 20), "20010");
  assert.equal(nodeId(4, parseAddress("1.0.0.0").addr, 8), "01");
});

test("nodeRange inverts nodeId", () => {
  for (const [afi, text, depth] of [[4, "103.160.0.0", 11], [4, "103.1.0.0", 16], [6, "2001:db8::", 20], [6, "2804::", 16]]) {
    const addr = parseAddress(text).addr;
    const r = nodeRange(afi, nodeId(afi, addr, depth));
    assert.equal(r.depth, depth);
    assert.equal(formatAddress(afi, r.net), text);
  }
});

test("chain and blocksInside walk the split tree", () => {
  const index = {
    peers: [], nodes: {
      v4: {
        root: { n: 1, t: 1 },
        "67": { n: 3, t: 100, k: 4 },
        "670": { n: 50, t: 50 },
        "67a": { n: 47, t: 47 },
        "01": { n: 5, t: 5 },
      },
    },
  };
  const addr = parseAddress("103.5.1.1").addr;
  assert.deepEqual(chain(index, 4, addr, 32).map((c) => c.id), ["root", "67", "670"]);
  assert.deepEqual(chain(index, 4, addr, 10).map((c) => c.id), ["root", "67"]);
  assert.deepEqual(chain(index, 4, addr, 7).map((c) => c.id), ["root"]);
  const q = parseQuery("103.0.0.0/8");
  assert.deepEqual(blocksInside(index, 4, q.net, q.len).map((b) => b.id).sort(), ["670", "67a"]);
  const all = parseQuery("0.0.0.0/0");
  assert.equal(blocksInside(index, 4, all.net, all.len).length, 4);
});
