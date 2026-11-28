// ASPA statistics page. Interim: everything comes live from the free BGPKIT API (CORS-enabled, no key),
// until aspa-validation publishes this site's own verdicts (client and 30-minute cache in bgpkit.js).
import { fillNames } from "./asnames.js";
import { api } from "./bgpkit.js";
import { OWN_INDEX, PAIR_REGIONS, PAIRS_SHOWN, ownPairs, pairsIn, regionIndex } from "./pairregions.js";
import { formatIST } from "./timefmt.js";

const RADAR = "https://radar.cloudflare.com/routing/aspa-validation?path=";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const int = (n) => Number(n).toLocaleString(); // same grouping as the rest of the site
const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const small = (x) => (x * 100 < 0.1 ? `${(x * 100).toFixed(3)}%` : x * 100 < 1 ? `${(x * 100).toFixed(2)}%` : pct(x));
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function asChip(asn) {
  return `<span class="asn" data-asn="${esc(asn)}">` +
    `<span class="asnum">AS${esc(asn)}</span><span class="asname"></span></span>`;
}

// BGPKIT's five path buckets, in their order. Text labels always go with the colour.
const BUCKETS = {
  no_aspa_evidence: { name: "No ASPA evidence", tone: "none",
    text: "No AS on the path has an ASPA that applies, so ASPA cannot judge it." },
  potentially_valid_partial: { name: "Potentially valid, partial", tone: "partial",
    text: "Nothing on the path contradicts ASPA, but some hops are not covered." },
  potentially_valid_full_coverage: { name: "Potentially valid, full coverage", tone: "full",
    text: "ASPA covers every hop and nothing contradicts it." },
  definitely_valid: { name: "Definitely valid", tone: "valid",
    text: "ASPA proves the path valid." },
  definitely_invalid: { name: "Definitely invalid", tone: "invalid",
    text: "At least one hop contradicts a published ASPA. A lower bound, not a leak rate." },
};

const bucket = (day, label) => day.buckets.find((b) => b.label === label) || { paths: 0, path_share: 0, observations: 0 };

function renderTiles(summary, day) {
  const evidence = 1 - bucket(day, "no_aspa_evidence").path_share;
  const invalid = bucket(day, "definitely_invalid");
  const tiles = [
    [int(summary.aspa_customers), "ASes with an ASPA", `RPKI snapshot ${fmtDate(summary.snapshot_date)}`],
    [int(day.totals.paths), "AS paths checked", `distinct paths seen on ${fmtDate(day.snapshot_date)}`],
    [pct(evidence), "Paths with ASPA evidence", "at least one hop covered by ASPA"],
    [int(invalid.paths), "Definitely invalid paths", `${small(invalid.path_share)} of paths`],
  ];
  $("#tiles").innerHTML = tiles.map(([v, l, s]) =>
    `<div class="tile"><div class="tile-value">${esc(v)}</div><div class="tile-label">${esc(l)}</div>` +
    `<div class="tile-sub muted small">${esc(s)}</div></div>`).join("");
}

function renderVerdicts(day) {
  $("#verdicts-title").textContent = `How observed paths verify on ${fmtDate(day.snapshot_date)}`;
  const max = Math.max(...day.buckets.map((b) => b.path_share));
  $("#verdicts").innerHTML = `<div class="barlist">${day.buckets.map((b) => {
    const info = BUCKETS[b.label] || { name: b.label, tone: "none", text: "" };
    const w = Math.max(0.6, (b.path_share / max) * 100);
    return `<div class="bar-row" title="${esc(`${info.name}: ${int(b.paths)} paths, ${int(b.observations)} observations`)}">
      <div class="bar-head"><span class="bar-name"><i class="dot ${info.tone}"></i>${esc(info.name)}</span>
        <span class="bar-num"><strong>${small(b.path_share)}</strong> <span class="muted">${int(b.paths)} paths</span></span></div>
      <div class="bar-track"><div class="bar-fill ${info.tone}" style="width:${w.toFixed(2)}%"></div></div>
      <div class="muted small">${esc(info.text)}</div>
    </div>`;
  }).join("")}</div>
  <p class="muted small">Buckets and counts as published by BGPKIT for paths seen by public route collectors.
    "Observations" count each path once per peer that saw it.</p>`;
}

