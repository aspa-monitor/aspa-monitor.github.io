// AS path graph: the paths every peer uses to reach a prefix, merged into one picture.
// Peers sit on one side, the origin AS on the other; an AS that several paths share is drawn once.
// Each peer's path has its own colour (fixed per peer: manifest "colour", kept across builds); where paths share a hop
// their lines run side by side. Pointing at (or tapping) a peer chip or box highlights that one path.
// Peers whose paths are identical after their own AS are merged into one box and one set of lines for this
// search (peergroups.js) when the reader picks "All sources"; by default at most MAX_GROUPS single peers are drawn.
// On a narrow card (phones, COMPACT_W) the graph is compact: at most MAX_GROUPS_PHONE peers, boxes with the AS
// number only (tap a box for its name), and Top to bottom by default, so it fits without sideways scrolling.
import { asName, shortName } from "./asnames.js";
import { checkRov, rovDate } from "./rov.js";
import { pairFor, combineMarks } from "./aspapath.js";
import { REL, relation, aspaDisagrees } from "./asrel.js";
import { hops, groupPeers, singlePeers, pickPeers, packLines } from "./peergroups.js";
import { SUBREGIONS, continentOf, continentText, nearGroups, saveRegion, visitorRegion } from "./regions.js";

export { hops };
export const MAX_GROUPS = 6;
export const MAX_GROUPS_PHONE = 3;
export const COMPACT_W = 600; // graph width (px) below which the compact phone graph is drawn

const SVG = "http://www.w3.org/2000/svg";
// 16 colours (style.css --peer-1 .. --peer-16), all solid lines; slots beyond 15 share a neutral grey.
const SLOTS = 16;
export const peerColour = (slot) => (slot != null && slot < SLOTS ? `var(--peer-${slot + 1})` : "var(--muted)");
const ROV_LINE = 17; // extra height of an origin box for its ROV badge
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Layout without coordinates. entries: [{label, prefix, path, peers?}] (peers: the member ASes of a merged
 * group, which share one box). Returns {nodes: [{id, asn, peers, users, layer, order, peer, origin}],
 * edges: [{from, to, users: [entry index]}], layers}
 * layer 0 = origin side; every peer sits in the outermost layer. A peer's own box is separate from the
 * box for the same AS as a transit hop on other peers' paths (e.g. AS4777 -> AS2497, where AS2497 is
 * also a peer), so the peers always line up and lines never run backwards.
 */
