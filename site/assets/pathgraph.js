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
  const layers = [];
  for (const n of nodes.values()) (layers[n.layer] ||= []).push(n);
  for (let i = 0; i < layers.length; i++) layers[i] ||= [];
  layers.forEach((l) => l.sort((a, b) => a.first - b.first).forEach((n, k) => { n.order = k; }));
  // A few sweeps placing each AS near the average position of its neighbours (fewer crossings).
  const nbrs = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const e of edges.values()) { nbrs.get(e.from).push(e.to); nbrs.get(e.to).push(e.from); }
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 ? [...layers.keys()] : [...layers.keys()].reverse();
    for (const li of order) {
      const l = layers[li];
      for (const n of l) {
        const ns = nbrs.get(n.id).map((id) => nodes.get(id)).filter((m) => m.layer !== n.layer);
        n.bary = ns.length ? ns.reduce((s, m) => s + m.order, 0) / ns.length : n.order;
      }
      l.sort((a, b) => a.bary - b.bary || a.first - b.first).forEach((n, k) => { n.order = k; });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], layers };
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
  const widest = Math.max(...layers.map((l) => l.length));

  // Horizontal (peers left, origin right) when the boxes can be at least MIN_W wide; otherwise
  // top-to-bottom (phones), which is usually narrower. Box width stretches to use the space.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hW = Math.floor((width - 44 * (layers.length - 1)) / layers.length);
  const vertical = hW < 124;
  const maxLayer = layers.length - 1;
  const g = vertical
    ? { nodeW: clamp(Math.floor((width - 10 * (widest - 1)) / widest), 104, 160), nodeH: 44, gapMain: 40, gapCross: 10 }
    : { nodeW: clamp(hW, 124, 200), nodeH: 44, gapMain: 44, gapCross: 14 };
  const main = (layer) => (maxLayer - layer) * ((vertical ? g.nodeH : g.nodeW) + g.gapMain);
  const crossSize = (vertical ? g.nodeW : g.nodeH) + g.gapCross;
  const span = widest * crossSize - g.gapCross;
  const pos = new Map();
  for (const n of nodes) {
    const count = layers[n.layer].length;
    const offset = (span - (count * crossSize - g.gapCross)) / 2;
    const cross = offset + n.order * crossSize;
    pos.set(n.id, vertical ? { x: cross, y: main(n.layer) } : { x: main(n.layer), y: cross });
  }
  const pad = 6;
  const W = (vertical ? span : layers.length * (g.nodeW + g.gapMain) - g.gapMain) + 2 * pad;
  const Hh = (vertical ? layers.length * (g.nodeH + g.gapMain) - g.gapMain : span) + 2 * pad;

  const svg = el("svg", { viewBox: `${-pad} ${-pad} ${W} ${Hh}`, width: W, height: Hh, class: "pathgraph", role: "img",
    "aria-label": `AS path graph of ${entries.length} peer path(s)` });
  const edgeLayer = el("g", { class: "edges" }, svg);
  const nodeLayer = el("g", { class: "nodes" }, svg);

  const asnOf = new Map(nodes.map((n) => [n.id, n.asn]));
  const maxUsers = Math.max(...edges.map((e) => e.users.length));
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    let d;
    if (vertical) {
      const x1 = a.x + g.nodeW / 2, y1 = a.y + g.nodeH, x2 = b.x + g.nodeW / 2, y2 = b.y, m = (y1 + y2) / 2;
      d = `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`;
    } else {
      const x1 = a.x + g.nodeW, y1 = a.y + g.nodeH / 2, x2 = b.x, y2 = b.y + g.nodeH / 2, m = (x1 + x2) / 2;
      d = `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
    }
    const w = 1.5 + 3.5 * (e.users.length - 1) / Math.max(1, maxUsers - 1);
    const p = el("path", { d, class: "edge", "stroke-width": w.toFixed(1), "data-users": e.users.join(" ") }, edgeLayer);
    el("title", {}, p).textContent = `AS${asnOf.get(e.from)} → AS${asnOf.get(e.to)}: ${e.users.map((i) => entries[i].label).join(", ")}`;
  }

  const nameMax = Math.floor((g.nodeW - 18) / 5.9);
  for (const n of nodes) {
    const { x, y } = pos.get(n.id);
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
  return fig;
}