/** Small line chart (one series) with a hover/tap crosshair and tooltip. */
function lineChart(el, points, { format, yFormat, tone }) {
  if (!points.length) { el.innerHTML = '<p class="muted">No data.</p>'; return; }
  const W = 560, H = 210, L = 56, R = 14, T = 12, B = 28;
  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const padY = (hi - lo) * 0.15 || hi * 0.1 || 1;
  lo = Math.max(0, lo - padY); hi += padY;
  const x = (i) => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((k) => lo + (k / 3) * (hi - lo));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="linechart" role="img" aria-label="${esc(el.dataset.label || "")}">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="axis" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(yFormat(v))}</text>`).join("")}
    ${xLabels.map((i) => `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}">${esc(fmtDate(points[i].d))}</text>`).join("")}
    <path class="line ${tone}" d="${d}"/>
    <line class="cross" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle class="dotm ${tone}" r="4.5" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
  </svg><div class="tip" hidden></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip");
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dotm");
  const show = (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))));
    const p = points[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(p.y)); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<strong>${esc(format(p))}</strong><br><span class="muted">${esc(fmtDate(p.d))}</span>`;
    const left = (x(i) / W) * box.width;
    tip.style.left = `${Math.min(Math.max(left, 60), box.width - 60)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  const hit = svg.querySelector(".hit");
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
}

function renderTrend(series) {
  const days = series.series;
  lineChart($("#trend-evidence"), days.map((d) => ({ d: d.snapshot_date, y: 1 - bucket(d, "no_aspa_evidence").path_share })),
    { tone: "full", yFormat: (v) => pct(v, 1), format: (p) => `${pct(p.y, 2)} of paths` });
  lineChart($("#trend-invalid"), days.map((d) => ({ d: d.snapshot_date, y: bucket(d, "definitely_invalid").paths, share: bucket(d, "definitely_invalid").path_share })),
    { tone: "invalid", yFormat: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))), format: (p) => `${int(p.y)} paths (${small(p.share)})` });
}

// Invalid pairs, with an India / AP region / World choice on the customer AS. Main source: every pair from this
// portal's own RIS and RouteViews feeds (aspa-validation, data/validation/invalid_pairs.json). Fallback when that
// file is missing: BGPKIT's top 200 worldwide for the day, with regions from APNIC's delegated statistics.
const REGION_KEY = "aspaPairsRegion";
const pairsState = { own: null, ownDoc: null, bgpkit: null, index: null, apnicDate: null, region: "IN", all: false };
try { pairsState.region = localStorage.getItem(REGION_KEY) || "IN"; } catch { /* storage blocked */ }

