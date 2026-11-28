import { parseQuery, formatPrefix } from "./prefix.js";
import { loadManifest, lookup, MAX_LOAD_FILES, sourceLabel, collectorLabel, siteLabel } from "./risdata.js";
import { FLAG_INFO, splitList } from "./flags.js";
import { fillNames } from "./asnames.js";
import { formatIST, formatUnixIST, ago } from "./timefmt.js";
import { renderGraphPanel, peerColour } from "./pathgraph.js";
import { rovSlot, fillRov } from "./rov.js";
import { loadAspas, verifyPath, VERDICT_LABEL } from "./aspapath.js";
import { hops } from "./peergroups.js";

const MAX_LIST_ROWS = 200;
// Trial second map "AS relationships (inferred)" under the AS path graph. Set to false to remove it.
const SHOW_REL_MAP = true;
const STALE_HOURS = 3;

const $ = (sel) => document.querySelector(sel);
const form = $("#lookup-form");
const input = $("#q");
const select = $("#source");
const results = $("#results");
const banner = $("#freshness");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let manifest = null;

// ---------- small renderers ----------

function asChip(asn) {
  if (asn == null || asn === "") return "—";
  return `<span class="asn" data-asn="${esc(asn)}">` +
    `<span class="asnum">AS${esc(asn)}</span><span class="asname"></span></span>`;
}

function pathHtml(path) {
  if (!path) return '<span class="muted">(empty)</span>';
  return path.split(" ").map((tok) => {
    if (tok.startsWith("{")) {
      const members = tok.slice(1, -1).split(",").filter(Boolean);
      return `<span class="asset" title="AS_SET (unordered)">{ ${members.map(asChip).join(" ")} }</span>`;
    }
    return asChip(tok);
  }).join('<span class="arrow">→</span>');
}

function lookupLink(prefix, source) {
  const u = new URLSearchParams({ q: prefix, source });
  return `<a href="?${u}">${esc(prefix)}</a>`;
}

function timeHtml(ts) {
  if (ts == null) return "—";
  const d = new Date(ts * 1000);
  return `${esc(formatUnixIST(ts))} <span class="muted">(${esc(ago(d))})</span>`;
}

function flagsHtml(flags) {
  const list = splitList(flags);
  if (!list.length) return '<span class="muted">none</span>';
  return `<ul class="flags">${list.map((f) => {
    const info = FLAG_INFO[f] || { label: f, text: "Unknown flag." };
    return `<li><span class="flag">${esc(info.label)}</span> ${esc(info.text)}</li>`;
  }).join("")}</ul>`;
}

function communitiesHtml(text) {
  const list = splitList(text);
  if (!list.length) return '<span class="muted">none</span>';
  return list.map((c) => `<code class="community">${esc(c)}</code>`).join(" ");
}

// ---------- ASPA (path verdict from the site's own ASPA copy, see aspapath.js) ----------

const VERDICT_TONE = { valid: "valid", invalid: "invalid", unknown: "none" };
const MARK = { ok: "✓", bad: "✗", none: "·" };
const RADAR = "https://radar.cloudflare.com/routing/aspa-validation?path=";

/** The ASPA result for a route, worked out once and kept on the route (route card and graph share it). */
function aspaOf(r, aspa) {
  if (!aspa || aspa.error || !r.path) return null;
  if (!r.aspaResult) r.aspaResult = verifyPath(aspa.map, hops(r.path));
  return r.aspaResult;
}

function aspaHtml(r, aspa) {
  if (aspa?.error) return `<span class="muted">could not load the ASPA data (${esc(aspa.error)})</span>`;
  const res = aspaOf(r, aspa);
  if (!res) return '<span class="muted">no path to check</span>';
  const when = aspa.sourceTime ? `ASPAs of ${esc(formatIST(new Date(aspa.sourceTime)))}, ` : "";
  const pairs = res.pairs.length ? `<details class="aspa-pairs"><summary>Pair by pair</summary><ul>${res.pairs.map((p) =>
    `<li class="${p.mark}"><span class="mark" aria-hidden="true">${MARK[p.mark]}</span>${esc(p.text)}</li>`).join("")}</ul>` +
    `<p class="small"><a href="${RADAR}${esc(hops(r.path).join("-"))}" target="_blank" rel="noopener">Cross-check on Cloudflare Radar</a></p></details>` : "";
  return `<span class="rov ${VERDICT_TONE[res.verdict]}">${VERDICT_LABEL[res.verdict]}</span> ${esc(res.reason)} ` +
    `<span class="muted small">(${when}Cloudflare RPKI validator; checked as a route received from a provider)</span>${pairs}`;
}

