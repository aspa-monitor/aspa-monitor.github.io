import { loadManifest } from "./risdata.js";
import { formatIST, ago } from "./timefmt.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

(async function () {
  const banner = document.querySelector("#freshness");
  const tbody = document.querySelector("#sources tbody");
  try {
    const m = await loadManifest();
    const asOf = new Date(m.upstream.as_of);
    const stale = Date.now() - asOf > 3 * 3600e3;
    banner.className = stale ? "banner stale" : "banner";
    banner.innerHTML = `RIS data as of <strong>${esc(formatIST(asOf))}</strong> (${esc(ago(asOf))}); ` +
      `site built ${esc(formatIST(new Date(m.built_at)))}.` + (stale ? " The hourly update seems to be late." : "");
    tbody.innerHTML = m.sources.map((s) => `<tr><td><code>${esc(s.name)}</code></td><td>${esc(s.collector)}</td>` +
      `<td>AS${esc(s.peer_asn)}</td><td class="num">${esc(s.routes.toLocaleString())}</td>` +
      `<td>${esc(formatIST(new Date(s.as_of)))}</td></tr>`).join("");
  } catch (e) {
    banner.className = "banner stale";
    banner.textContent = `Could not load the data manifest: ${e.message}`;
  }
})();