function pairsTable(rows, own) {
  const extra = own ? ["Routes", "Feeds"] : ["Observations"];
  return `<table class="list stack"><thead><tr><th>Customer AS</th><th>Provider AS seen</th>
    <th class="num">Invalid paths</th>${extra.map((h) => `<th class="num">${h}</th>`).join("")}<th>Check</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><td data-label="Customer">${asChip(r.customer_asn)}</td><td data-label="Provider">${asChip(r.provider_asn)}</td>
      <td class="num" data-label="Invalid paths">${int(r.invalid_paths)}</td>
      ${own ? `<td class="num" data-label="Routes">${int(r.routes)}</td><td class="num" data-label="Feeds"
        title="feeds that saw at least one of these invalid paths">${int(r.feeds)} of ${int(pairsState.ownDoc.feeds_total)}</td>`
        : `<td class="num" data-label="Observations">${int(r.invalid_observations)}</td>`}
      <td data-label="Check"><a href="#asn=${esc(r.customer_asn)}" class="show-aspa" data-asn="${esc(r.customer_asn)}">ASPA</a> ·
        <a href="${RADAR}${esc(r.provider_asn)}-${esc(r.customer_asn)}" target="_blank" rel="noopener">Radar</a></td></tr>`).join("")}
    </tbody></table>`;
}

function renderPairs() {
  const own = !!pairsState.own;
  if (!own && !pairsState.bgpkit) { $("#pairs").innerHTML = '<p class="error">Not available right now.</p>'; return; }
  const index = own ? OWN_INDEX : pairsState.index;
  const all = own ? pairsState.own : pairsState.bgpkit.culprits || [];
  const choices = index ? PAIR_REGIONS : PAIR_REGIONS.filter(([k]) => k === "world");
  if (!choices.some(([k]) => k === pairsState.region)) pairsState.region = choices[0][0];
  const region = pairsState.region, label = PAIR_REGIONS.find(([k]) => k === region)[1];
  const rows = pairsIn(all, region, index);
  const shown = pairsState.all ? rows : rows.slice(0, PAIRS_SHOWN);
  const picker = `<label class="pairs-pick"><span class="muted small">Customer AS from</span><select id="pairs-region">${choices.map(([k, t]) =>
    `<option value="${k}"${k === region ? " selected" : ""}>${t}</option>`).join("")}</select></label>`;
  const where = region === "IN" ? " with a customer AS registered in India" : region === "AP" ? " with a customer AS delegated by APNIC" : "";
  let about;
  if (own) {
    const d = pairsState.ownDoc;
    about = `${int(rows.length)} pairs${where}, from every path in this portal's ${int(d.feeds_total)} RIS and RouteViews feeds ` +
      `(${int(d.paths_verified)} paths verified), routing data as of ${esc(formatIST(new Date(d.as_of)))}; most invalid paths first. ` +
      "A pair is listed where the customer sent the route to a provider its ASPA doesn't list, and that is where the path " +
      "breaks ASPA. \"Routes\" counts each prefix seen by each feed.";
  } else {
    about = `${int(rows.length)} of BGPKIT's top ${int(all.length)} pairs worldwide for ${esc(fmtDate(pairsState.bgpkit.snapshot_date))}${where}, ` +
      "ordered by invalid paths. This portal's own list did not load, so these are BGPKIT's." +
      (region !== "world" && pairsState.apnicDate ? ` Regions from APNIC's delegated statistics of ${esc(pairsState.apnicDate)}.` : "") +
      (index ? "" : " (The region list did not load either, so only World is offered.)");
  }
  const table = !rows.length ? `<p class="muted">No invalid pair has a customer AS from ${esc(label)}${own ? " in this hour's data" : ` in BGPKIT's top ${int(all.length)} for this day`}.</p>`
    : pairsTable(shown, own) + (rows.length > PAIRS_SHOWN ? `<p><button type="button" class="pairs-more">${pairsState.all
      ? `Show the top ${PAIRS_SHOWN}` : `Show all ${int(rows.length)}`}</button></p>` : "");
  $("#pairs").innerHTML = `${picker}${table}<p class="muted small">${about} "Radar" checks the two-hop path on Cloudflare Radar's ASPA validator.</p>`;
  $("#pairs-region").addEventListener("change", (e) => {
    pairsState.region = e.target.value; pairsState.all = false;
    try { localStorage.setItem(REGION_KEY, pairsState.region); } catch { /* storage blocked */ }
    renderPairs();
  });
  $("#pairs .pairs-more")?.addEventListener("click", () => { pairsState.all = !pairsState.all; renderPairs(); });
  fillNames($("#pairs"));
}

async function getJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** This portal's own pairs; else (fallback) APNIC regions for BGPKIT's list. */
async function loadPairs() {
  const doc = await getJson("/data/validation/invalid_pairs.json");
  const own = ownPairs(doc);
  if (own) { pairsState.own = own; pairsState.ownDoc = doc; return; }
  const apnic = await getJson("/data/asregions/apnic.json");
  pairsState.index = regionIndex(apnic);
  if (apnic && /^\d{8}$/.test(apnic.date || "")) {
    pairsState.apnicDate = fmtDate(`${apnic.date.slice(0, 4)}-${apnic.date.slice(4, 6)}-${apnic.date.slice(6)}`);
  }
}

