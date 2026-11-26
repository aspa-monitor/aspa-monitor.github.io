// AS path graph: the paths every peer uses to reach a prefix, merged into one picture.
// Peers sit on one side, the origin AS on the other; an AS that several paths share is drawn once.
// Lines get thicker the more peers use them. Pointing at (or tapping) a peer chip highlights its path.
import { asName } from "./asnames.js";

const SVG = "http://www.w3.org/2000/svg";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Path text -> list of hops; consecutive repeats (prepending) collapse into one hop. */
export function hops(path) {
  const out = [];
  for (const tok of String(path || "").split(/\s+/).filter(Boolean)) {
    if (out[out.length - 1] !== tok) out.push(tok);
  }
  return out;
}

/**
 * Layout without coordinates. entries: [{label, prefix, path}].
 * Returns {nodes: [{id, asn, layer, order, peer, origin}], edges: [{from, to, users: [entry index]}], layers}
 * layer 0 = origin side; every peer sits in the outermost layer. A peer's own box is separate from the
 * box for the same AS as a transit hop on other peers' paths (e.g. AS4777 -> AS2497, where AS2497 is
 * also a peer), so the peers always line up and lines never run backwards.
 */
export function layout(entries) {
  const paths = entries.map((e) => hops(e.path));
  const nodes = new Map();
  const edges = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { id, layer: 0, order: 0, peer: false, origin: false, first: nodes.size });
    return nodes.get(id);
  };
  paths.forEach((p, i) => {
    const ids = p.map((asn, j) => (j === 0 ? `peer:${asn}` : asn));
    ids.forEach((id, j) => {
      const n = node(id);
      n.asn = p[j];
      n.layer = Math.max(n.layer, p.length - 1 - j);
      if (j === 0) n.peer = true;
      if (j === p.length - 1) n.origin = true;
      if (j > 0) {
        const key = `${ids[j - 1]} ${id}`;
        if (!edges.has(key)) edges.set(key, { from: ids[j - 1], to: id, users: [] });
        if (!edges.get(key).users.includes(i)) edges.get(key).users.push(i);
      }
    });
  });
  // Keep every line pointing towards the origin: a hop sits at least one layer above the next one.
  for (let pass = 0; pass < nodes.size; pass++) {
    let moved = false;
    for (const e of edges.values()) {
      const a = nodes.get(e.from), b = nodes.get(e.to);
      if (a.id !== b.id && a.layer <= b.layer && a.layer < 64) { a.layer = b.layer + 1; moved = true; }
    }
    if (!moved) break;
  }
  // All peers in the outermost layer, one step beyond the furthest transit hop.
  const all = [...nodes.values()];
  const top = Math.max(0, ...all.filter((n) => !n.peer).map((n) => n.layer)) + 1;
  for (const n of all) if (n.peer) n.layer = top;
  // A line that skips layers gets an invisible waypoint ("dummy") in every layer it crosses, so it is
  // routed through a gap between boxes instead of being drawn behind the boxes in between.
  const edgeList = [...edges.values()];
  for (const e of edgeList) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    e.chain = [e.from];
    for (let L = a.layer - 1; L > b.layer; L--) {
      const id = `~${e.from}>${e.to}@${L}`;
      nodes.set(id, { id, layer: L, order: 0, dummy: true, first: nodes.size });
      e.chain.push(id);
    }
    e.chain.push(e.to);
  }
  const layers = [];
  for (const n of nodes.values()) (layers[n.layer] ||= []).push(n);
  for (let i = 0; i < layers.length; i++) layers[i] ||= [];
  layers.forEach((l) => l.sort((a, b) => a.first - b.first).forEach((n, k) => { n.order = k; }));
  // Sweeps placing each box near the average position of its neighbours in the next layer (fewer crossings).
  const up = new Map([...nodes.keys()].map((id) => [id, []]));   // neighbours one layer nearer the peers
  const down = new Map([...nodes.keys()].map((id) => [id, []])); // neighbours one layer nearer the origin
  for (const e of edgeList) {
    for (let k = 1; k < e.chain.length; k++) { down.get(e.chain[k - 1]).push(e.chain[k]); up.get(e.chain[k]).push(e.chain[k - 1]); }
  }
  const pos = (n) => n.order / Math.max(1, layers[n.layer].length - 1);
  for (let sweep = 0; sweep < 12; sweep++) {
    const fromPeers = sweep % 2 === 0;
    const order = fromPeers ? [...layers.keys()].reverse() : [...layers.keys()];
    for (const li of order) {
      const l = layers[li];
      for (const n of l) {
        const ns = (fromPeers ? up : down).get(n.id).map((id) => nodes.get(id));
        n.bary = ns.length ? ns.reduce((s, m) => s + pos(m), 0) / ns.length : pos(n);
      }
      l.sort((a, b) => a.bary - b.bary || a.first - b.first).forEach((n, k) => { n.order = k; });
    }
  }
  return { nodes: [...nodes.values()], edges: edgeList, layers };
}

