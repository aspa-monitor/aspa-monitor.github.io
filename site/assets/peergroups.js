// Per-search merging of peers for the AS path graph: peers whose paths to the searched prefix are the same
// once their own AS is dropped become one group, drawn as one box with one set of lines. Grouping is redone
// for every search, so two peers can share a box for one prefix and appear separately for another.
// Pure functions (no DOM), tested in tests/js/peergroups.test.mjs.

/** Path text -> list of hops; consecutive repeats (prepending) collapse into one hop. */
export function hops(path) {
  const out = [];
  for (const tok of String(path || "").split(/\s+/).filter(Boolean)) {
    if (out[out.length - 1] !== tok) out.push(tok);
  }
  return out;
}

/**
 * entries: [{prefix, path, split?, ...}] in manifest order (one per distinct path per peer).
 * Returns groups in order of their first member: [{members: [entry index], peers: [peer AS, unique],
 * tail: [hops after the peer], prefix, path (the first member's)}].
 * A peer that originates the prefix itself (nothing left after its own AS) is never merged.
 */
export function groupPeers(entries) {
  const groups = [];
  const byKey = new Map();
  entries.forEach((e, i) => {
    const h = hops(e.path);
    if (!h.length) return;
    const tail = h.slice(1);
    // e.split (e.g. the ASPA verdict) keeps peers apart even when their tails match: the first pair differs.
    const key = (tail.length ? `${e.prefix}|${tail.join(" ")}` : `${e.prefix}|self:${h[0]}`) +
      (e.split != null ? `|${e.split}` : "");
    let g = byKey.get(key);
    if (!g) {
      g = { members: [], peers: [], tail, prefix: e.prefix, path: e.path };
      byKey.set(key, g);
      groups.push(g);
    }
    g.members.push(i);
    if (!g.peers.includes(h[0])) g.peers.push(h[0]);
  });
  return groups;
}

/** Every AS a group puts on the graph: its peer boxes and the shared path. */
export const groupAses = (g) => new Set([...g.peers, ...g.tail]);

/**
 * At most `cap` groups, picked greedily: each next one adds the most ASes not shown yet; ties go to more
 * member peers, then to the earlier group (manifest order). Returned in their original order.
 */
export function pickGroups(groups, cap = 6) {
  if (groups.length <= cap) return groups.slice();
  const shown = new Set();
  const left = groups.map((g, i) => ({ g, i, ases: groupAses(g) }));
  const picked = [];
  while (picked.length < cap && left.length) {
    let best = 0, bestGain = -1;
    left.forEach((c, k) => {
      let gain = 0;
      for (const a of c.ases) if (!shown.has(a)) gain++;
      const b = left[best];
      if (gain > bestGain || (gain === bestGain &&
          (c.g.members.length > b.g.members.length || (c.g.members.length === b.g.members.length && c.i < b.i)))) {
        best = k; bestGain = gain;
      }
    });
    const [c] = left.splice(best, 1);
    for (const a of c.ases) shown.add(a);
    picked.push(c);
  }
  return picked.sort((a, b) => a.i - b.i).map((c) => c.g);
}

/** One group per entry (no merging), same shape as groupPeers' groups. Entries with an empty path are left out. */
export function singlePeers(entries) {
  const out = [];
  entries.forEach((e, i) => {
    const h = hops(e.path);
    if (h.length) out.push({ members: [i], peers: [h[0]], tail: h.slice(1), prefix: e.prefix, path: e.path });
  });
  return out;
}

/**
 * Tier 1 (transit-free) networks: they buy no transit, so a path from one of them only climbs from the origin
 * and every ASPA arrow on it points towards the peer. A fixed list, since no registry publishes one.
 */
export const TIER1 = new Set(["174", "701", "1299", "2914", "3257", "3320", "3356", "3491", "3549", "5511",
  "6453", "6461", "6762", "6830", "7018", "12956"]);
const isTier1 = (g) => TIER1.has(g.peers[0]);

/** a > b, comparing scores element by element (the first difference decides). */
const beats = (a, b) => {
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j] > b[j];
  return false;
};

/** Tier 1 peers first, each part in its original (manifest) order. */
const tier1First = (list) => [...list.filter(isTier1), ...list.filter((g) => !isTier1(g))];

/**
 * The default graph: at most `cap` single peers, chosen so the paths shown are as different as possible,
 * preferring Tier 1 peers. The first pick is the Tier 1 peer whose path adds the most ASes (if any Tier 1 peer
 * has a route). Each next pick is the peer whose path (after its own AS) adds the most ASes not shown yet; ties
 * go to a path not shown yet (so two peers with the same path are only both picked when nothing new is left),
 * then to a Tier 1 peer, then to manifest order. Returned Tier 1 peers first, each part in manifest order.
 */
export function pickPeers(groups, cap = 6) {
  if (groups.length <= cap) return tier1First(groups);
  const shown = new Set(), paths = new Set();
  const key = (g) => `${g.prefix}|${g.tail.join(" ")}`;
  const left = groups.map((g, i) => ({ g, i }));
  const picked = [];
  while (picked.length < cap && left.length) {
    let best = 0, bestScore = null;
    const firstTier1 = !picked.length && left.some((c) => isTier1(c.g));
    left.forEach((c, k) => {
      if (firstTier1 && !isTier1(c.g)) return;
      let gain = 0;
      for (const a of c.g.tail) if (!shown.has(a)) gain++;
      const score = [gain, paths.has(key(c.g)) ? 0 : 1, isTier1(c.g) ? 1 : 0];
      if (!bestScore || beats(score, bestScore)) { best = k; bestScore = score; }
    });
    const [c] = left.splice(best, 1);
    for (const a of c.g.tail) shown.add(a);
    paths.add(key(c.g));
    picked.push(c);
  }
  return tier1First(picked.sort((a, b) => a.i - b.i).map((c) => c.g));
}

/**
 * Colours for one drawing: the peers actually drawn get slots 0, 1, 2, ... in drawing order (keys are source
 * names; a source drawn twice keeps its first slot). Colours are handed out per search, not fixed per peer, so a
 * graph (at most 6 peers, or every peer under "All sources") never runs out while the 16 colours cover it.
 */
export function colourSlots(keys) {
  const out = new Map();
  for (const k of keys) if (!out.has(k)) out.set(k, out.size);
  return out;
}

/** Pack tokens into lines of at most `max` characters, joined by " + " (a token longer than max gets its own line). */
export function packLines(tokens, max) {
  const lines = [];
  for (const t of tokens) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 3 + t.length <= max) lines[last] += ` + ${t}`;
    else {
      if (last >= 0) lines[last] += " +";
      lines.push(t);
    }
  }
  return lines;
}
