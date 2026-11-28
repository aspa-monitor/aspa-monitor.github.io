// ASPA hygiene page: each published ASPA compared with the upstreams seen in this portal's feeds, from
// aspa-validation (data/validation/hygiene/: summary.json for lists and counts, asn/<asn % 100>.json per AS).
// The page computes nothing new: it filters, counts and shows what aspa-validation published.
import { fillNames } from "./asnames.js";
import { formatIST } from "./timefmt.js";
import { GROUPS, GROUP_ORDER, RIRS, byCountry, groupCounts, inScope, missingLists, shardOf, summaryRows }
  from "./hygienedata.js";

const BASE = "/data/validation/hygiene/";
const LATE_HOURS = 3;
const DEFAULT_ASN = "148000"; // the box's example; Check with an empty box looks it up
const RADAR = "https://radar.cloudflare.com/routing/aspa-validation?path=";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const int = (n) => Number(n).toLocaleString();
const pct = (x) => (x == null ? "—" : x < 0.001 ? "<0.1%" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const dayIST = (t) => (t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
let regionName;
try { regionName = new Intl.DisplayNames(["en"], { type: "region" }); } catch { regionName = null; }
const country = (cc) => (cc === "ZZ" || !cc ? "Unknown" : (regionName?.of(cc) || cc));
const RIR_NAME = Object.fromEntries(RIRS);
const asChip = (asn) => `<span class="asn" data-asn="${esc(asn)}"><span class="asnum">AS${esc(asn)}</span><span class="asname"></span></span>`;
const evTag = (e) => (e ? `<span class="ev ${esc(e)}" title="evidence: share of our feeds that saw the hop">${esc(e)}</span>` : "");

const state = { doc: null, rows: [], rir: "apnic", cc: "" };
try { state.rir = localStorage.getItem("hygieneRir") || "apnic"; } catch { /* storage blocked */ }

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function renderStatus() {
  const d = state.doc, asOf = new Date(d.as_of);
  const late = (Date.now() - asOf) / 3.6e6 > LATE_HOURS;
  const s = $("#hygiene-status");
  s.className = late ? "banner stale" : "banner";
  s.innerHTML = `Routing data as of <strong>${esc(formatIST(asOf))}</strong>, ASPAs as of ${esc(formatIST(new Date(d.inputs.rpki_as_of)))}, ` +
    `${int(d.feeds_total)} feeds, ${int(state.rows.length)} ASPAs.` + (late ? " The hourly update seems to be late." : "");
}

function renderControls() {
  const inRir = inScope(state.rows, state.rir);
  const ccs = byCountry(inRir);
  if (state.cc && !ccs.some((c) => c.cc === state.cc)) state.cc = "";
  $("#hygiene-controls").innerHTML =
    `<label class="pairs-pick"><span class="muted small">Registry</span><select id="h-rir">${RIRS.map(([k, t]) =>
      `<option value="${k}"${k === state.rir ? " selected" : ""}>${t}</option>`).join("")}</select></label>
     <label class="pairs-pick"><span class="muted small">Country</span><select id="h-cc"><option value="">All countries</option>${ccs.map((c) =>
      `<option value="${esc(c.cc)}"${c.cc === state.cc ? " selected" : ""}>${esc(country(c.cc))} (${int(c.total)})</option>`).join("")}</select></label>`;
  $("#h-rir").addEventListener("change", (e) => {
    state.rir = e.target.value; state.cc = "";
    try { localStorage.setItem("hygieneRir", state.rir); } catch { /* storage blocked */ }
    renderAll();
  });
  $("#h-cc").addEventListener("change", (e) => { state.cc = e.target.value; renderAll(); });
}

function renderTiles(rows) {
  const c = groupCounts(rows);
  const tile = (v, l, s) => `<div class="tile"><div class="tile-value">${esc(v)}</div><div class="tile-label">${esc(l)}</div>` +
    `<div class="tile-sub muted small">${esc(s)}</div></div>`;
  const share = (n) => (c.total ? `${Math.round((n / c.total) * 100)}% of these ASPAs` : "");
  $("#hygiene-tiles").innerHTML = [
    tile(int(c.total), "ASPAs", state.cc ? country(state.cc) : RIR_NAME[state.rir]),
    tile(int(c.under_declared + c.under_and_over), "Observed provider not in ASPA", share(c.under_declared + c.under_and_over)),
    tile(int(c.match), "Match what we see", share(c.match)),
    tile(int(c.over_declared_only), "List providers not seen", share(c.over_declared_only)),
    tile(int(c.as0), "AS0 (no providers)", share(c.as0)),
    tile(int(c.not_visible), "No upstream seen", share(c.not_visible)),
  ].join("");
}

function renderCountries(rows) {
  const ccs = byCountry(rows).slice(0, state.cc ? 1 : 30);
  $("#hygiene-countries").innerHTML = !ccs.length ? '<p class="muted">No ASPAs here.</p>' :
    `<table class="list stack"><thead><tr><th>Country</th><th class="num">ASPAs</th><th class="num">Observed provider not in ASPA</th>
      <th class="num">Match</th><th class="num">Lists providers not seen</th><th class="num">AS0</th><th class="num">No upstream seen</th></tr></thead>
      <tbody>${ccs.map((c) => `<tr><td data-label="Country"><a href="#" class="h-cc" data-cc="${esc(c.cc)}">${esc(country(c.cc))}</a></td>
        <td class="num" data-label="ASPAs">${int(c.total)}</td><td class="num" data-label="Provider not in ASPA">${int(c.under_declared + c.under_and_over)}</td>
        <td class="num" data-label="Match">${int(c.match)}</td><td class="num" data-label="Lists providers not seen">${int(c.over_declared_only)}</td>
        <td class="num" data-label="AS0">${int(c.as0)}</td><td class="num" data-label="No upstream seen">${int(c.not_visible)}</td></tr>`).join("")}</tbody></table>` +
    (!state.cc && byCountry(rows).length > 30 ? '<p class="muted small">The 30 countries with the most ASPAs; pick another under Country.</p>' : "");
}

function missingTable(items) {
  const total = state.doc.feeds_total;
  return `<table class="list stack"><thead><tr><th>AS</th><th>Country</th><th>Observed provider not in ASPA</th><th>Evidence</th><th></th></tr></thead>
    <tbody>${items.map((i) => `<tr><td data-label="AS">${asChip(i.asn)}</td><td data-label="Country">${esc(country(i.cc))}</td>
      <td data-label="Not in ASPA">${i.providers.map((p) => `<div class="h-miss">${asChip(p.asn)}
        <span class="muted small">seen by ${int(p.feeds)} of ${int(total)} feeds, ${pct(p.share)} of its routes</span></div>`).join("")}</td>
      <td data-label="Evidence">${evTag(i.evidence)}</td>
      <td><a href="#asn=${esc(i.asn)}" class="h-card" data-asn="${esc(i.asn)}">Details</a></td></tr>`).join("")}</tbody></table>`;
}

function renderMissing(rows) {
  const { confirmed, weak } = missingLists(rows, state.doc.missing || {});
  $("#hygiene-missing").innerHTML = (confirmed.length ? missingTable(confirmed)
    : '<p class="muted">None with strong or partial evidence here.</p>') +
    (weak.length ? `<details class="h-weak"><summary>Low evidence: ${int(weak.length)} more, each seen by only a few feeds</summary>
      <p class="muted small">These hops were seen by fewer than a quarter of our feeds. They may be backup or regional links that
        most of the Internet never sees, and cannot be confirmed from collector data.</p>${missingTable(weak)}</details>` : "");
  fillNames($("#hygiene-missing"));
}

function renderAll() {
  const rows = inScope(state.rows, state.rir, state.cc);
  renderControls();
  renderTiles(rows);
  renderCountries(inScope(state.rows, state.rir, state.cc));
  renderMissing(rows);
}

// ---------- one AS ----------

const REL = { provider: "provider", peer: "peer", customer: "customer", unknown: "not known", as0: "AS0" };

async function showCard(asn) {
  const out = $("#hygiene-card");
  if (!/^\d+$/.test(asn) || Number(asn) < 1 || Number(asn) > 4294967295) {
    out.innerHTML = '<p class="error">Enter an AS number, for example 148000.</p>';
    return;
  }
  out.innerHTML = `<p class="muted">Looking up AS${esc(asn)}…</p>`;
  let a;
  try {
    a = (await getJson(`${BASE}asn/${shardOf(asn)}.json`))[String(Number(asn))];
  } catch (e) {
    out.innerHTML = `<p class="error">Could not load the data (${esc(e.message)}). Try again in a minute.</p>`;
    return;
  }
  if (!a) {
    out.innerHTML = `<div class="h-card-box"><p>AS${esc(asn)} has no ASPA in this hour's data, so there is nothing to compare.
      <a href="/aspa/#asn=${esc(asn)}">Check its ASPA on the ASPA page</a> (BGPKIT's daily view).</p></div>`;
    return;
  }
  const g = GROUPS[a.group] || { name: a.group, text: "", tone: "info" };
  const total = state.doc?.feeds_total;
  const observed = (a.observed || []).map((o) => `<tr class="${o.declared ? "" : "h-not"}">
    <td data-label="Upstream">${asChip(o.asn)}</td><td data-label="CAIDA">${esc(REL[o.rel] || o.rel)}</td>
    <td data-label="In ASPA">${o.declared ? "yes" : "<strong>no</strong>"}</td>
    <td class="num" data-label="Share of routes">${pct(o.share)}</td>
    <td class="num" data-label="Feeds">${int(o.feeds)}${total ? ` of ${int(total)}` : ""}</td><td data-label="Evidence">${evTag(o.evidence)}</td>
    <td data-label="Seen">${o.declared ? `since ${esc(dayIST(o.first_observed))}`
      : `observed on ${esc(dayIST(o.first_observed))} via AS${esc(o.asn)}, not in ASPA`}</td></tr>`).join("");
  const declared = (a.declared || []).map((d) => `<tr><td data-label="Provider">${d.asn === 0 ? "AS0 (no providers)" : asChip(d.asn)}</td>
    <td data-label="CAIDA">${esc(REL[d.rel] || d.rel)}</td><td data-label="Seen">${d.asn === 0 ? "—" : d.seen ? "seen as an upstream" : "not seen (allowed)"}</td></tr>`).join("");
  const unclassified = (a.missing_unknown_rel || []).length
    ? `<p class="muted small">Not in the ASPA and not classified by CAIDA (shown as unclassified; it does not change the result):
      ${a.missing_unknown_rel.map((x) => `AS${esc(x)}`).join(", ")}.</p>` : "";
  const age = a.aspa ? `<p class="muted small">ASPA first seen ${esc(dayIST(a.aspa.first_seen))}, last changed ${esc(dayIST(a.aspa.last_change))},
      ${int(a.aspa.changes)} change(s).</p>` : "";
  out.innerHTML = `<div class="h-card-box">
    <h3>${asChip(a.asn)}</h3>
    <p class="muted small">${esc(country(a.cc))} · registry ${esc(RIR_NAME[a.rir] || a.rir)} · ASPA published under
      ${esc((a.tas || []).map((t) => RIR_NAME[t] || t).join(", ") || "—")} · ${int(a.origin_routes)} routes originated in our feeds</p>
    <p><span class="h-group ${esc(g.tone)}">${esc(g.name)}</span>${a.evidence ? ` ${evTag(a.evidence)}` : ""}</p>
    <p class="muted small">${esc(g.text)}</p>
    <h4>Upstreams seen in our feeds</h4>
    ${observed ? `<table class="list stack"><thead><tr><th>Upstream</th><th>CAIDA relationship</th><th>In ASPA</th><th class="num">Share of routes</th>
      <th class="num">Feeds</th><th>Evidence</th><th></th></tr></thead><tbody>${observed}</tbody></table>`
      : '<p class="muted">None of our feeds saw a route from this AS through an upstream.</p>'}
    ${unclassified}
    <h4>Providers in the ASPA</h4>
    <table class="list stack"><thead><tr><th>Provider</th><th>CAIDA relationship</th><th>In our feeds</th></tr></thead><tbody>${declared}</tbody></table>
    ${age}
    <p class="small"><a href="/aspa/#asn=${esc(a.asn)}">ASPA page</a>${(a.missing || []).length ? ` · Radar: ${a.missing.map((m) =>
      `<a href="${RADAR}${esc(m)}-${esc(a.asn)}" target="_blank" rel="noopener">AS${esc(m)} → AS${esc(a.asn)}</a>`).join(", ")}` : ""}</p>
  </div>`;
  fillNames(out);
}

$("#hygiene-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const asn = $("#h-asn").value.trim().replace(/^as/i, "") || DEFAULT_ASN;
  $("#h-asn").value = asn; // show what was looked up (the default too)
  history.replaceState(null, "", `#asn=${asn}`);
  showCard(asn);
});
document.addEventListener("click", (e) => {
  const a = e.target.closest(".h-card");
  if (a) {
    e.preventDefault();
    $("#h-asn").value = a.dataset.asn;
    history.replaceState(null, "", `#asn=${a.dataset.asn}`);
    showCard(a.dataset.asn);
    $("#hygiene-form").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const c = e.target.closest(".h-cc");
  if (c) { e.preventDefault(); state.cc = c.dataset.cc; renderAll(); }
});

// A link or a typed URL that changes only #asn= shows that AS without reloading the page.
window.addEventListener("hashchange", () => {
  const asn = (location.hash.match(/asn=(?:AS)?(\d+)/i) || [])[1];
  if (asn && asn !== $("#h-asn").value) { $("#h-asn").value = asn; showCard(asn); }
});

(async function init() {
  const hashAsn = (location.hash.match(/asn=(?:AS)?(\d+)/i) || [])[1];
  try {
    state.doc = await getJson(`${BASE}summary.json`);
    state.rows = summaryRows(state.doc);
    if (!state.rows) throw new Error("unexpected format");
  } catch (e) {
    $("#hygiene-status").className = "banner stale";
    $("#hygiene-status").textContent = `The hygiene data is not available right now (${e.message}). Please try again later.`;
    return;
  }
  renderStatus();
  $("#hygiene-citation").textContent = state.doc.inputs.caida_citation;
  if (!RIRS.some(([k]) => k === state.rir)) state.rir = "apnic";
  renderAll();
  if (hashAsn) { $("#h-asn").value = hashAsn; showCard(hashAsn); }
})();