function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function fit(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Build the graph block (a <figure>) for the lookup page, or null when there is nothing to draw. */
export function renderPathGraph(entries, { width = 900 } = {}) {
  entries = entries.filter((e) => hops(e.path).length);
  if (!entries.length) return null;
  const { nodes, edges, layers } = layout(entries);
  const widest = Math.max(...layers.map((l) => l.filter((n) => !n.dummy).length));

  // Horizontal (peers left, origin right) when the boxes can be at least 124 px wide; otherwise
  // top-to-bottom (phones), which is usually narrower. Box width stretches to use the space.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hW = Math.floor((width - 44 * (layers.length - 1)) / layers.length);
  const vertical = hW < 124;
  const maxLayer = layers.length - 1;
  const g = vertical
    ? { nodeW: clamp(Math.floor((width - 10 * (widest - 1)) / widest), 104, 160), nodeH: 44, gapMain: 40, gapCross: 10 }
    : { nodeW: clamp(hW, 124, 200), nodeH: 44, gapMain: 48, gapCross: 12 };
  const DUMMY = 10; // room a passing line takes up in a layer
  const boxMain = vertical ? g.nodeH : g.nodeW;
  const boxCross = vertical ? g.nodeW : g.nodeH;
  const size = (n) => (n.dummy ? DUMMY : boxCross);
  const extent = (l) => l.reduce((s, n) => s + size(n), 0) + g.gapCross * Math.max(0, l.length - 1);
  const span = Math.max(...layers.map(extent));
  const main = (layer) => (maxLayer - layer) * (boxMain + g.gapMain);
  const at = new Map(); // id -> {m: main start, c: cross start}
  for (const l of layers) {
    let c = (span - extent(l)) / 2;
    for (const n of [...l].sort((a, b) => a.order - b.order)) {
      at.set(n.id, { m: main(n.layer), c });
      c += size(n) + g.gapCross;
    }
  }
  const xy = (m, c) => (vertical ? `${c.toFixed(1)},${m.toFixed(1)}` : `${m.toFixed(1)},${c.toFixed(1)}`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mid = (id) => at.get(id).c + size(byId.get(id)) / 2;
  const pad = 6;
  const mainLen = layers.length * (boxMain + g.gapMain) - g.gapMain;
  const W = (vertical ? span : mainLen) + 2 * pad;
  const Hh = (vertical ? mainLen : span) + 2 * pad;

  const svg = el("svg", { viewBox: `${-pad} ${-pad} ${W} ${Hh}`, width: W, height: Hh, class: "pathgraph", role: "img",
    "aria-label": `AS path graph of ${entries.length} peer path(s)` });
  const edgeLayer = el("g", { class: "edges" }, svg);
  const nodeLayer = el("g", { class: "nodes" }, svg);

  const asnOf = new Map(nodes.map((n) => [n.id, n.asn]));
  const maxUsers = Math.max(...edges.map((e) => e.users.length));
  for (const e of edges) {
    // Leave each box from its origin-side edge, pass straight through waypoints, enter the next box.
    const ids = e.chain;
    let m0 = at.get(ids[0]).m + boxMain, c0 = mid(ids[0]);
    let d = `M${xy(m0, c0)}`;
    for (let k = 1; k < ids.length; k++) {
      const m1 = at.get(ids[k]).m, c1 = mid(ids[k]), h = (m1 - m0) / 2;
      d += ` C${xy(m0 + h, c0)} ${xy(m1 - h, c1)} ${xy(m1, c1)}`;
      m0 = m1 + boxMain; c0 = c1;
      if (k < ids.length - 1) d += ` L${xy(m0, c0)}`;
    }
    const w = 1.5 + 3.5 * (e.users.length - 1) / Math.max(1, maxUsers - 1);
    const p = el("path", { d, class: "edge", "stroke-width": w.toFixed(1), "data-users": e.users.join(" ") }, edgeLayer);
    el("title", {}, p).textContent = `AS${asnOf.get(e.from)} → AS${asnOf.get(e.to)}: ${e.users.map((i) => entries[i].label).join(", ")}`;
  }

  const nameMax = Math.floor((g.nodeW - 18) / 5.9);
  for (const n of nodes) {
    if (n.dummy) continue;
    const { m, c } = at.get(n.id);
    const [x, y] = vertical ? [c, m] : [m, c];
    const asn = n.asn;
    const isSet = asn.startsWith("{");
    const users = entries.map((e, i) => {
      const h = hops(e.path);
      return (n.peer ? h[0] === asn : h.slice(1).includes(asn)) ? i : -1;
    }).filter((i) => i >= 0);
    const kind = n.origin ? "origin" : n.peer ? "peer" : "transit";
    const a = el("a", isSet ? {} : { href: `https://bgp.tools/as/${asn}`, target: "_blank", rel: "noopener" }, nodeLayer);
    const grp = el("g", { class: `node ${kind}`, transform: `translate(${x},${y})`, "data-users": users.join(" ") }, a);
    el("rect", { width: g.nodeW, height: g.nodeH, rx: 10 }, grp);
    const label = isSet ? fit(`{${asn.slice(1, -1).split(",").map((s) => `AS${s}`).join(", ")}}`, nameMax + 2) : `AS${asn}`;
    el("text", { x: 10, y: 18, class: "num" }, grp).textContent = label;
    const nameEl = el("text", { x: 10, y: 34, class: "name" }, grp);
    const tip = el("title", {}, grp);
    const role = n.origin ? "origin AS" : n.peer ? "peer AS" : "transit AS";
    tip.textContent = `${label} (${role}); used by ${users.map((i) => entries[i].label).join(", ")}`;
    if (isSet) {
      nameEl.textContent = "AS_SET (unordered)";
    } else {
      asName(Number(asn)).then(({ name }) => {
        if (!name) return;
        nameEl.textContent = fit(name, nameMax);
        tip.textContent = `AS${asn} ${name} (${role}); used by ${users.map((i) => entries[i].label).join(", ")}`;
      });
    }
  }

  const fig = document.createElement("figure");
  fig.className = "graph-card";
  const prefixes = [...new Set(entries.map((e) => e.prefix))];
  fig.innerHTML = `<figcaption>
      <strong>AS path graph</strong>
      <span class="muted small">${entries.length} peer path(s) to ${prefixes.map(esc).join(", ")}.
        Thicker lines are used by more peers. Point at or tap a peer below to highlight its path.</span>
    </figcaption>
    <p class="graph-hint small muted" hidden>Swipe sideways to see the whole graph.</p>
    <div class="graph-scroll"></div>
    <div class="graph-peers">${entries.map((e, i) =>
      `<button type="button" class="peer-chip" data-i="${i}">${esc(e.label)}${prefixes.length > 1 ? ` <span class="muted">(${esc(e.prefix)})</span>` : ""}</button>`).join("")}</div>
    <div class="graph-legend small muted">
      <span><i class="dot peer"></i>peer</span><span><i class="dot transit"></i>transit</span><span><i class="dot origin"></i>origin</span>
    </div>`;
  fig.querySelector(".graph-scroll").appendChild(svg);

  requestAnimationFrame(() => {
    const box = fig.querySelector(".graph-scroll");
    const overflow = box.scrollWidth - box.clientWidth;
    fig.querySelector(".graph-hint").hidden = overflow <= 2;
    if (overflow > 2) box.scrollLeft = overflow / 2; // start in the middle, where paths usually meet
  });

  let pinned = null;
  const highlight = (i) => {
    svg.classList.toggle("focus", i != null);
    for (const item of svg.querySelectorAll("[data-users]")) {
      item.classList.toggle("on", i != null && item.dataset.users.split(" ").includes(String(i)));
    }
    for (const b of fig.querySelectorAll(".peer-chip")) b.classList.toggle("on", i != null && b.dataset.i === String(i));
  };
  for (const b of fig.querySelectorAll(".peer-chip")) {
    const i = Number(b.dataset.i);
    b.addEventListener("mouseenter", () => pinned == null && highlight(i));
    b.addEventListener("mouseleave", () => pinned == null && highlight(null));
    b.addEventListener("click", () => { pinned = pinned === i ? null : i; highlight(pinned); });
  }
  // Pointing at a peer's own box in the graph highlights its path too.
  for (const node of svg.querySelectorAll(".node.peer, .node.origin")) {
    const users = node.dataset.users.split(" ");
    if (!node.classList.contains("peer") || users.length !== 1) continue;
    const i = Number(users[0]);
    node.addEventListener("mouseenter", () => pinned == null && highlight(i));
    node.addEventListener("mouseleave", () => pinned == null && highlight(null));
  }
  return fig;
}