function routeCard(r, aspa) {
  const rows = [
    ["AS path", `<div class="path">${pathHtml(r.path)}</div>`],
  ];
  if (r.rawPath && r.rawPath !== r.path) {
    rows.push(["Raw AS path", `<code class="raw">${esc(r.rawPath)}</code> <span class="muted">(as received, with prepends)</span>`]);
  } else {
    rows.push(["Raw AS path", `<code class="raw">${esc(r.rawPath)}</code> <span class="muted">(same as clean path)</span>`]);
  }
  rows.push(
    ["Origin AS", r.origin != null ? `${asChip(r.origin)}`
      : '<span class="muted">unknown (path ends in an AS_SET)</span>'],
    ["RPKI ROV", rovSlot(r.prefix, r.origin)],
    ["ASPA", aspaHtml(r, aspa)],
    ["Path length", `${esc(r.length ?? "—")} <span class="muted">(prepends collapsed, an AS_SET counts as 1)</span>`],
    ["Last change", timeHtml(r.timestamp)],
    ["Communities", communitiesHtml(r.communities)],
    ["OTC", r.otc != null ? `${asChip(r.otc)} <span class="muted">Only-to-Customer (RFC 9234): the AS that first sent this route to a customer, peer or route-server client</span>`
      : '<span class="muted">not set</span>'],
    ["Aggregator", r.aggrAsn != null || r.aggrIp
      ? `${asChip(r.aggrAsn)} <code>${esc(r.aggrIp)}</code>${r.atomic ? ' <span class="tag">ATOMIC_AGGREGATE</span>' : ""}`
      : r.atomic ? '<span class="tag">ATOMIC_AGGREGATE</span>' : '<span class="muted">not set</span>'],
  );
  if (r.setMembers) rows.push(["AS_SET members", splitList(r.setMembers).map(asChip).join(" ")]);
  rows.push(["Flags", flagsHtml(r.flags)]);
  return `<div class="route">
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
  </div>`;
}

function prefixTable(groups, source, emptyText) {
  if (!groups.length) return `<p class="muted">${emptyText}</p>`;
  const shown = groups.slice(0, MAX_LIST_ROWS);
  const body = shown.map((g) => {
    const r = g.routes[0];
    return `<tr><td data-label="Prefix">${lookupLink(g.prefix, source)}</td><td data-label="Origin">${asChip(r.origin)}</td>` +
      `<td class="num" data-label="Length">${esc(r.length ?? "—")}</td><td class="when" data-label="Last change">${esc(formatUnixIST(r.timestamp))}</td>` +
      `<td data-label="Flags">${splitList(r.flags).map((f) => `<span class="flag small">${esc((FLAG_INFO[f] || { label: f }).label)}</span>`).join(" ")}</td></tr>`;
  }).join("");
  const more = groups.length > shown.length
    ? `<p class="muted">Showing ${shown.length} of ${groups.length}. Look up a longer prefix to narrow the list.</p>` : "";
  return `<table class="list stack"><thead><tr><th>Prefix</th><th>Origin</th><th>Length</th><th>Last change</th><th>Flags</th></tr></thead>` +
    `<tbody>${body}</tbody></table>${more}`;
}


// No more-specifics section for a single address, or for a /24 (IPv4) or /48 (IPv6) and longer:
// most networks filter routes longer than that, so there is almost never anything to show.
const MAX_USUAL = { 4: 24, 6: 48 };
export const wantMoreSpecifics = (q) => !q.isAddress && q.len < MAX_USUAL[q.afi];
// No covering section at /8 (IPv4) or /12 (IPv6) and shorter: collector peers carry no routes shorter than that
// (checked on the data: the shortest are /8 for IPv4 and /16 for IPv6).
const MIN_USUAL = { 4: 8, 6: 12 };
export const wantCovering = (q, match) => (match ? match.len : q.len) > MIN_USUAL[q.afi];

