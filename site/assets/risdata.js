// Loading the sharded RIS data (built by pipeline/ris/shard.py) and answering lookups. No DOM.
import { WIDTH, covers, nodeId, parsePrefix } from "./prefix.js";

export const DATA_ROOT = "/data/ris/";
const BASE = { 4: 8, 6: 16 };
const FAM = { 4: "v4", 6: "v6" };

/** How many more-specific block files are fetched without asking. */
export const AUTO_LOAD_FILES = 8;
export const MAX_LOAD_FILES = 64;

const cache = new Map();
export function getJSON(url) {
  if (!cache.has(url)) {
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

export const loadManifest = () => getJSON(`${DATA_ROOT}manifest.json`);
export const loadIndex = (source) => getJSON(`${DATA_ROOT}${source}/index.json`);

/** Depth (bits) and network address of a block name. */
export function nodeRange(afi, id) {
  const [hex, d] = id.split("-");
  const depth = d === undefined ? hex.length * 4 : Number(d);
  const w = WIDTH[afi];
  const top = BigInt("0x" + hex) >> BigInt(hex.length * 4 - depth);
  return { depth, net: top << BigInt(w - depth) };
}

/** Blocks from the root down towards `addr`, keeping those with depth <= maxDepth. */
export function chain(index, afi, addr, maxDepth) {
  const nodes = index.nodes[FAM[afi]] || {};
  const out = [];
  if (nodes.root) out.push({ id: "root", depth: 0, node: nodes.root });
  let depth = BASE[afi];
  while (depth <= maxDepth && depth <= WIDTH[afi]) {
    const id = nodeId(afi, addr, depth);
    const node = nodes[id];
    if (!node) break;
    out.push({ id, depth, node });
    if (!node.k) break;
    depth += node.k;
  }
  return out;
}

/** Blocks lying completely inside prefix (net, len), excluding root. */
export function blocksInside(index, afi, net, len) {
  const nodes = index.nodes[FAM[afi]] || {};
  const out = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (id === "root") continue;
    const r = nodeRange(afi, id);
    if (r.depth > len && covers(afi, net, len, r.net, r.depth)) out.push({ id, depth: r.depth, node });
  }
  return out;
}

/** Fetch one block file and expand it into route objects. */
export async function loadBlock(source, afi, id, index) {
  const file = await getJSON(`${DATA_ROOT}${source}/${FAM[afi]}/${id}.json`);
  if (!file._expanded) {
    file._expanded = file.routes.map((r) => {
      const p = parsePrefix(r[0]);
      const path = file.paths[r[2]] || [];
      return {
        prefix: r[0], afi: p.afi, net: p.net, len: p.len,
        peerIp: index.peers[r[1]], peerAsn: index.peer_asn,
        origin: r[3], communities: r[4], otc: r[5], aggrAsn: r[6], aggrIp: r[7],
        atomic: r[8] === 1, timestamp: r[9],
        path: path[0] || "", rawPath: path[1] || "", length: path[2], pathOrigin: path[3],
        flags: path[4] || "", setMembers: path[5] || "",
      };
    });
  }
  return file._expanded;
}

function byPrefix(a, b) {
  return a.net < b.net ? -1 : a.net > b.net ? 1 : a.len - b.len;
}

/** Group routes into [{prefix, afi, net, len, routes:[...]}] sorted by address. */
export function groupByPrefix(routes) {
  const m = new Map();
  for (const r of routes) {
    if (!m.has(r.prefix)) m.set(r.prefix, { prefix: r.prefix, afi: r.afi, net: r.net, len: r.len, routes: [] });
    m.get(r.prefix).routes.push(r);
  }
  return [...m.values()].sort(byPrefix);
}

/**
 * Look a query up in one source.
 * Returns {source, index, exact, match, covering, moreSpecifics, unloaded}
 *   match: the matched prefix group (exact, or longest covering) or null
 *   unloaded: blocks with more-specifics not fetched yet {blocks, routes}
 */
export async function lookup(source, q, { loadAll = false } = {}) {
  const index = await loadIndex(source);
  const ch = chain(index, q.afi, q.net, q.len);
  const loaded = new Set();
  const routes = [];
  await Promise.all(ch.filter((c) => c.node.n > 0).map(async (c) => {
    loaded.add(c.id);
    routes.push(...(await loadBlock(source, q.afi, c.id, index)));
  }));

  const coveringOrEqual = routes.filter((r) => covers(q.afi, r.net, r.len, q.net, q.len));
  let match = null, exact = false;
  if (coveringOrEqual.length) {
    const best = Math.max(...coveringOrEqual.map((r) => r.len));
    match = groupByPrefix(coveringOrEqual.filter((r) => r.len === best))[0];
    exact = !q.isAddress && match.len === q.len;
  }
  const covering = groupByPrefix(coveringOrEqual.filter((r) => !match || r.len < match.len)).reverse();

  // More-specifics of the matched prefix (or of the query, when nothing covers it).
  const base = match || q;
  const inside = blocksInside(index, q.afi, base.net, base.len).filter((b) => b.node.n > 0 && !loaded.has(b.id));
  let unloaded = { blocks: inside.length, routes: inside.reduce((s, b) => s + b.node.n, 0) };
  const toLoad = loadAll && inside.length <= MAX_LOAD_FILES ? inside : inside.length <= AUTO_LOAD_FILES ? inside : [];
  if (toLoad.length) {
    await Promise.all(toLoad.map(async (b) => {
      loaded.add(b.id);
      routes.push(...(await loadBlock(source, q.afi, b.id, index)));
    }));
    const rest = inside.filter((b) => !loaded.has(b.id));
    unloaded = { blocks: rest.length, routes: rest.reduce((s, b) => s + b.node.n, 0) };
  }
  const moreSpecifics = groupByPrefix(
    routes.filter((r) => r.len > base.len && covers(q.afi, base.net, base.len, r.net, r.len)),
  );
  return { source, index, exact, match, covering, moreSpecifics, moreBase: base, unloaded, loadedAll: loadAll };
}
