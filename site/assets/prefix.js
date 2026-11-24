// IPv4 / IPv6 address and prefix handling with BigInt. No DOM, so it also runs under node:test.

export const WIDTH = { 4: 32, 6: 128 };

function parseV4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseV6(text) {
  let s = text.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(s)) return null;
  // Embedded IPv4 tail, e.g. ::ffff:192.0.2.1 -> rewrite it as two hex groups.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseV4(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (h) => (h === "" ? [] : h.split(":"));
  const head = toGroups(halves[0]);
  const back = halves.length === 2 ? toGroups(halves[1]) : [];
  for (const g of [...head, ...back]) if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - back.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill("0"), ...back];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(parseInt(g, 16));
  return v;
}

export function parseAddress(text) {
  const t = text.trim();
  if (t.includes(":")) {
    const v = parseV6(t);
    return v === null ? null : { afi: 6, addr: v };
  }
  const v = parseV4(t);
  return v === null ? null : { afi: 4, addr: v };
}

export function mask(afi, len) {
  const w = BigInt(WIDTH[afi]);
  return ((1n << w) - 1n) ^ ((1n << (w - BigInt(len))) - 1n);
}

/**
 * Parse user input: "1.10.10.0/24", "2001:db8::/32", or a bare address (= host route, longest match).
 * Returns {afi, net, len, isAddress, addr, hostBits} or {error}.
 */
export function parseQuery(text) {
  const t = (text || "").trim();
  if (!t) return { error: "Enter a prefix or an IP address." };
  const [addrText, lenText, extra] = t.split("/");
  if (extra !== undefined) return { error: `"${t}" is not a valid prefix.` };
  const a = parseAddress(addrText);
  if (!a) return { error: `"${addrText}" is not a valid IPv4 or IPv6 address.` };
  const width = WIDTH[a.afi];
  if (lenText === undefined) {
    return { afi: a.afi, net: a.addr, len: width, addr: a.addr, isAddress: true, hostBits: false };
  }
  if (!/^\d{1,3}$/.test(lenText) || Number(lenText) > width) {
    return { error: `Prefix length "/${lenText}" is not valid for IPv${a.afi} (0-${width}).` };
  }
  const len = Number(lenText);
  const net = a.addr & mask(a.afi, len);
  return { afi: a.afi, net, len, addr: a.addr, isAddress: false, hostBits: net !== a.addr };
}

/** Parse a prefix string as written in the data (always valid, network address). */
export function parsePrefix(text) {
  const i = text.indexOf("/");
  const a = parseAddress(text.slice(0, i));
  return { afi: a.afi, net: a.addr, len: Number(text.slice(i + 1)) };
}

/** Does prefix (net, len) contain address-or-prefix (addr, alen)? */
export function covers(afi, net, len, addr, alen = WIDTH[afi]) {
  if (len > alen) return false;
  return (addr & mask(afi, len)) === net;
}

export function formatAddress(afi, v) {
  if (afi === 4) {
    return [24n, 16n, 8n, 0n].map((s) => String((v >> s) & 255n)).join(".");
  }
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(Number((v >> BigInt(i * 16)) & 0xffffn));
  // RFC 5952: compress the longest run (>= 2) of zero groups, first one on ties.
  let best = -1, bestLen = 1;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best < 0) return hex.join(":");
  return hex.slice(0, best).join(":") + "::" + hex.slice(best + bestLen).join(":");
}

export function formatPrefix(afi, net, len) {
  return `${formatAddress(afi, net)}/${len}`;
}

/** Block name used by the data files (must match pipeline/ris/shard.py node_id). */
export function nodeId(afi, addr, depth) {
  const w = BigInt(WIDTH[afi]);
  const top = addr >> (w - BigInt(depth));
  const nibbles = Math.ceil(depth / 4);
  const text = (top << BigInt(nibbles * 4 - depth)).toString(16).padStart(nibbles, "0");
  return depth % 4 === 0 ? text : `${text}-${depth}`;
}