export function layout(entries) {
  const paths = entries.map((e) => hops(e.path));
  const nodes = new Map();
  const edges = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { id, layer: 0, order: 0, peer: false, origin: false, users: [], first: nodes.size });
    return nodes.get(id);
  };
  paths.forEach((p, i) => {
    const peers = entries[i].peers || [p[0]];
    const ids = p.map((asn, j) => (j === 0 ? `peer:${peers.join("+")}` : asn));
    ids.forEach((id, j) => {
      const n = node(id);
      n.asn = p[j];
      n.layer = Math.max(n.layer, p.length - 1 - j);
      if (!n.users.includes(i)) n.users.push(i);
      if (j === 0) { n.peer = true; n.peers = peers; }
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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Build the graph block (a <figure>) for the lookup page, or null when there is nothing to draw.
 * peerEntries: one per distinct path per peer, in manifest order:
 *   [{label, name (display name or null), source, prefix, path, slot, aspa (path verdict or null), split}].
 * peers "best" (default): at most MAX_GROUPS peers, each with its own box and line, chosen so their paths differ
 * as much as possible (pickPeers). peers "near": the same pick among peers in `region` (the visitor's UN M49
 * sub-region; widened to its continent when it has too few peers here, see regions.js nearGroups); falls back to
 * the best peers when none is near. peers "all": every peer, with peers whose paths match after their own AS
 * merged into one box (fresh for this search).
 */
export function renderPathGraph(peerEntries, { width = 900, peers = "best", variant = "paths", direction = "lr",
  controls = null, cap = MAX_GROUPS, compact = false, region = null } = {}) {
  // controls: an element put above the caption (renderGraphPanel's tabs and choices).
  // variant "rel": the second map (trial) — same boxes and chips, but one line per AS pair coloured by the
  // inferred AS relationship (asrel.js), instead of one line per peer path.
  const rel = variant === "rel";
  peerEntries = peerEntries.filter((e) => hops(e.path).length);
  if (!peerEntries.length) return null;
  const allGroups = groupPeers(peerEntries); // distinct paths, for the counts and the ASPA tally
  let groups, near = null;
  if (peers === "all") groups = allGroups;
  else if (peers === "near") {
    const singles = singlePeers(peerEntries);
    const first = (g) => peerEntries[g.members[0]];
    near = nearGroups(singles, region, (g) => first(g).region, (g) => first(g).source ?? g.peers[0]);
    groups = pickPeers(near.groups.length ? near.groups : singles, cap);
  } else groups = pickPeers(singlePeers(peerEntries), cap);
  // One drawn entry per group: the first member's path and colour.
  const entries = groups.map((gr) => {
    const members = gr.members.map((i) => peerEntries[i]);
    return { prefix: gr.prefix, path: gr.path, peers: gr.peers, members, slot: members[0].slot,
      label: members.map((m) => m.label).join(" + ") };
  });
  const svg = drawGraph(entries, width, variant, direction, compact);
  const hasMarks = entries.some((e) => (e.members || []).some((m) => m.aspaPairs));

  const fig = document.createElement("figure");
  fig.className = "graph-card";
  const prefixes = [...new Set(entries.map((e) => e.prefix))];
  const peerCount = new Set(peerEntries.map((e) => e.source ?? e.label)).size;
  const cut = peers !== "all" && peerEntries.length > groups.length;
  const shown = plural(groups.length, "peer");
  const nearText = !near ? "" : near.scope === "region" ? ` (${shown} near you, in ${near.region}, shown)`
    : near.scope === "continent" ? ` (${near.region} has ${plural(near.sources, "peer")} with a route here, so ${shown} in ` +
      `${continentText(continentOf(near.region))} shown)`
    : near.region ? ` (no peer in ${continentText(continentOf(near.region))} has a route here, so the ${shown} with the most different paths shown)`
    : ` (your region is not known: pick one under Region; the ${shown} with the most different paths shown)`;
  const counts = `${plural(peerCount, "peer")}, ${plural(allGroups.length, "distinct path")}` +
    (near ? nearText : cut ? ` (${groups.length} peers with the most different paths shown)` : "");
  const merged = entries.some((e) => e.members.length > 1);
  // ASPA path verdicts (from lookup.js; members of a group always share one, see entry.split).
  const verdictOf = (gr) => peerEntries[gr.members[0]].aspa;
  const tally = { valid: 0, invalid: 0, unknown: 0 };
  for (const gr of allGroups) if (verdictOf(gr) in tally) tally[verdictOf(gr)]++;
  const aspaLine = allGroups.some((gr) => verdictOf(gr) in tally)
    ? ` ASPA: ${tally.valid} valid, ${tally.invalid} invalid, ${tally.unknown} unknown.` : "";
  const VTONE = { valid: "valid", invalid: "invalid", unknown: "none" };
  const vtag = (v) => (v in VTONE ? ` <span class="vtag ${VTONE[v]}" title="ASPA path verdict">ASPA ${v}</span>` : "");
  fig.innerHTML = `<figcaption>
      <strong>${rel ? "AS relationships (inferred) <span class=\"tag\">trial</span>" : "AS path graph"}</strong>
      <span class="graph-counts">${esc(counts)} to ${prefixes.map(esc).join(", ")}.${esc(aspaLine)}</span>
      <span class="muted small">${rel
        ? `The same paths, with each line showing how the two networks probably relate, inferred by
          <a href="https://bgpkit.com/api">BGPKIT</a> from observed routes (not published by the networks, so it can be
          wrong). <b>!</b> marks a pair where this and ASPA disagree. Point at a label for details, or at a peer to highlight its path.`
        : `Each path has its own colour; lines run side by side where paths share an AS.
        ${merged ? "Peers with the same path after their own AS share one box and one line (the first peer's colour). " : ""}${compact
          ? "Tap a peer to highlight its path, or a box or mark for details." : "Point at or tap a peer to highlight its path."}`}</span>
    </figcaption>
    <p class="graph-hint small muted" hidden>Swipe sideways to see the whole graph.</p>
    <div class="graph-scroll"></div>
    <p class="graph-info small" hidden></p>
    <div class="graph-peers">${entries.map((e, i) =>
      `<button type="button" class="peer-chip" data-i="${i}">${e.members.map((m) =>
        `<i class="swatch" style="--sw:${peerColour(m.slot)}"></i>`).join("")}` +
      `${esc(e.label)}${prefixes.length > 1 ? ` <span class="muted">(${esc(e.prefix)})</span>` : ""}${vtag(e.members[0].aspa)}</button>`).join("")}</div>
    <div class="graph-legend small muted">${rel ? Object.entries(REL).map(([k, r]) =>
      `<span><b class="relkey ${k}">${r.glyph}</b>${esc(r.name)}</span>`).join("") +
      '<span><b class="relkey flag">!</b>disagrees with ASPA</span></div>' : `
      <span><i class="dot peer"></i>peer</span><span><i class="dot transit"></i>transit</span><span><i class="dot origin"></i>origin AS</span><span>origin outline, RPKI ROV:</span><span><i class="dot rov valid"></i>valid</span><span><i class="dot rov invalid"></i>invalid</span><span><i class="dot rov none"></i>not found</span>${hasMarks ? `<span><b class="pm bad">✗</b>pair that breaks ASPA</span><span><b class="pm ok wide">${direction === "tb" ? "↑✓" : "←✓"}</b>authorised pair: route goes up to a provider (the arrow points at the provider)</span><span><b class="pm ok wide">${direction === "tb" ? "✓↓" : "✓→"}</b>authorised pair: route comes down from a provider to its customer</span>` : ""}
    </div>`}`;
  fig.querySelector(".graph-scroll").appendChild(svg);
  if (controls) fig.prepend(controls);

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
  for (const node of svg.querySelectorAll(".node.peer")) {
    const users = node.dataset.users.split(" ");
    if (users.length !== 1) continue;
    const i = Number(users[0]);
    node.addEventListener("mouseenter", () => pinned == null && highlight(i));
    node.addEventListener("mouseleave", () => pinned == null && highlight(null));
  }
  // Compact (phones): tooltips don't show on touch, so tapping a box, ROV pill or line mark writes its tooltip
  // (AS name, role, verdict) in a line under the graph; tapping a peer box also pins its path.
  if (compact) {
    const info = fig.querySelector(".graph-info");
    svg.addEventListener("click", (ev) => {
      const item = ev.target.closest(".rov-pill, .node, .pairmark, .relmark");
      const tip = item && item.querySelector(":scope > title");
      if (!tip) return;
      info.textContent = tip.textContent;
      info.hidden = false;
      const node = ev.target.closest(".node.peer");
      if (node && !node.dataset.users.includes(" ")) {
        const i = Number(node.dataset.users);
        pinned = pinned === i ? null : i; highlight(pinned);
      }
    });
  }
  return fig;
}

const ROV_TEXT = { valid: "ROV valid", invalid: "ROV invalid", none: "ROV not found" };
// Compact boxes are narrow: a symbol instead of the word (the tooltip / tap line has the full text).
const ROV_SHORT = { valid: "ROV ✓", invalid: "ROV ✗", none: "ROV –", mixed: "ROV ±", pending: "ROV …", error: "ROV ?" };
export const ROV_SHORT_W = 46; // width of the widest short pill

/**
 * RPKI ROV pill in an origin box at (x, y), plus the box's verdict colour: the same verdict and request as the
 * route cards (rov.js).
 * If the origin announces several matched prefixes with different verdicts, the pill says "mixed".
 */
function rovBadge(grp, x, y, asn, prefixes, compact = false) {
  const pill = el("g", { class: "rov-pill pending", transform: `translate(${x},${y})` }, grp);
  const rect = el("rect", { width: 70, height: 16, rx: 8 }, pill);
  const text = el("text", { x: 7, y: 11.5 }, pill);
  const tip = el("title", {}, pill);
  const set = (label, tone, tipText) => {
    text.textContent = label;
    pill.setAttribute("class", `rov-pill ${tone}`);
    // The whole origin box is outlined in the verdict's colour: green valid, red invalid, grey not found.
    grp.classList.remove("rov-valid", "rov-invalid", "rov-none", "rov-pending");
    grp.classList.add(`rov-${tone}`);
    rect.setAttribute("width", String(compact ? ROV_SHORT_W : Math.ceil(label.length * 6.2 + 14)));
    tip.textContent = tipText;
  };
  const short = (key, long) => (compact ? ROV_SHORT[key] : long);
  set(short("pending", "ROV …"), "pending", "Checking RPKI ROV…");
  Promise.all(prefixes.map((p) => checkRov(p, asn).then((r) => ({ p, ...r })))).then((rs) => {
    const tones = new Set(rs.map((r) => r.view.tone));
    const detail = rs.map((r) => `${r.p} from AS${asn}: ${r.view.label}. ${r.view.text}`).join("\n");
    const when = `RPKI data of ${rovDate(rs[0].date)}, via BGPKIT`;
    const tone = rs[0].view.tone;
    if (tones.size === 1) set(short(tone in ROV_SHORT ? tone : "error", ROV_TEXT[tone] || `ROV ${rs[0].view.label}`), tone, `${detail}\n${when}`);
    else set(short("mixed", "ROV mixed"), "none", `${detail}\n${when}`);
  }, (e) => set(short("error", "ROV ?"), "none", `Could not check RPKI ROV: BGPKIT did not answer (${e.message})`));
}

/**
 * ASPA mark for a drawn line from e.from (nearer the peer) to e.to (nearer the origin): the route went to -> from.
 * Every member peer behind the line counts; on a merged peer box's own line each member has its own peer AS.
 */
function edgeAspa(e, entries, byId, asnOf) {
  const far = asnOf.get(e.to), fromPeer = byId.get(e.from).peer;
  const pairs = [];
  for (const u of e.users) {
    for (const m of entries[u].members || []) {
      if (!m.aspaPairs) continue;
      pairs.push(pairFor(m.aspaPairs, fromPeer ? hops(m.path)[0] : asnOf.get(e.from), far));
    }
  }
  return combineMarks(pairs);
}

/** The SVG for drawn entries [{label, prefix, path, peers, members, slot}]. */
function drawGraph(entries, width, variant = "paths", direction = "lr", compact = false) {
  const { nodes, edges, layers } = layout(entries);
  const widest = Math.max(...layers.map((l) => l.filter((n) => !n.dummy).length));

  // direction "lr" (default): peers left, origin right; "tb": peers on top, origin at the bottom. Box width
  // stretches to use the space; when it can't fit (phones) the graph scrolls sideways.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const vertical = direction === "tb";
  const maxLayer = layers.length - 1;
  let g;
  if (compact) {
    // Phones: AS number only, so a box only needs room for the longest number (and the origin's short ROV pill).
    const longest = Math.max(...nodes.filter((n) => !n.dummy).map((n) => Math.min(12, `AS${n.asn}`.length)));
    const need = Math.ceil(Math.max(longest * 7.7 + 24, ROV_SHORT_W + 18));
    g = vertical
      ? { nodeW: clamp(Math.floor((width - 8 * (widest - 1)) / widest), need, 120), nodeH: 30, gapMain: 34, gapCross: 8 }
      : { nodeW: clamp(Math.floor((width - 40 * maxLayer) / layers.length), need, 120), nodeH: 30, gapMain: 40, gapCross: 8 };
  } else {
    const hW = Math.floor((width - 44 * maxLayer) / layers.length);
    g = vertical
      ? { nodeW: clamp(Math.floor((width - 10 * (widest - 1)) / widest), 104, 160), nodeH: 44, gapMain: 40, gapCross: 10 }
      : { nodeW: clamp(hW, 124, 200), nodeH: 44, gapMain: 48, gapCross: 12 };
  }
  const DUMMY = 4 + 3.4 * Math.max(...edges.map((e) => e.users.length)); // room passing lines take up

  // Box text. A merged peer box lists every member AS (wrapping as needed) and their names (one line,
  // shortened if needed; the tooltip has all), so it can be taller than the others. Compact boxes have no names.
  const nameMax = Math.floor((g.nodeW - 18) / 5.9);
  const numMax = Math.floor((g.nodeW - 22) / 7.7);
  const nameH = compact ? 0 : 16;
  for (const n of nodes) {
    if (n.dummy) continue;
    const group = n.peer && (n.peers.length > 1 || entries[n.users[0]].members.length > 1);
    n.numLines = group ? packLines(n.peers.map((a) => `AS${a}`), numMax) : null;
    n.h = group ? 18 + 15 * (n.numLines.length - 1) + nameH + 10 : g.nodeH; // single box: 18 + 16 + 10 = 44 (compact 30)
    // The origin box gets a third line: the RPKI ROV verdict for (prefix, origin).
    n.rov = n.origin && /^\d+$/.test(n.asn);
    if (n.rov) n.h += ROV_LINE;
  }
  // Horizontal: boxes are nodeW wide and as tall as their text. Vertical: every box in a row has the row's height.
  const rowH = layers.map((l) => Math.max(g.nodeH, ...l.filter((n) => !n.dummy).map((n) => n.h)));
  const mainSize = (layer) => (vertical ? rowH[layer] : g.nodeW);
  const size = (n) => (n.dummy ? DUMMY : vertical ? g.nodeW : n.h);
  const extent = (l) => l.reduce((s, n) => s + size(n), 0) + g.gapCross * Math.max(0, l.length - 1);
  const span = Math.max(...layers.map(extent));
  const mainAt = [];
  for (let L = maxLayer, m = 0; L >= 0; L--) { mainAt[L] = m; m += mainSize(L) + g.gapMain; }
  const at = new Map(); // id -> {m: main start, c: cross start}
  for (const l of layers) {
    let c = (span - extent(l)) / 2;
    for (const n of [...l].sort((a, b) => a.order - b.order)) {
      at.set(n.id, { m: mainAt[n.layer], c });
      c += size(n) + g.gapCross;
    }
  }
  const xy = (m, c) => (vertical ? `${c.toFixed(1)},${m.toFixed(1)}` : `${m.toFixed(1)},${c.toFixed(1)}`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mid = (id) => at.get(id).c + size(byId.get(id)) / 2;
  const pad = 6;
  const mainLen = mainAt[0] + mainSize(0);
  const W = (vertical ? span : mainLen) + 2 * pad;
  const Hh = (vertical ? mainLen : span) + 2 * pad;

  const svg = el("svg", { viewBox: `${-pad} ${-pad} ${W} ${Hh}`, width: W, height: Hh, class: "pathgraph", role: "img",
    style: `--natural-w:${W}px`,
    "aria-label": `AS path graph of ${entries.length} path(s)` });
  const edgeLayer = el("g", { class: "edges" }, svg);
  const nodeLayer = el("g", { class: "nodes" }, svg);
  const markLayer = el("g", { class: "pairmarks" }, svg); // above boxes and lines

  const asnOf = new Map(nodes.map((n) => [n.id, n.asn]));
  const LANE = 3.4; // distance between side-by-side lines
  // Second map: one centred line per AS pair, coloured once BGPKIT answers, with a label in the gap.
  const gapPoint = (e) => {
    const ids = e.chain, k = Math.floor((ids.length - 1) / 2) + 1; // segment ids[k-1] -> ids[k]
    const out = (id) => at.get(id).m + mainSize(byId.get(id).layer);
    const mm = (out(ids[k - 1]) + at.get(ids[k]).m) / 2, cc = (mid(ids[k - 1]) + mid(ids[k])) / 2;
    return vertical ? [cc, mm] : [mm, cc];
  };
  const relEdge = (e) => {
    const ids = e.chain;
    const out = (id) => at.get(id).m + mainSize(byId.get(id).layer);
    let m0 = out(ids[0]), c0 = mid(ids[0]);
    let d = `M${xy(m0, c0)}`;
    for (let k = 1; k < ids.length; k++) {
      const m1 = at.get(ids[k]).m, c1 = mid(ids[k]), h = (m1 - m0) / 2;
      d += ` C${xy(m0 + h, c0)} ${xy(m1 - h, c1)} ${xy(m1, c1)}`;
      m0 = out(ids[k]); c0 = c1;
      if (k < ids.length - 1) d += ` L${xy(m0, c0)}`;
    }
    const line = el("path", { d, class: "edge rel pending", "data-users": e.users.join(" ") }, edgeLayer);
    const [x, y] = gapPoint(e);
    const lab = el("g", { class: "relmark pending", transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`,
      "data-users": e.users.join(" ") }, markLayer);
    el("circle", { r: 8 }, lab);
    const t = el("text", { "text-anchor": "middle", y: 4 }, lab);
    t.textContent = "…";
    const tip = el("title", {}, lab);
    tip.textContent = "Looking up the AS relationship…";
    el("title", {}, line);
    // Who is "near" (nearer the peer): on a merged peer box's own line, each member peer is its own near AS.
    const far = asnOf.get(e.to), fromPeer = byId.get(e.from).peer;
    const sides = [];
    for (const u of e.users) {
      for (const m of entries[u].members || [{ path: entries[u].path }]) {
        const near = fromPeer ? hops(m.path)[0] : asnOf.get(e.from);
        if (!sides.some((x) => x.near === near)) sides.push({ near, pair: pairFor(m.aspaPairs, near, far) });
      }
    }
    const numeric = /^\d+$/;
    if (!numeric.test(far) || sides.some((x) => !numeric.test(x.near))) {
      const k = "unknown";
      line.setAttribute("class", `edge rel ${k}`); lab.setAttribute("class", `relmark ${k}`); t.textContent = REL[k].glyph;
      tip.textContent = "AS_SET: no relationship to look up";
      return;
    }
    Promise.all(sides.map((x) => relation(far, x.near).then((r) => ({ ...x, ...r })))).then((rs) => {
      const kinds = [...new Set(rs.map((r) => r.kind))];
      const kind = kinds.length === 1 ? kinds[0] : "mixed";
      const flags = rs.map((r) => aspaDisagrees(r.kind, r.pair, far, r.near)).filter(Boolean);
      line.setAttribute("class", `edge rel ${kind}`);
      lab.setAttribute("class", `relmark ${kind}${flags.length ? " flag" : ""}`);
      t.textContent = flags.length ? "!" : REL[kind].glyph;
      const lines = rs.map((r) => REL[r.kind].text(far, r.near));
      const text = [...lines, ...flags.map((f) => f.text)].join("\n") +
        (rs[0].date ? `\nInferred by BGPKIT, snapshot of ${rs[0].date}.` : "");
      tip.textContent = text;
      line.querySelector("title").textContent = text;
    }, (err) => {
      line.setAttribute("class", "edge rel unknown"); lab.setAttribute("class", "relmark unknown"); t.textContent = "?";
      tip.textContent = `Could not look up the relationship: BGPKIT did not answer (${err.message})`;
    });
  };
  for (const e of edges) {
    if (variant === "rel") { relEdge(e); continue; }
    const users = [...e.users].sort((a, b) => (entries[a].slot ?? a) - (entries[b].slot ?? b));
    users.forEach((u, k) => {
      const off = (k - (users.length - 1) / 2) * LANE;
      // Leave each box from its origin-side edge, pass straight through waypoints, enter the next box.
      const ids = e.chain;
      const out = (id) => at.get(id).m + mainSize(byId.get(id).layer);
      let m0 = out(ids[0]), c0 = mid(ids[0]) + off;
      let d = `M${xy(m0, c0)}`;
      for (let s = 1; s < ids.length; s++) {
        const m1 = at.get(ids[s]).m, c1 = mid(ids[s]) + off, h = (m1 - m0) / 2;
        d += ` C${xy(m0 + h, c0)} ${xy(m1 - h, c1)} ${xy(m1, c1)}`;
        m0 = out(ids[s]); c0 = c1;
        if (s < ids.length - 1) d += ` L${xy(m0, c0)}`;
      }
      const slot = entries[u].slot;
      const p = el("path", { d, class: "edge", "data-users": String(u),
        style: `stroke:${peerColour(slot)}` }, edgeLayer);
      el("title", {}, p).textContent = `${entries[u].label}: AS${asnOf.get(e.from)} → AS${asnOf.get(e.to)}`;
    });
    // ASPA mark for this pair, in the gap between the two boxes (middle segment of the line's route).
    const { mark, texts, provider } = edgeAspa(e, entries, byId, asnOf);
    if (mark !== "none") {
      const ids = e.chain, s = Math.floor((ids.length - 1) / 2) + 1; // segment ids[s-1] -> ids[s]
      const out = (id) => at.get(id).m + mainSize(byId.get(id).layer);
      const mm = (out(ids[s - 1]) + at.get(ids[s]).m) / 2, cc = (mid(ids[s - 1]) + mid(ids[s])) / 2;
      const [x, y] = vertical ? [cc, mm] : [mm, cc];
      const pm = el("g", { class: `pairmark ${mark}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`,
        "data-users": e.users.join(" ") }, markLayer);
      // An authorised pair gets an arrow pointing at the provider (the peer side is left / top).
      const arrow = provider && (vertical ? { near: "↑", far: "↓", both: "↕" } : { near: "←", far: "→", both: "↔" })[provider];
      if (arrow) {
        el("rect", { x: -17, y: -9, width: 34, height: 18, rx: 9, class: "pill" }, pm);
        const t = el("text", { "text-anchor": "middle", y: 4.3, class: "wide" }, pm);
        t.textContent = provider === "near" ? `${arrow}✓` : `✓${arrow}`;
      } else {
        el("circle", { r: 7.5 }, pm);
        el("text", { "text-anchor": "middle", y: 3.6 }, pm).textContent = mark === "bad" ? "✗" : "✓";
      }
      el("title", {}, pm).textContent = `ASPA, AS${asnOf.get(e.to)} → AS${asnOf.get(e.from)}: ${texts.join("; ")}`;
    }
  }

  for (const n of nodes) {
    if (n.dummy) continue;
    const { m, c } = at.get(n.id);
    const [x, y] = vertical ? [c, m] : [m, c];
    const [bw, bh] = vertical ? [g.nodeW, rowH[n.layer]] : [g.nodeW, n.h];
    const asn = n.asn;
    const isSet = asn.startsWith("{");
    const users = n.users;
    const kind = n.origin ? "origin" : n.peer ? "peer" : "transit";
    // Tooltip: full registered name (the box shortens it) and role. Which paths pass here is left to the
    // lines and chips (tap a chip to highlight one path).
    const role = n.origin ? "origin" : n.peer ? "peer" : "transit";
    const grp = el("g", { class: `node ${kind}`, transform: `translate(${x},${y})`, "data-users": users.join(" ") }, nodeLayer);
    if (n.rov) el("rect", { x: -4, y: -4, width: bw + 8, height: bh + 8, rx: 13, class: "rov-ring" }, grp);
    el("rect", { width: bw, height: bh, rx: 10, class: "box" }, grp);
    if (n.peer && users.length === 1) {
      // One stripe segment per member peer, in its own colour.
      const members = entries[users[0]].members;
      const top = 9, len = (bh - 18) / members.length;
      members.forEach((mb, k) => {
        el("line", { x1: 6, x2: 6, y1: top + k * len + (k ? 1.5 : 0), y2: top + (k + 1) * len - (k < members.length - 1 ? 1.5 : 0),
          class: "stripe", style: `stroke:${peerColour(mb.slot)}` }, grp);
      });
    }
    const tx = n.peer ? 14 : 10;
    const tip = el("title", {}, grp);
    if (n.numLines) {
      // Merged peers: every member AS, then their names.
      n.numLines.forEach((line, k) => { el("text", { x: tx, y: 18 + 15 * k, class: "num" }, grp).textContent = line; });
      const nameEl = compact ? null : el("text", { x: tx, y: 18 + 15 * (n.numLines.length - 1) + 16, class: "name" }, grp);
      const members = entries[users[0]].members;
      const asList = n.peers.map((p) => `AS${p}`).join(" + ");
      // Several peers share this box, so each note names its peer.
      const notes = [...new Set(members.filter((mb) => mb.note).map((mb) => `${mb.name || mb.label}: ${mb.note}`))];
      const noteText = notes.length ? `\n${notes.join("\n")}` : "";
      tip.textContent = `${asList} · peers with the same path${noteText}`;
      Promise.all(n.peers.map(async (p) => {
        const named = members.find((mb) => mb.name && hops(mb.path)[0] === p);
        return named ? named.name : shortName((await asName(Number(p))).name) || `AS${p}`;
      })).then((names) => {
        if (nameEl) nameEl.textContent = fit(names.join(" + "), nameMax);
        tip.textContent = `${asList}: ${names.join(" + ")} · peers with the same path${noteText}`;
      });
      continue;
    }
    if (n.rov) rovBadge(grp, tx, bh - ROV_LINE - 4, Number(asn), [...new Set(users.map((i) => entries[i].prefix))], compact);
    const label = isSet ? fit(`{${asn.slice(1, -1).split(",").map((s) => `AS${s}`).join(", ")}}`, compact ? numMax : nameMax + 2) : `AS${asn}`;
    el("text", { x: tx, y: compact ? 19 : 18, class: "num" }, grp).textContent = label;
    const nameEl = compact ? null : el("text", { x: tx, y: 34, class: "name" }, grp);
    // A peer box also carries the manifest's note about that peer (e.g. which network most of its routes use).
    const peerNotes = n.peer ? [...new Set(users.flatMap((i) => (entries[i].members || [entries[i]]))
      .filter((mb) => mb.note && hops(mb.path)[0] === asn).map((mb) => mb.note))] : [];
    const noteText = peerNotes.length ? `\n${peerNotes.join("\n")}` : "";
    tip.textContent = `${label} · ${role}${noteText}`;
    if (isSet) {
      if (nameEl) nameEl.textContent = "AS_SET (unordered)";
      else tip.textContent = `${label} · AS_SET (unordered) · ${role}${noteText}`;
    } else {
      asName(Number(asn)).then(({ name }) => {
        if (!name) return;
        if (nameEl) nameEl.textContent = fit(shortName(name), nameMax); // full "HANDLE - Organisation" in the tooltip
        tip.textContent = `AS${asn} ${name} · ${role}${noteText}`;
      });
    }
  }
  return svg;
}

const DIRS = [["lr", "Left to right"], ["tb", "Top to bottom"]];
const peerChoices = (cap, withNear, region) => [["best", `${cap} best peers`],
  ...(withNear ? [["near", `Peers near you (${region || "pick a region"})`]] : []), ["all", "All sources (same paths merged)"]];
// Region picker: sub-regions grouped by continent.
const regionOptions = (current) => [...new Set(Object.values(SUBREGIONS))].map((c) =>
  `<optgroup label="${c}">${Object.keys(SUBREGIONS).filter((r) => SUBREGIONS[r] === c).map((r) =>
    `<option value="${r}"${r === current ? " selected" : ""}>${r}</option>`).join("")}</optgroup>`).join("");
// The layout choice is kept apart for phones (compact, Top to bottom by default) and wider screens (Left to right).
const DIR_KEY = "graphDirection", DIR_KEY_PHONE = "graphDirectionPhone";

/**
 * The lookup graph card: tabs for the path graph and (optionally) the AS relationship map, which peers to draw
 * (the best MAX_GROUPS, or all sources merged) and the layout (left to right / top to bottom, remembered in
 * localStorage). The choices carry over between tabs. Below COMPACT_W the graph is the compact phone one:
 * the best MAX_GROUPS_PHONE peers, AS numbers only, Top to bottom by default.
 */
export function renderGraphPanel(entries, { width = 900, withRel = false } = {}) {
  const compact = width < COMPACT_W;
  const cap = compact ? MAX_GROUPS_PHONE : MAX_GROUPS;
  const dirKey = compact ? DIR_KEY_PHONE : DIR_KEY, dirDefault = compact ? "tb" : "lr";
  let stored = dirDefault;
  try { stored = localStorage.getItem(dirKey) || dirDefault; } catch { /* storage blocked */ }
  const state = { variant: "paths", direction: DIRS.some(([k]) => k === stored) ? stored : dirDefault, peers: "best",
    region: visitorRegion() };
  // "Peers near you" only once the manifest tags sources with a region (ris-routing-data "region").
  const withNear = entries.some((e) => e.region);
  const wrap = document.createElement("div");
  wrap.className = "graph-panel";
  const draw = (focusSel) => {
    const bar = document.createElement("div");
    bar.className = "graph-bar";
    bar.innerHTML = (withRel ? `<div class="graph-tabs" role="tablist" aria-label="Graph">${[["paths", "AS paths"],
      ["rel", 'AS relationships <span class="tag">trial</span>']].map(([k, t]) =>
      `<button type="button" role="tab" class="graph-tab" data-v="${k}" aria-selected="${state.variant === k}">${t}</button>`).join("")}</div>` : "") +
      `<label class="graph-peers-pick"><span class="muted small">Peers</span><select class="graph-peers-sel">${peerChoices(cap, withNear, state.region).map(([k, t]) =>
        `<option value="${k}"${state.peers === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>` +
      (state.peers === "near" ? `<label class="graph-peers-pick"><span class="muted small">Region</span><select class="graph-region-sel graph-peers-sel">` +
        `${state.region ? "" : '<option value="" selected>Pick a region</option>'}${regionOptions(state.region)}</select></label>` : "") +
      `<div class="graph-dir" role="group" aria-label="Layout"><span class="muted small">Layout</span>${DIRS.map(([k, t]) =>
        `<button type="button" class="graph-dir-btn" data-d="${k}" aria-pressed="${state.direction === k}">${t}</button>`).join("")}</div>`;
    bar.querySelectorAll(".graph-tab").forEach((b) => b.addEventListener("click", () => {
      if (state.variant === b.dataset.v) return;
      state.variant = b.dataset.v; draw(`.graph-tab[data-v="${b.dataset.v}"]`);
    }));
    bar.querySelector(".graph-peers-sel").addEventListener("change", (ev) => {
      state.peers = ev.target.value; draw(".graph-peers-sel");
    });
    bar.querySelector(".graph-region-sel")?.addEventListener("change", (ev) => {
      if (!ev.target.value) return;
      state.region = ev.target.value; saveRegion(state.region); draw(".graph-region-sel");
    });
    bar.querySelectorAll(".graph-dir-btn").forEach((b) => b.addEventListener("click", () => {
      if (state.direction === b.dataset.d) return;
      state.direction = b.dataset.d;
      try { localStorage.setItem(dirKey, state.direction); } catch { /* storage blocked */ }
      draw(`.graph-dir-btn[data-d="${b.dataset.d}"]`);
    }));
    const fig = renderPathGraph(entries, { width, peers: state.peers, variant: state.variant, direction: state.direction,
      region: state.region,
      controls: bar, cap, compact });
    wrap.replaceChildren(fig);
    if (focusSel) wrap.querySelector(focusSel)?.focus({ preventScroll: true });
  };
  draw();
  return wrap.firstChild ? wrap : null;
}
