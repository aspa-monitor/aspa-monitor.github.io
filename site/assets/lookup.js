import { parseQuery, formatPrefix } from "./prefix.js";
import { loadManifest, lookup, MAX_LOAD_FILES } from "./risdata.js";
import { FLAG_INFO, splitList } from "./flags.js";
import { fillNames } from "./asnames.js";
import { formatIST, formatUnixIST, ago } from "./timefmt.js";

const MAX_LIST_ROWS = 200;
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
  return `<a class="asn" data-asn="${esc(asn)}" href="https://bgp.tools/as/${esc(asn)}" target="_blank" rel="noopener">` +
    `<span class="asnum">AS${esc(asn)}</span><span class="asname"></span></a>`;
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

function prefixLinks(prefix) {
  return `<a href="https://stat.ripe.net/${esc(prefix)}" target="_blank" rel="noopener">RIPEstat</a> · ` +
    `<a href="https://bgp.tools/prefix/${esc(prefix)}" target="_blank" rel="noopener">bgp.tools</a>`;
}

function asLinks(asn) {
  if (asn == null) return "";
  return `<a href="https://stat.ripe.net/AS${esc(asn)}" target="_blank" rel="noopener">RIPEstat</a> · ` +
    `<a href="https://bgp.tools/as/${esc(asn)}" target="_blank" rel="noopener">bgp.tools</a>`;
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

function routeCard(r) {
  const rows = [
    ["AS path", `<div class="path">${pathHtml(r.path)}</div>`],
  ];
  if (r.rawPath && r.rawPath !== r.path) {
    rows.push(["Raw AS path", `<code class="raw">${esc(r.rawPath)}</code> <span class="muted">(as received, with prepends)</span>`]);
  } else {
    rows.push(["Raw AS path", `<code class="raw">${esc(r.rawPath)}</code> <span class="muted">(same as clean path)</span>`]);
  }
  rows.push(
    ["Origin AS", r.origin != null ? `${asChip(r.origin)} <span class="links">${asLinks(r.origin)}</span>`
      : '<span class="muted">unknown (path ends in an AS_SET)</span>'],
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
    return `<tr><td>${lookupLink(g.prefix, source)}</td><td>${asChip(r.origin)}</td>` +
      `<td class="num">${esc(r.length ?? "—")}</td><td>${esc(formatUnixIST(r.timestamp))}</td>` +
      `<td>${splitList(r.flags).map((f) => `<span class="flag small">${esc((FLAG_INFO[f] || { label: f }).label)}</span>`).join(" ")}</td></tr>`;
  }).join("");
  const more = groups.length > shown.length
    ? `<p class="muted">Showing ${shown.length} of ${groups.length}. Look up a longer prefix to narrow the list.</p>` : "";
  return `<table class="list"><thead><tr><th>Prefix</th><th>Origin</th><th>Length</th><th>Last change</th><th>Flags</th></tr></thead>` +
    `<tbody>${body}</tbody></table>${more}`;
}

function sourceLabel(src) {
  return `${src.collector} · peer AS${src.peer_asn}`;
}

function renderSource(res, q, src, multi) {
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
    <div class="prefix-head"><h3>${esc(match.prefix)}</h3><span class="links">${prefixLinks(match.prefix)}</span></div>
    ${match.routes.map(routeCard).join("")}` : "";

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
    ${multi ? `<h2>${esc(sourceLabel(src))} <span class="muted small">data as of ${esc(formatIST(asOf))}</span></h2>` : ""}
    ${head}
    ${matchHtml}
    <h3>Covering prefixes (less specific)</h3>
    ${prefixTable(covering, src.name, "None.")}
    <h3>More-specific prefixes${match ? ` inside ${esc(match.prefix)}` : ""}</h3>
    ${prefixTable(moreSpecifics, src.name, unloaded.blocks ? "None in the files loaded so far." : "None.")}
    ${unloadedHtml}
  </section>`;
}

// ---------- state & flow ----------

function setBanner() {
  const asOf = new Date(manifest.upstream.as_of);
  const hours = (Date.now() - asOf) / 3600e3;
  banner.className = hours > STALE_HOURS ? "banner stale" : "banner";
  banner.innerHTML = `RIS data as of <strong>${esc(formatIST(asOf))}</strong> (${esc(ago(asOf))})` +
    (hours > STALE_HOURS ? ". The hourly update seems to be late." : ".") +
    ` Updated hourly from <a href="https://github.com/aspa-monitor/ris-routing-data">ris-routing-data</a>.`;
}

function fillSources() {
  const opts = manifest.sources.map((s) => `<option value="${esc(s.name)}">${esc(sourceLabel(s))}</option>`);
  opts.unshift('<option value="all">All sources</option>');
  select.innerHTML = opts.join("");
}

async function run(text, sourceName, { loadAllFor = null } = {}) {
  const q = parseQuery(text);
  if (q.error) {
    results.innerHTML = `<p class="error">${esc(q.error)}</p>`;
    return;
  }
  q.text = q.isAddress ? text.trim() : formatPrefix(q.afi, q.net, q.len);
  document.title = `${q.text} · Prefix lookup · ASPA Monitor`;
  const sources = sourceName === "all" ? manifest.sources : manifest.sources.filter((s) => s.name === sourceName);
  if (!sources.length) {
    results.innerHTML = `<p class="error">Unknown source "${esc(sourceName)}".</p>`;
    return;
  }
  const note = q.hostBits
    ? `<p class="notice">Host bits were set; looking up the network <code>${esc(q.text)}</code> instead.</p>` : "";
  const qlabel = q.isAddress ? `address ${q.text} (IPv${q.afi}, longest match)` : `prefix ${q.text} (IPv${q.afi})`;
  results.innerHTML = `${note}<p class="muted">Looking up ${esc(qlabel)}…</p>`;

  const sections = await Promise.all(sources.map(async (src) => {
    try {
      const res = await lookup(src.name, q, { loadAll: loadAllFor === src.name || loadAllFor === "all" });
      return renderSource(res, q, src, sources.length > 1);
    } catch (e) {
      return `<section class="source-result">${sources.length > 1 ? `<h2>${esc(sourceLabel(src))}</h2>` : ""}<p class="error">Could not load data: ${esc(e.message)}</p></section>`;
    }
  }));
  results.innerHTML = `${note}<p class="muted">Results for ${esc(qlabel)}.</p>${sections.join("")}`;
  fillNames(results);
}

function current() {
  const p = new URLSearchParams(location.search);
  return { q: p.get("q") || "", source: p.get("source") || select.value };
}

function go(q, source, push = true) {
  const u = new URLSearchParams({ q, source });
  if (push) history.pushState(null, "", `?${u}`);
  input.value = q;
  if ([...select.options].some((o) => o.value === source)) select.value = source;
  if (q) run(q, select.value);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  go(input.value.trim(), select.value);
});

results.addEventListener("click", (e) => {
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