function renderSource(res, q, src, multi, aspa) {
  const { match, exact, covering, moreSpecifics, unloaded, moreBase } = res;
  const asOf = new Date(src.as_of);
  let head;
  if (!match) {
    head = `<p class="notice">No route in this source covers <code>${esc(q.text)}</code>.</p>`;
  } else if (q.isAddress) {
    head = `<p>Longest match for <code>${esc(q.text)}</code>: <strong>${esc(match.prefix)}</strong></p>`;
  } else if (exact) {
    head = `<p>Exact match: <strong>${esc(match.prefix)}</strong></p>`;
  } else {
    head = `<p class="notice">No route for <code>${esc(q.text)}</code> itself. Longest covering prefix: <strong>${esc(match.prefix)}</strong></p>`;
  }
  const matchHtml = match ? `
    <div class="prefix-head"><h3>${esc(match.prefix)}</h3></div>
    ${match.routes.map((r) => routeCard(r, aspa)).join("")}` : "";

  let unloadedHtml = "";
  if (unloaded.blocks) {
    const where = `${unloaded.routes.toLocaleString()} more routes inside ` +
      `${esc(formatPrefix(q.afi, moreBase.net, moreBase.len))} are in ${unloaded.blocks} more data file(s)`;
    unloadedHtml = unloaded.blocks <= MAX_LOAD_FILES && !res.loadedAll
      ? `<p class="muted">${where}, not loaded yet. ` +
        `<button type="button" class="load-more" data-source="${esc(src.name)}">Load them</button></p>`
      : `<p class="muted">${where}. Too many to load at once: look up a longer prefix.</p>`;
  }

  return `<section class="source-result" data-source="${esc(src.name)}">
    ${multi ? `<h2>${src.note ? `<span class="has-note" title="${esc(src.note)}">${esc(sourceLabel(src))}</span>` : esc(sourceLabel(src))} <span class="muted small">${esc(collectorLabel(src))} · data as of ${esc(formatIST(asOf))}</span></h2>` : ""}
    ${head}
    ${matchHtml}
    ${wantCovering(q, match) ? `<h3>Covering prefixes (less specific)</h3>
    ${prefixTable(covering, src.name, "None.")}` : ""}
    ${moreSpecifics ? `<h3>More-specific prefixes${match ? ` inside ${esc(match.prefix)}` : ""}</h3>
    ${prefixTable(moreSpecifics, src.name, unloaded.blocks ? "None in the files loaded so far." : "None.")}
    ${unloadedHtml}` : ""}
  </section>`;
}

// ---------- per-peer results: one card, one tab per peer ----------

let activePeer = null; // the peer tab last chosen; kept across searches and "Load them" while that peer is shown

const peerShort = (src) => src.display_name || `${src.collector} · AS${src.peer_asn}`;

function peerTabs(done) {
  const names = done.map((d) => d.src.name);
  const active = names.includes(activePeer) ? activePeer : names[0];
  const tabs = done.map(({ src, res, error }) => {
    const none = error || !res || !res.match;
    const id = `peer-tab-${src.name.replace(/[^\w-]/g, "_")}`;
    const tip = `${sourceLabel(src)} · ${collectorLabel(src)}${error ? " · could not load" : none ? " · no route" : ""}`;
    return `<button type="button" role="tab" class="peer-tab${none ? " none" : ""}" id="${esc(id)}" data-source="${esc(src.name)}"
      aria-selected="${src.name === active}" tabindex="${src.name === active ? 0 : -1}" title="${esc(tip)}">` +
      `<i class="swatch" style="--sw:transparent"></i>` + // coloured once the graph says who it drew (tabColours)
      `${esc(peerShort(src))}</button>`;
  }).join("");
  const panels = done.map(({ src, html }) => html.replace('<section class="source-result"',
    `<section class="source-result" role="tabpanel"${src.name === active ? "" : " hidden"}`)).join("");
  return `<div class="peer-card"><p class="peer-card-title"><strong>Routes per peer</strong>
    <span class="muted small">${done.length} peers; pick one.</span></p>
    <div class="peer-tabs" role="tablist" aria-label="Peer">${tabs}</div>${panels}</div>`;
}

/** Peer tabs take the colour the graph gave each peer it drew this time; peers not drawn show no swatch. */
function tabColours(colours) {
  for (const t of results.querySelectorAll(".peer-tab")) {
    const slot = colours.get(t.dataset.source);
    t.querySelector(".swatch")?.style.setProperty("--sw", slot == null ? "transparent" : peerColour(slot));
  }
}