async function showAspa(asn) {
  const out = $("#aspa-result");
  if (!/^\d+$/.test(asn) || Number(asn) < 1 || Number(asn) > 4294967295) {
    out.innerHTML = '<p class="error">Enter an AS number, for example 148000.</p>';
    return;
  }
  out.innerHTML = `<p class="muted">Looking up the ASPA of AS${esc(asn)}…</p>`;
  try {
    const res = await api(`aspa/provider-sets?customer=${asn}&limit=500`);
    const current = (res.data || []).filter((r) => r.last_seen == null);
    if (!current.length) {
      const old = (res.data || []).length;
      out.innerHTML = `<p class="notice">AS${esc(asn)} publishes no ASPA today${old ? " (it did earlier)" : ""}.
        Paths through it cannot be checked with ASPA.</p>`;
      return;
    }
    const providers = [...new Set(current.map((r) => r.provider_asn))].sort((a, b) => a - b);
    const tas = [...new Set(current.map((r) => r.ta))].join(", ");
    const since = current.map((r) => r.first_seen).sort()[0];
    const as0 = providers.length === 1 && providers[0] === 0;
    out.innerHTML = `<div class="aspa-card">
      <div class="aspa-head">${asChip(asn)} <span class="muted small">ASPA in the ${esc(tas)} RPKI · since ${esc(fmtDate(since))}</span></div>
      ${as0 ? `<p><strong>AS0 only:</strong> AS${esc(asn)} declares that it has no upstream providers, so any path where
        it appears to have a provider is invalid.</p>`
        : `<p>${providers.length} authorised provider${providers.length === 1 ? "" : "s"}:</p>
          <div class="path">${providers.filter((p) => p !== 0).map(asChip).join("")}</div>`}
      <p class="muted small"><a href="${RADAR}${esc(asn)}" target="_blank" rel="noopener">Check paths through AS${esc(asn)} on Cloudflare Radar →</a></p>
    </div>`;
    fillNames(out);
  } catch (e) {
    out.innerHTML = `<p class="error">BGPKIT did not answer (${esc(e.message)}). Try again in a minute.</p>`;
  }
}

$("#aspa-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const asn = $("#asn").value.trim().replace(/^as/i, "");
  history.replaceState(null, "", `#asn=${asn}`);
  showAspa(asn);
});
document.addEventListener("click", (e) => {
  const a = e.target.closest(".show-aspa");
  if (!a) return;
  e.preventDefault();
  $("#asn").value = a.dataset.asn;
  history.replaceState(null, "", `#asn=${a.dataset.asn}`);
  showAspa(a.dataset.asn);
  $("#aspa-form").scrollIntoView({ behavior: "smooth", block: "start" });
});

(async function init() {
  const status = $("#aspa-status");
  const hashAsn = (location.hash.match(/asn=(\d+)/) || [])[1];
  if (hashAsn) { $("#asn").value = hashAsn; showAspa(hashAsn); }
  const [summary, counts, series, pairs] = await Promise.allSettled([
    api("summary"), api("aspa/verdict-counts"), api("aspa/verdict-series?days=400"), api("aspa/invalid-pairs?limit=200"), loadPairs(),
  ]);
  const failed = [summary, counts, series, pairs].filter((r) => r.status === "rejected");
  if (counts.status === "fulfilled" && summary.status === "fulfilled") renderTiles(summary.value, counts.value);
  if (counts.status === "fulfilled") renderVerdicts(counts.value);
  else $("#verdicts").innerHTML = '<p class="error">Path verdicts are not available right now.</p>';
  if (series.status === "fulfilled") renderTrend(series.value);
  else for (const id of ["#trend-evidence", "#trend-invalid"]) $(id).innerHTML = '<p class="error">Not available right now.</p>';
  if (pairs.status === "fulfilled") pairsState.bgpkit = pairs.value;
  renderPairs(); // this portal's own pairs, or BGPKIT's when ours did not load
  if (failed.length === 4) {
    status.className = "banner stale";
    status.textContent = `BGPKIT did not answer (${failed[0].reason.message}). The ASPA statistics will be back when it does.`;
  } else {
    const day = counts.status === "fulfilled" ? counts.value.snapshot_date : null;
    status.className = failed.length ? "banner stale" : "banner";
    status.innerHTML = (day ? `ASPA path data for <strong>${esc(fmtDate(day))}</strong> (UTC day), ` : "") +
      `live from <a href="https://bgpkit.com/api">BGPKIT</a>.` + (failed.length ? " Some parts did not load; try reloading." : "");
  }
})();
