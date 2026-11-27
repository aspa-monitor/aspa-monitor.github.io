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