function showPeer(name, focus = false) {
  activePeer = name;
  for (const t of results.querySelectorAll(".peer-tab")) {
    const on = t.dataset.source === name;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const p of results.querySelectorAll(".peer-card .source-result")) p.hidden = p.dataset.source !== name;
  revealTab();
}

/** Phones show the tabs in one sideways-scrolling row: keep the chosen tab in view (without moving the page). */
function revealTab() {
  const row = results.querySelector(".peer-tabs"), t = row?.querySelector('[aria-selected="true"]');
  if (!t || row.scrollWidth <= row.clientWidth) return;
  const left = t.offsetLeft - row.offsetLeft, right = left + t.offsetWidth;
  if (left < row.scrollLeft) row.scrollLeft = left - 8;
  else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 8;
}

// ---------- state & flow ----------

function setBanner() {
  const asOf = new Date(manifest.upstream.as_of);
  const hours = (Date.now() - asOf) / 3600e3;
  banner.className = hours > STALE_HOURS ? "banner stale" : "banner";
  banner.innerHTML = `Routing data as of <strong>${esc(formatIST(asOf))}</strong> (${esc(ago(asOf))})` +
    (hours > STALE_HOURS ? ". The hourly update seems to be late." : ".");
}

function fillSources() {
  // Grouped by collector, in manifest order.
  const groups = new Map();
  for (const s of manifest.sources) {
    const k = collectorLabel(s);
    if (!groups.has(k)) groups.set(k, []);
    const where = siteLabel(s);
    const text = where ? `${sourceLabel(s)} · ${where}` : sourceLabel(s);
    groups.get(k).push(`<option value="${esc(s.name)}">${esc(text)}</option>`);
  }
  select.innerHTML = '<option value="all">All sources</option>' +
    [...groups].map(([k, opts]) => `<optgroup label="${esc(k)}">${opts.join("")}</optgroup>`).join("");
}

async function run(text, sourceName, { loadAllFor = null, missingSource = null } = {}) {
  const q = parseQuery(text);
  if (q.error) {
    results.innerHTML = `<p class="error">${esc(q.error)}</p>`;
    return;
  }
  q.text = q.isAddress ? text.trim() : formatPrefix(q.afi, q.net, q.len);
  document.title = `${q.text} · Prefix lookup · ASPA Monitor`;
  const picked = sourceName === "all" ? manifest.sources : manifest.sources.filter((s) => s.name === sourceName);
  if (!picked.length) {
    results.innerHTML = `<p class="error">Unknown source "${esc(sourceName)}".</p>`;
    return;
  }
  // Leave out peers that send no routes of this address family (e.g. IPv4-only peers).
  const hasFamily = (s) => s[`v${q.afi}`] == null || s[`v${q.afi}`] > 0;
  const sources = picked.filter(hasFamily);
  const skipped = picked.filter((s) => !hasFamily(s));
  const note = (missingSource
    ? `<p class="notice">Source <code>${esc(missingSource)}</code> is no longer in the data; showing all sources.</p>` : "") +
    (q.hostBits
    ? `<p class="notice">Host bits were set; looking up the network <code>${esc(q.text)}</code> instead.</p>` : "");
  const qlabel = q.isAddress ? `address ${q.text} (IPv${q.afi}, longest match)` : `prefix ${q.text} (IPv${q.afi})`;
  results.innerHTML = `${note}<p class="muted">Looking up ${esc(qlabel)}…</p>`;

  if (!sources.length) {
    results.innerHTML = `${note}<p class="notice">${esc(sourceLabel(picked[0]))} sends no IPv${q.afi} routes, ` +
      `so there is nothing to look up here. Choose another source or All sources.</p>`;
    return;
  }
  const skippedNote = skipped.length
    ? `<p class="muted small">Not shown (no IPv${q.afi} routes from these peers): ${skipped.map((s) => esc(sourceLabel(s))).join(", ")}.</p>` : "";

  const multi = sources.length > 1;
  const aspaP = loadAspas().catch((e) => ({ error: e.message })); // one small file, fetched once per page
  const done = await Promise.all(sources.map(async (src) => {
    try {
      const res = await lookup(src.name, q, {
        loadAll: loadAllFor === src.name || loadAllFor === "all", withMoreSpecifics: wantMoreSpecifics(q) });
      const aspa = await aspaP;
      return { src, res, html: renderSource(res, q, src, multi, aspa) };
    } catch (e) {
      return { src, error: true, html: `<section class="source-result" data-source="${esc(src.name)}">${multi ? `<h2>${esc(sourceLabel(src))}</h2>` : ""}<p class="error">Could not load data: ${esc(e.message)}</p></section>` };
    }
  }));
  results.innerHTML = `${note}<p class="muted">Results for ${esc(qlabel)}.</p>${skippedNote}<div class="graph-slot"></div>` +
    (multi ? peerTabs(done) : done.map((d) => d.html).join(""));
  revealTab();
  fillNames(results);
  fillRov(results);

  // One graph of every peer's path to the matched prefix (each distinct path per source counts once);
  // the graph merges peers whose paths match after their own AS.
  const aspa = await aspaP;
  const entries = [];
  for (const { src, res } of done) {
    if (!res || !res.match) continue;
    const seen = new Set();
    for (const r of res.match.routes) {
      if (!r.path || seen.has(r.path)) continue;
      seen.add(r.path);
      const verdict = aspaOf(r, aspa)?.verdict ?? null;
      // split: peers whose ASPA verdicts differ are never merged into one box (their first pair differs).
      entries.push({ label: sourceLabel(src), name: src.display_name || null, note: src.note || null, region: src.region || null, source: src.name, prefix: res.match.prefix, path: r.path,
        aspa: verdict, split: verdict, aspaPairs: aspaOf(r, aspa)?.pairs ?? null });
    }
  }
  const slot = results.querySelector(".graph-slot");
  const gw = (slot.clientWidth || results.clientWidth || 940) - 52;
  // Tabs: the path graph, and (trial) the same paths with lines coloured by inferred AS relationship (asrel.js).
  const graph = entries.length ? renderGraphPanel(entries, { width: gw, withRel: SHOW_REL_MAP, onColours: tabColours }) : null;
  if (graph) slot.replaceWith(graph); else slot.remove();
}

