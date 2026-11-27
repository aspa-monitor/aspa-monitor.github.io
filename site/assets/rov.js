// RPKI Route Origin Validation (RFC 6811) badge for each route on /lookup/: is the origin AS authorised by a
// ROA for this prefix? Interim: verdicts come live from the BGPKIT API (daily RPKI snapshot) until
// rpki-aspa-data publishes ROAs. For an invalid route the covering ROAs are fetched too, to say why.
import { api } from "./bgpkit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const asList = (asns) => asns.map((a) => `AS${a}`).join(", ");

// Why a route is invalid, from the ROAs that cover its prefix. BGPKIT does not return maxLength, but if a
// ROA for the same origin covers the prefix and the route is still invalid, the route is longer than every
// such ROA's maxLength allows.
export function invalidReason(asn, roas) {
  const same = roas.filter((r) => r.origin_asn === asn);
  if (same.length) {
    return `A ROA authorises AS${asn} for ${[...new Set(same.map((r) => r.prefix))].join(", ")}, ` +
      "but this route is more specific than its maxLength allows.";
  }
  const origins = [...new Set(roas.map((r) => r.origin_asn))].sort((a, b) => a - b);
  if (!origins.length) return `No ROA authorises AS${asn} for this prefix.`;
  if (origins.length === 1 && origins[0] === 0) return "An AS0 ROA covers this prefix: it should not be announced at all.";
  return `The covering ROAs authorise ${asList(origins.filter((a) => a !== 0))}, not AS${asn}.`;
}

// {tone, label, text} for a BGPKIT /rov result ("valid" | "invalid" | "unknown").
export function rovView(result, asn, roas = []) {
  if (result === "valid") return { tone: "valid", label: "Valid", text: `A ROA authorises AS${asn} to originate this prefix.` };
  if (result === "invalid") return { tone: "invalid", label: "Invalid", text: invalidReason(asn, roas) };
  if (result === "unknown") return { tone: "none", label: "Not found", text: "No ROA covers this prefix, so RPKI cannot judge it." };
  return { tone: "none", label: result || "?", text: "Unexpected answer from BGPKIT." };
}

// One request per (prefix, origin), shared by every route card and source on the page.
const pending = new Map();
function check(prefix, asn) {
  const key = `${prefix} ${asn}`;
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      const q = `prefix=${encodeURIComponent(prefix)}`;
      const rov = await api(`rov?${q}&asn=${asn}`);
      const roas = rov.result === "invalid" ? (await api(`roas?${q}&include_covering=true`)).data || [] : [];
      return { view: rovView(rov.result, asn, roas), date: rov.date };
    })());
    pending.get(key).catch(() => pending.delete(key)); // retry on the next lookup
  }
  return pending.get(key);
}

// Placeholder that fillRov() replaces.
export function rovSlot(prefix, origin) {
  if (origin == null) return '<span class="muted">cannot check: the origin is an AS_SET</span>';
  return `<span class="rov-slot" data-prefix="${esc(prefix)}" data-asn="${esc(origin)}"><span class="muted">checking…</span></span>`;
}

export function fillRov(root) {
  for (const el of root.querySelectorAll(".rov-slot")) {
    const asn = Number(el.dataset.asn);
    check(el.dataset.prefix, asn).then(({ view, date }) => {
      el.innerHTML = `<span class="rov ${view.tone}">${esc(view.label)}</span> ${esc(view.text)} ` +
        `<span class="muted small">(RPKI data of ${esc(fmtDate(date))}, via <a href="https://bgpkit.com/api">BGPKIT</a>)</span>`;
    }, (e) => {
      el.innerHTML = `<span class="muted">could not check: BGPKIT did not answer (${esc(e.message)})</span>`;
    });
  }
}