// Looked up when "Look up" is pressed with an empty box.
const DEFAULT_QUERY = "2409::/48";

function current() {
  const p = new URLSearchParams(location.search);
  return { q: p.get("q") || "", source: p.get("source") || select.value };
}

function go(q, source, push = true) {
  const u = new URLSearchParams({ q, source });
  if (push) history.pushState(null, "", `?${u}`);
  input.value = q;
  // A link can name a peer that has since been removed from the data: say so and show all sources.
  const known = [...select.options].some((o) => o.value === source);
  if (known) select.value = source;
  else if (source) select.value = "all";
  if (q) run(q, select.value, { missingSource: known || !source ? null : source });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  go(input.value.trim() || DEFAULT_QUERY, select.value);
});

results.addEventListener("click", (e) => {
  const tab = e.target.closest(".peer-tab");
  if (tab) { showPeer(tab.dataset.source); return; }
  const btn = e.target.closest(".load-more");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading…";
    const { q } = current();
    run(q || input.value, select.value, { loadAllFor: select.value === "all" ? btn.dataset.source : select.value });
    return;
  }
  const a = e.target.closest("a[href^='?']");
  if (a) {
    e.preventDefault();
    const p = new URLSearchParams(a.getAttribute("href").slice(1));
    go(p.get("q"), p.get("source") || select.value);
    window.scrollTo({ top: 0 });
  }
});

results.addEventListener("keydown", (e) => {
  const tab = e.target.closest(".peer-tab");
  if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const tabs = [...results.querySelectorAll(".peer-tab")];
  const i = tabs.indexOf(tab);
  const j = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1
    : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  showPeer(tabs[j].dataset.source, true);
});

document.querySelectorAll(".example").forEach((a) => a.addEventListener("click", (e) => {
  e.preventDefault();
  go(a.dataset.q, select.value);
}));

window.addEventListener("popstate", () => {
  const { q, source } = current();
  go(q, source, false);
  if (!q) {
    results.innerHTML = "";
    document.title = "Prefix lookup · ASPA Monitor";
  }
});

(async function init() {
  try {
    manifest = await loadManifest();
  } catch (e) {
    banner.className = "banner stale";
    banner.textContent = `Could not load the data manifest: ${e.message}`;
    return;
  }
  setBanner();
  fillSources();
  const { q, source } = current();
  if (q) go(q, source, false);
  else input.focus();
})();

